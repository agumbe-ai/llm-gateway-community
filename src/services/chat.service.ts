import { randomUUID } from "crypto";
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
import { chatRequestSchema, type ChatCompletionResponse } from "../types/chat";
import { AppError, normalizeError, providerError } from "../utils/errors";
import { estimateCostUsd } from "../utils/pricing";
import {
  measureAsync,
  measureSync,
  type GatewayTimingBreakdown,
  type TimedResult,
} from "../utils/timing";
import { GuardrailConfigService } from "./guardrail-config.service";
import { GuardrailEnforcerService } from "./guardrail-enforcer.service";
import { ModelResolver } from "./model-resolver";
import { RequestLogService } from "./request-log.service";
import { UsageEmitterService } from "./usage-emitter.service";

export type AuthenticatedRequestContext = {
  requestId: string;
  userId: string;
  tenantId: string;
  email?: string;
  subjectType: "session" | "app";
  appId?: string;
};

type ChatServiceDeps = {
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

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  async createCompletion(
    context: AuthenticatedRequestContext,
    input: unknown,
  ): Promise<TimedResult<ChatCompletionResponse>> {
    const startedAt = Date.now();
    const rawModel =
      input && typeof input === "object" && "model" in (input as Record<string, unknown>)
        ? (input as Record<string, unknown>).model
        : undefined;
    let requestedModel = typeof rawModel === "string" ? rawModel : "unknown";
    let resolvedModel: ResolvedModel | undefined;
    let requestMode: "sync" | "stream" = "sync";
    let policySet = context.appId || "default";

    const buildMetricAttributes = (overrides?: Attributes): Attributes => ({
      route_kind: "chat",
      provider: resolvedModel?.provider || "unknown",
      model: resolvedModel?.canonicalModel || requestedModel,
      request_mode: requestMode,
      policy_set: policySet,
      ...overrides,
    });

    try {
      let modelResolveMs = 0;
      let guardrailConfigMs = 0;
      let guardrailInputMs = 0;
      let providerMs = 0;
      let guardrailOutputMs = 0;
      let requestLogMs = 0;
      let usageEmitMs = 0;
      let sideEffectsMs = 0;

      const request = chatRequestSchema.parse(input);
      requestMode = request.stream ? "stream" : "sync";
      requestedModel = request.model;

      const resolvedModelMeasured = withSpanSync("model.resolve", () =>
        measureSync(() =>
          this.deps.modelResolver.resolve(request.model, "chat"),
        ),
      );
      const resolved = resolvedModelMeasured.result;
      resolvedModel = resolved;
      modelResolveMs = resolvedModelMeasured.elapsedMs;

      setActiveSpanAttributes({
        "provider.name": resolved.provider,
        "gen_ai.response.model": resolved.canonicalModel,
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
          this.deps.guardrailEnforcer.prepareChatRequest(
            context,
            request,
            resolved,
            policy,
            appliedAppId,
          ),
        ),
      );
      const prepared = preparedMeasured.result;
      guardrailInputMs = preparedMeasured.elapsedMs;

      const adapter = this.deps.providers[resolved.provider];
      if (!adapter?.chat) {
        throw providerError(
          `Provider ${resolved.provider} chat adapter is not enabled`,
          501,
          "unsupported_provider",
        );
      }

      const providerMeasured = await withSpan("provider.request", () =>
        measureAsync(() =>
          adapter.chat!({
            model: resolved,
            messages: prepared.request.messages,
            maxTokens: prepared.request.max_tokens,
            maxCompletionTokens: prepared.request.max_completion_tokens,
            maxOutputTokens: prepared.request.max_output_tokens,
            temperature: prepared.request.temperature,
            responseFormat: prepared.request.response_format,
            timeoutMs: this.deps.requestTimeoutMs,
          }),
        ),
      );
      const result = providerMeasured.result;
      providerMs = providerMeasured.elapsedMs;

      const latencyMs = Date.now() - startedAt;
      const usage = result.usage;
      const estimatedCost = estimateCostUsd(resolvedModel, usage, this.deps.modelPricing);

      const responseMeasured = withSpanSync("guardrails.output.inspect", () =>
        measureSync(() => {
          const inspectedOutput = this.deps.guardrailEnforcer.inspectChatOutput(
            context,
            result.message.content,
            policy,
            prepared.trace,
            request.agumbe_grounding_context,
          );

          return this.deps.guardrailEnforcer.attachTrace<ChatCompletionResponse>({
            id: result.id || `chatcmpl_${randomUUID()}`,
            object: "chat.completion",
            created: result.created || Math.floor(Date.now() / 1000),
            model: resolved.canonicalModel,
            choices: [
              {
                index: 0,
                message: {
                  ...result.message,
                  content: inspectedOutput.content,
                },
                finish_reason: result.finishReason ?? "stop",
              },
            ],
            usage: {
              prompt_tokens: usage.promptTokens,
              completion_tokens: usage.completionTokens,
              total_tokens: usage.totalTokens,
            },
          }, inspectedOutput.trace);
        }),
      );
      const response = responseMeasured.result;
      guardrailOutputMs = responseMeasured.elapsedMs;

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
              workspaceId: request.agumbe_metadata?.workspace_id,
              xnamespaceId: request.agumbe_metadata?.xnamespace_id,
              sourceService: request.agumbe_metadata?.source_service,
              operation: request.agumbe_metadata?.operation,
              externalRequestId: request.agumbe_metadata?.external_request_id,
              requestKind: "chat",
              requestedModel: request.model,
              provider: resolved.provider,
              upstreamModel: resolved.upstreamModel,
              status: "success",
              latencyMs,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              estimatedCost,
              createdAt: new Date(),
              requestPayload: prepared.request,
              responsePayload: response,
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
              workspaceId: request.agumbe_metadata?.workspace_id,
              xnamespaceId: request.agumbe_metadata?.xnamespace_id,
              sourceService: request.agumbe_metadata?.source_service,
              operation: request.agumbe_metadata?.operation,
              externalRequestId: request.agumbe_metadata?.external_request_id,
              requestKind: "chat",
              requestedModel: request.model,
              provider: resolved.provider,
              upstreamModel: resolved.upstreamModel,
              promptTokens: usage.promptTokens,
              completionTokens: usage.completionTokens,
              totalTokens: usage.totalTokens,
              latencyMs,
              status: "success",
              estimatedCost,
              timestamp: new Date().toISOString(),
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
        guardrailOutputMs,
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
      recordGuardrailLatency(metricAttributes, guardrailOutputMs, "output_inspect");
      recordRequestLogLatency(metricAttributes, requestLogMs);
      recordUsageEmitLatency(metricAttributes, usageEmitMs);
      recordTokenUsage(metricAttributes, usage.promptTokens, usage.completionTokens);
      recordEstimatedCost(metricAttributes, estimatedCost);
      addActiveSpanEvent("request.completed", {
        "gen_ai.usage.input_tokens": usage.promptTokens,
        "gen_ai.usage.output_tokens": usage.completionTokens,
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
      requestMode = inputRecord?.stream === true ? "stream" : requestMode;
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
          requestKind: "chat",
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
          requestKind: "chat",
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
