import type { Attributes } from "@opentelemetry/api";
import type { ModelPricing } from "../config/env";
import type { ProviderAdapter, ProviderName, ResolvedModel } from "../providers/types";
import {
  recordEstimatedCost,
  recordGuardrailLatency,
  recordPolicyBlock,
  recordProviderLatency,
  recordRequest,
  recordRequestError,
  recordRequestLogLatency,
  recordTokenUsage,
  recordUsageEmitLatency,
} from "../telemetry/metrics";
import {
  addActiveSpanEvent,
  setActiveSpanAttributes,
  withSpan,
  withSpanSync,
} from "../telemetry/tracing";
import { embeddingsRequestSchema, type EmbeddingsResponse } from "../types/embeddings";
import { AppError, normalizeError, providerError } from "../utils/errors";
import { estimateCostUsd } from "../utils/pricing";
import {
  measureAsync,
  measureSync,
  type GatewayTimingBreakdown,
  type TimedResult,
} from "../utils/timing";
import type { AuthenticatedRequestContext } from "./chat.service";
import { GuardrailConfigService } from "./guardrail-config.service";
import { GuardrailEnforcerService } from "./guardrail-enforcer.service";
import { ModelResolver } from "./model-resolver";
import { RequestLogService } from "./request-log.service";
import { executeRoutePlan } from "./routing-executor";
import { UsageEmitterService } from "./usage-emitter.service";

type EmbeddingsServiceDeps = {
  providers: Partial<Record<ProviderName, ProviderAdapter>>;
  modelResolver: ModelResolver;
  requestLogService: RequestLogService;
  usageEmitter: UsageEmitterService;
  guardrailConfigService: GuardrailConfigService;
  guardrailEnforcer: GuardrailEnforcerService;
  modelPricing: ModelPricing;
  requestTimeoutMs: number;
};

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

function isPolicyBlockedCode(code?: string) {
  return typeof code === "string" && code.startsWith("guardrail_");
}

export class EmbeddingsService {
  constructor(private readonly deps: EmbeddingsServiceDeps) {}

