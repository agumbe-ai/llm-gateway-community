import type { ModelPricing } from "../config/env";
import type { ProviderAdapter, ProviderName, ResolvedModel } from "../providers/types";
import { embeddingsRequestSchema, type EmbeddingsResponse } from "../types/embeddings";
import { normalizeError, providerError } from "../utils/errors";
import { estimateCostUsd } from "../utils/pricing";
import { BillingGuardService } from "./billing-guard.service";
import { BillingUsageEmitterService } from "./billing-usage-emitter.service";
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
  billingGuardService: BillingGuardService;
  billingUsageEmitter: BillingUsageEmitterService;
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
  ): Promise<EmbeddingsResponse> {
    const startedAt = Date.now();
    const rawModel =
      input && typeof input === "object" && "model" in (input as Record<string, unknown>)
        ? (input as Record<string, unknown>).model
        : undefined;
    let requestedModel = typeof rawModel === "string" ? rawModel : "unknown";
    let resolvedModel: ResolvedModel | undefined;

    try {
      const request = embeddingsRequestSchema.parse(input);
      requestedModel = request.model;
      resolvedModel = this.deps.modelResolver.resolve(request.model, "embeddings");
      const appliedAppId =
        context.subjectType === "app"
          ? context.appId || "default"
          : request.agumbe_guardrails_app_id || "default";
      const policy = await this.deps.guardrailConfigService.getPolicy(context.tenantId, appliedAppId);
      const prepared = this.deps.guardrailEnforcer.prepareEmbeddingsRequest(
        context,
        request,
        resolvedModel,
        policy,
        appliedAppId,
      );
      await this.deps.billingGuardService.authorize({
        requestKind: "embeddings",
        context,
        model: resolvedModel,
        request: prepared.request,
        bearerToken: context.bearerToken,
      });

      const adapter = this.deps.providers[resolvedModel.provider];
      if (!adapter?.embeddings) {
        throw providerError(
          `Provider ${resolvedModel.provider} embeddings adapter is not enabled`,
          501,
          "unsupported_provider",
        );
      }

      const result = await adapter.embeddings({
        model: resolvedModel,
        input: prepared.request.input,
        timeoutMs: this.deps.requestTimeoutMs,
      });

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
        model: resolvedModel.canonicalModel,
        usage: {
          prompt_tokens: usage.promptTokens,
          total_tokens: usage.totalTokens,
        },
      }, prepared.trace);

      await Promise.allSettled([
        this.deps.requestLogService.log({
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: context.requestId,
          requestKind: "embeddings",
          requestedModel: request.model,
          provider: resolvedModel.provider,
          upstreamModel: resolvedModel.upstreamModel,
          status: "success",
          latencyMs,
          promptTokens: usage.promptTokens,
          completionTokens: 0,
          totalTokens: usage.totalTokens,
          estimatedCost,
          createdAt: new Date(),
          requestPayload: prepared.request,
          responsePayload: response,
        }),
        this.deps.usageEmitter.emit({
          eventType: "llm_usage_raw",
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: context.requestId,
          requestKind: "embeddings",
          requestedModel: request.model,
          provider: resolvedModel.provider,
          upstreamModel: resolvedModel.upstreamModel,
          promptTokens: usage.promptTokens,
          completionTokens: 0,
          totalTokens: usage.totalTokens,
          latencyMs,
          status: "success",
          estimatedCost,
          timestamp: new Date().toISOString(),
        }),
        this.deps.billingUsageEmitter.emit({
          requestId: context.requestId,
          tenantId: context.tenantId,
          requestKind: "embeddings",
          requestedModel: request.model,
          provider: resolvedModel.provider,
          upstreamModel: resolvedModel.upstreamModel,
          promptTokens: usage.promptTokens,
          completionTokens: 0,
          totalTokens: usage.totalTokens,
          latencyMs,
          status: "success",
          timestamp: new Date().toISOString(),
        }),
      ]);

      return response;
    } catch (error) {
      const normalized = normalizeError(error);
      const latencyMs = Date.now() - startedAt;

      await Promise.allSettled([
        this.deps.requestLogService.log({
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: context.requestId,
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
