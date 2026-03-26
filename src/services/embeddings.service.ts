import type { ModelPricing } from "../config/env";
import type { ProviderAdapter, ProviderName, ResolvedModel } from "../providers/types";
import { embeddingsRequestSchema, type EmbeddingsResponse } from "../types/embeddings";
import { normalizeError, providerError, AppError } from "../utils/errors";
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
import { UsageEmitterService } from "./usage-emitter.service";

type EmbeddingsServiceDeps = {
  providers: Record<ProviderName, ProviderAdapter>;
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
    let timings: GatewayTimingBreakdown | undefined;

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
      const resolvedModelMeasured = measureSync(() =>
        this.deps.modelResolver.resolve(request.model, "embeddings"),
      );
      const resolved = resolvedModelMeasured.result;
      resolvedModel = resolved;
      modelResolveMs = resolvedModelMeasured.elapsedMs;

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
      const policyMeasured = await measureAsync(() =>
        this.deps.guardrailConfigService.getPolicy(
          context.tenantId,
          appliedAppId,
        ),
      );
      const policy = policyMeasured.result;
      guardrailConfigMs = policyMeasured.elapsedMs;

      const preparedMeasured = measureSync(() =>
        this.deps.guardrailEnforcer.prepareEmbeddingsRequest(
          context,
          request,
          resolved,
          policy,
          appliedAppId,
        ),
      );
      const prepared = preparedMeasured.result;
      guardrailInputMs = preparedMeasured.elapsedMs;

      const adapter = this.deps.providers[resolved.provider];
      if (!adapter?.embeddings) {
        throw providerError(
          `Provider ${resolved.provider} embeddings adapter is not enabled`,
          501,
          "unsupported_provider",
        );
      }

      const providerMeasured = await measureAsync(() =>
        adapter.embeddings!({
          model: resolved,
          input: prepared.request.input,
          timeoutMs: this.deps.requestTimeoutMs,
        }),
      );
      const result = providerMeasured.result;
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
        ).then((measured) => {
          requestLogMs = measured.elapsedMs;
        }),
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
        ).then((measured) => {
          usageEmitMs = measured.elapsedMs;
        }),
      ]);
      sideEffectsMs = Date.now() - sideEffectsStartedAt;

      const totalMs = Date.now() - startedAt;
      timings = {
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

      return {
        response,
        timings,
      };
    } catch (error) {
      const normalized = normalizeError(error);
      const latencyMs = Date.now() - startedAt;
      const inputRecord = input && typeof input === "object" ? (input as Record<string, unknown>) : null;

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

      throw normalized;
    }
  }
}