  async createEmbeddings(
    context: AuthenticatedRequestContext,
    input: unknown,
  ): Promise<TimedResult<EmbeddingsResponse>> {
    const startedAt = Date.now();
    const rawModel =
      input && typeof input === "object" && "model" in (input as Record<string, unknown>)
        ? (input as Record<string, unknown>).model
        : undefined;
    let requestedModel = typeof rawModel === "string" ? rawModel : "unknown";
    let resolvedModel: ResolvedModel | undefined;
    let policySet = context.appId || "default";

    const buildMetricAttributes = (overrides?: Attributes): Attributes => ({
      route_kind: "embeddings",
      provider: resolvedModel?.provider || "unknown",
      model: resolvedModel?.canonicalModel || requestedModel,
      request_mode: "sync",
      policy_set: policySet,
      ...overrides,
    });

    try {
      let modelResolveMs = 0;
      let guardrailConfigMs = 0;
      let guardrailInputMs = 0;
      let providerMs = 0;
      let requestLogMs = 0;
      let usageEmitMs = 0;
      let sideEffectsMs = 0;

      const request = embeddingsRequestSchema.parse(input);
      requestedModel = request.model;

      const routePlanMeasured = withSpanSync("model.resolve", () =>
        measureSync(() =>
          this.deps.modelResolver.resolveRoute(request.model, "embeddings"),
        ),
      );
      const routePlan = routePlanMeasured.result;
      const initialModel = routePlan.candidates[0]?.model;
      if (!initialModel) {
        throw providerError(
          `No routing candidates were available for ${request.model}`,
          502,
          "route_unavailable",
        );
      }
      resolvedModel = initialModel;
      modelResolveMs = routePlanMeasured.elapsedMs;

      setActiveSpanAttributes({
        "provider.name": initialModel.provider,
        "gen_ai.response.model": initialModel.canonicalModel,
      });

      const requestedAppId = request.agumbe_guardrails_app_id;
      const authAppId = context.appId;

      if (authAppId && requestedAppId && authAppId !== requestedAppId) {
        throw new AppError("API key is not allowed to use this app", {
          statusCode: 403,
          code: "app_mismatch",
          type: "authentication_error",
        });
      }

      const appliedAppId = requestedAppId ?? authAppId ?? "default";
      policySet = appliedAppId;
      setActiveSpanAttributes({
        "agumbe.app_id": appliedAppId,
        "agumbe.policy_set": appliedAppId,
      });

      const policyMeasured = await withSpan("guardrails.config.load", () =>
        measureAsync(() =>
          this.deps.guardrailConfigService.getPolicy(
            context.tenantId,
            appliedAppId,
          ),
        ),
      );
      const policy = policyMeasured.result;
      guardrailConfigMs = policyMeasured.elapsedMs;

      const preparedMeasured = withSpanSync("guardrails.input.prepare", () =>
        measureSync(() =>
          this.deps.guardrailEnforcer.prepareEmbeddingsRequest(
            context,
            request,
            initialModel,
            policy,
            appliedAppId,
          ),
        ),
      );
      const prepared = preparedMeasured.result;
      guardrailInputMs = preparedMeasured.elapsedMs;

      const providerMeasured = await withSpan("provider.request", () =>
        measureAsync(() =>
          executeRoutePlan(routePlan, async (candidateModel) => {
            const adapter = this.deps.providers[candidateModel.provider];
            if (!adapter?.embeddings) {
              throw providerError(
                `Provider ${candidateModel.provider} embeddings adapter is not enabled`,
                501,
                "unsupported_provider",
              );
            }

            return adapter.embeddings({
              model: candidateModel,
              input: prepared.request.input,
              timeoutMs: this.deps.requestTimeoutMs,
            });
          }),
        ),
      );
      const routed = providerMeasured.result;
      const result = routed.result;
      const resolved = routed.resolvedModel;
      resolvedModel = resolved;
      providerMs = providerMeasured.elapsedMs;

      const latencyMs = Date.now() - startedAt;
      const usage = result.usage;
      const estimatedCost = estimateCostUsd(resolvedModel, usage, this.deps.modelPricing);

      const response = this.deps.guardrailEnforcer.attachTrace<EmbeddingsResponse>({
        object: "list",
        data: result.data.map((item) => ({
          object: "embedding",
          embedding: item.embedding,
          index: item.index,
        })),
        model: resolved.canonicalModel,
        usage: {
          prompt_tokens: usage.promptTokens,
          total_tokens: usage.totalTokens,
        },
      }, prepared.trace);

      const sideEffectsStartedAt = Date.now();
      await Promise.allSettled([
        withSpan("request_log.write", () =>
          measureAsync(() =>
            this.deps.requestLogService.log({
              tenantId: context.tenantId,
              userId: context.userId,
              requestId: context.requestId,
              subjectType: context.subjectType,
              appId: appliedAppId,
              requestKind: "embeddings",
              requestedModel: request.model,
              provider: resolved.provider,
              upstreamModel: resolved.upstreamModel,
              status: "success",
              latencyMs,
              promptTokens: usage.promptTokens,
              completionTokens: 0,
              totalTokens: usage.totalTokens,
              estimatedCost,
              createdAt: new Date(),
              requestPayload: prepared.request,
              responsePayload: response,
              workspaceId: request.agumbe_metadata?.workspace_id,
              xnamespaceId: request.agumbe_metadata?.xnamespace_id,
              sourceService: request.agumbe_metadata?.source_service,
              operation: request.agumbe_metadata?.operation,
              externalRequestId: request.agumbe_metadata?.external_request_id,
            }),
          ),
        ).then((measured) => {
          requestLogMs = measured.elapsedMs;
        }),
        withSpan("usage_event.emit", () =>
          measureAsync(() =>
            this.deps.usageEmitter.emit({
              eventType: "llm_usage_raw",
              tenantId: context.tenantId,
              userId: context.userId,
              requestId: context.requestId,
              requestKind: "embeddings",
              requestedModel: request.model,
              provider: resolved.provider,
              upstreamModel: resolved.upstreamModel,
              promptTokens: usage.promptTokens,
              completionTokens: 0,
              totalTokens: usage.totalTokens,
              latencyMs,
              status: "success",
              estimatedCost,
              timestamp: new Date().toISOString(),
              workspaceId: request.agumbe_metadata?.workspace_id,
              xnamespaceId: request.agumbe_metadata?.xnamespace_id,
              sourceService: request.agumbe_metadata?.source_service,
              operation: request.agumbe_metadata?.operation,
              externalRequestId: request.agumbe_metadata?.external_request_id,
            }),
          ),
        ).then((measured) => {
          usageEmitMs = measured.elapsedMs;
        }),
      ]);
      sideEffectsMs = Date.now() - sideEffectsStartedAt;

      const totalMs = Date.now() - startedAt;
      const timings: GatewayTimingBreakdown = {
        totalMs,
        modelResolveMs,
        guardrailConfigMs,
        guardrailInputMs,
        providerMs,
        guardrailOutputMs: 0,
        requestLogMs,
        usageEmitMs,
        sideEffectsMs,
        gatewayOverheadMs: Math.max(0, totalMs - providerMs),
      };

      const metricAttributes = buildMetricAttributes();
      recordRequest(metricAttributes, totalMs);
      recordProviderLatency(metricAttributes, providerMs);
      recordGuardrailLatency(metricAttributes, guardrailConfigMs, "config_load");
      recordGuardrailLatency(metricAttributes, guardrailInputMs, "input_prepare");
      recordRequestLogLatency(metricAttributes, requestLogMs);
      recordUsageEmitLatency(metricAttributes, usageEmitMs);
      recordTokenUsage(metricAttributes, usage.promptTokens, 0);
      recordEstimatedCost(metricAttributes, estimatedCost);
      addActiveSpanEvent("request.completed", {
        "gen_ai.usage.input_tokens": usage.promptTokens,
      });

      return {
        response,
        timings,
        estimatedCostUsd: estimatedCost,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      const latencyMs = Date.now() - startedAt;
      const inputRecord = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
      policySet =
        (typeof inputRecord?.agumbe_guardrails_app_id === "string"
          ? inputRecord.agumbe_guardrails_app_id
          : undefined) ||
        policySet;

      await Promise.allSettled([
        this.deps.requestLogService.log({
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: context.requestId,
          subjectType: context.subjectType,
          appId:
            typeof inputRecord?.agumbe_guardrails_app_id === "string"
              ? inputRecord.agumbe_guardrails_app_id
              : context.appId || "default",
          requestKind: "embeddings",
          requestedModel,
          provider: resolvedModel?.provider || "unknown",
          upstreamModel: resolvedModel?.upstreamModel || "unknown",
          status: "error",
          latencyMs,
          promptTokens: ZERO_USAGE.promptTokens,
          completionTokens: ZERO_USAGE.completionTokens,
          totalTokens: ZERO_USAGE.totalTokens,
          estimatedCost: 0,
          errorCode: normalized.code,
          createdAt: new Date(),
          requestPayload: input,
        }),
        this.deps.usageEmitter.emit({
          eventType: "llm_usage_raw",
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: context.requestId,
          requestKind: "embeddings",
          requestedModel,
          provider: resolvedModel?.provider || "unknown",
          upstreamModel: resolvedModel?.upstreamModel || "unknown",
          promptTokens: ZERO_USAGE.promptTokens,
          completionTokens: ZERO_USAGE.completionTokens,
          totalTokens: ZERO_USAGE.totalTokens,
          latencyMs,
          status: "error",
          estimatedCost: 0,
          errorCode: normalized.code,
          timestamp: new Date().toISOString(),
        }),
      ]);

      const metricAttributes = buildMetricAttributes({
        error_code: normalized.code,
      });
      recordRequest(metricAttributes, latencyMs);
      recordRequestError(metricAttributes);
      if (isPolicyBlockedCode(normalized.code)) {
        recordPolicyBlock(metricAttributes);
      }
      addActiveSpanEvent("request.failed", {
        "error.type": normalized.type,
        "error.code": normalized.code,
      });

      throw normalized;
    }
  }
}
