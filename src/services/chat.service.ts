import { randomUUID } from "crypto";
import type { ModelPricing } from "../config/env";
import type { ProviderAdapter, ProviderName, ResolvedModel } from "../providers/types";
import { chatRequestSchema, type ChatCompletionResponse } from "../types/chat";
import { normalizeError, providerError } from "../utils/errors";
import { estimateCostUsd } from "../utils/pricing";
import { BillingGuardService } from "./billing-guard.service";
import { BillingUsageEmitterService } from "./billing-usage-emitter.service";
import { ModelResolver } from "./model-resolver";
import { RequestLogService } from "./request-log.service";
import { UsageEmitterService } from "./usage-emitter.service";

export type AuthenticatedRequestContext = {
  requestId: string;
  userId: string;
  tenantId: string;
  email?: string;
  bearerToken: string;
};

type ChatServiceDeps = {
  providers: Record<ProviderName, ProviderAdapter>;
  modelResolver: ModelResolver;
  requestLogService: RequestLogService;
  usageEmitter: UsageEmitterService;
  billingGuardService: BillingGuardService;
  billingUsageEmitter: BillingUsageEmitterService;
  modelPricing: ModelPricing;
  requestTimeoutMs: number;
};

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export class ChatService {
  constructor(private readonly deps: ChatServiceDeps) {}

  async createCompletion(
    context: AuthenticatedRequestContext,
    input: unknown,
  ): Promise<ChatCompletionResponse> {
    const startedAt = Date.now();
    const rawModel =
      input && typeof input === "object" && "model" in (input as Record<string, unknown>)
        ? (input as Record<string, unknown>).model
        : undefined;
    let requestedModel = typeof rawModel === "string" ? rawModel : "unknown";
    let resolvedModel: ResolvedModel | undefined;

    try {
      const request = chatRequestSchema.parse(input);
      requestedModel = request.model;
      resolvedModel = this.deps.modelResolver.resolve(request.model, "chat");
      await this.deps.billingGuardService.authorize({
        requestKind: "chat",
        context,
        model: resolvedModel,
        request,
        bearerToken: context.bearerToken,
      });

      const adapter = this.deps.providers[resolvedModel.provider];
      if (!adapter?.chat) {
        throw providerError(
          `Provider ${resolvedModel.provider} chat adapter is not enabled`,
          501,
          "unsupported_provider",
        );
      }

      const result = await adapter.chat({
        model: resolvedModel,
        messages: request.messages,
        maxTokens: request.max_tokens,
        temperature: request.temperature,
        timeoutMs: this.deps.requestTimeoutMs,
      });

      const latencyMs = Date.now() - startedAt;
      const usage = result.usage;
      const estimatedCost = estimateCostUsd(resolvedModel, usage, this.deps.modelPricing);

      const response: ChatCompletionResponse = {
        id: result.id || `chatcmpl_${randomUUID()}`,
        object: "chat.completion",
        created: result.created || Math.floor(Date.now() / 1000),
        model: resolvedModel.canonicalModel,
        choices: [
          {
            index: 0,
            message: result.message,
            finish_reason: result.finishReason ?? "stop",
          },
        ],
        usage: {
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          total_tokens: usage.totalTokens,
        },
      };

      await Promise.allSettled([
        this.deps.requestLogService.log({
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: context.requestId,
          requestKind: "chat",
          requestedModel: request.model,
          provider: resolvedModel.provider,
          upstreamModel: resolvedModel.upstreamModel,
          status: "success",
          latencyMs,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          estimatedCost,
          createdAt: new Date(),
          requestPayload: request,
          responsePayload: response,
        }),
        this.deps.usageEmitter.emit({
          eventType: "llm_usage_raw",
          tenantId: context.tenantId,
          userId: context.userId,
          requestId: context.requestId,
          requestKind: "chat",
          requestedModel: request.model,
          provider: resolvedModel.provider,
          upstreamModel: resolvedModel.upstreamModel,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          latencyMs,
          status: "success",
          estimatedCost,
          timestamp: new Date().toISOString(),
        }),
        this.deps.billingUsageEmitter.emit({
          requestId: context.requestId,
          tenantId: context.tenantId,
          requestKind: "chat",
          requestedModel: request.model,
          provider: resolvedModel.provider,
          upstreamModel: resolvedModel.upstreamModel,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
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

      throw normalized;
    }
  }
}
