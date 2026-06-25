import { randomUUID } from "crypto";
import type { Attributes } from "@opentelemetry/api";
import type { ModelPricing } from "../config/env";
import type {
  ProviderAdapter,
  ProviderName,
  ProviderResponsesStreamEvent,
  ResolvedModel,
} from "../providers/types";
import {
  recordCircuitBreakerOpen,
  recordDeadLetterEmitLatency,
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
import { responsesRequestSchema, type ResponsesResponse } from "../types/responses";
import { AppError, normalizeError, providerError } from "../utils/errors";
import { estimateCostUsd } from "../utils/pricing";
import {
  measureAsync,
  measureSync,
  type GatewayTimingBreakdown,
  type TimedResult,
} from "../utils/timing";
import type { AuthenticatedRequestContext } from "./chat.service";
import { DeadLetterService, toDeadLetterEvent } from "./dead-letter.service";
import { GuardrailConfigService } from "./guardrail-config.service";
import { GuardrailEnforcerService } from "./guardrail-enforcer.service";
import { ModelResolver } from "./model-resolver";
import { ReliabilityService } from "./reliability.service";
import { RequestLogService } from "./request-log.service";
import { executeRoutePlan } from "./routing-executor";
import { UsageEmitterService } from "./usage-emitter.service";

type ResponsesServiceDeps = {
  providers: Partial<Record<ProviderName, ProviderAdapter>>;
  modelResolver: ModelResolver;
  requestLogService: RequestLogService;
  usageEmitter: UsageEmitterService;
  deadLetterService: DeadLetterService;
  reliabilityService: ReliabilityService;
  guardrailConfigService: GuardrailConfigService;
  guardrailEnforcer: GuardrailEnforcerService;
  modelPricing: ModelPricing;
  requestTimeoutMs: number;
};

export type ResponsesStreamResult = {
  events: AsyncIterable<ProviderResponsesStreamEvent>;
};

const ZERO_USAGE = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

function isPolicyBlockedCode(code?: string) {
  return typeof code === "string" && code.startsWith("guardrail_");
}

function replaceResponseOutputText(output: unknown, content: string) {
  if (!Array.isArray(output)) {
    return output;
  }

  let replaced = false;
  return output.map((item: any) => {
    if (replaced || !Array.isArray(item?.content)) {
      return item;
    }

    return {
      ...item,
      content: item.content.map((part: any) => {
        if (replaced || !["output_text", "text"].includes(part?.type)) {
          return part;
        }
        replaced = true;
        return { ...part, text: content };
      }),
    };
  });
}

export class ResponsesService {
  constructor(private readonly deps: ResponsesServiceDeps) {}

  async createResponse(
    context: AuthenticatedRequestContext,
    input: unknown,
  ): Promise<TimedResult<ResponsesResponse>> {
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
      route_kind: "responses",
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

      const request = responsesRequestSchema.parse(input);
      requestMode = request.stream ? "stream" : "sync";
      requestedModel = request.model;

      if (request.stream) {
        throw new AppError("Responses streaming is not enabled on this endpoint", {
          statusCode: 400,
          code: "unsupported_stream",
          type: "invalid_request_error",
          param: "stream",
        });
      }

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

      const routePlanMeasured = withSpanSync("model.resolve", () =>
        measureSync(() => this.deps.modelResolver.resolveRoute(request.model, "responses")),
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
        "agumbe.app_id": appliedAppId,
        "agumbe.policy_set": appliedAppId,
      });

      const policyMeasured = await withSpan("guardrails.config.load", () =>
        measureAsync(() =>
          this.deps.guardrailConfigService.getPolicy(context.tenantId, appliedAppId),
        ),
      );
      const policy = policyMeasured.result;
      guardrailConfigMs = policyMeasured.elapsedMs;

      const preparedMeasured = withSpanSync("guardrails.input.prepare", () =>
        measureSync(() =>
          this.deps.guardrailEnforcer.prepareResponsesRequest(
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
            if (!adapter?.responses) {
              throw providerError(
                `Provider ${candidateModel.provider} responses adapter is not enabled`,
                501,
                "unsupported_provider",
              );
            }

            return adapter.responses({
              model: candidateModel,
              input: prepared.request.input,
              instructions: prepared.request.instructions,
              previousResponseId: prepared.request.previous_response_id,
              maxOutputTokens: prepared.request.max_output_tokens,
              temperature: prepared.request.temperature,
              responseFormat: prepared.request.response_format,
              text: prepared.request.text,
              tools: prepared.request.tools,
              toolChoice: prepared.request.tool_choice,
              parallelToolCalls: prepared.request.parallel_tool_calls,
              include: prepared.request.include,
              reasoning: prepared.request.reasoning,
              store: prepared.request.store,
              promptCacheKey: prepared.request.prompt_cache_key,
              serviceTier: prepared.request.service_tier,
              clientMetadata: prepared.request.client_metadata,
              metadata: prepared.request.metadata,
              anthropicBeta: prepared.request.anthropic_beta,
              anthropicVersion: prepared.request.anthropic_version,
              timeoutMs: this.deps.reliabilityService.getTimeoutMs(
                candidateModel,
                this.deps.requestTimeoutMs,
              ),
            });
          }, {
            beforeAttempt: async (candidateModel) => {
              this.deps.reliabilityService.assertCircuitClosed(candidateModel);
            },
            onSuccess: async (candidateModel) => {
              this.deps.reliabilityService.recordSuccess(candidateModel);
            },
            onFailure: async (candidateModel, error) => {
              if (error.type === "api_error" || error.type === "rate_limit_error") {
                const opened = this.deps.reliabilityService.recordFailure(candidateModel);
                if (opened) {
                  recordCircuitBreakerOpen(
                    buildMetricAttributes({
                      provider: candidateModel.provider,
                      model: candidateModel.canonicalModel,
                    }),
                  );
                }
              }
            },
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

      const responseMeasured = withSpanSync("guardrails.output.inspect", () =>
        measureSync(() => {
          const inspectedOutput = this.deps.guardrailEnforcer.inspectChatOutput(
            context,
            result.outputText,
            policy,
            prepared.trace,
            request.agumbe_grounding_context,
          );
          const rawUsage =
            result.rawResponse.usage && typeof result.rawResponse.usage === "object"
              ? result.rawResponse.usage as Record<string, unknown>
              : {};

          return this.deps.guardrailEnforcer.attachTrace<ResponsesResponse>({
            ...result.rawResponse,
            id: result.id || String(result.rawResponse.id || `resp_${randomUUID()}`),
            object: typeof result.rawResponse.object === "string" ? result.rawResponse.object : "response",
            created_at: result.created || Math.floor(Date.now() / 1000),
            model: resolved.canonicalModel,
            output: replaceResponseOutputText(result.rawResponse.output, inspectedOutput.content),
            output_text: inspectedOutput.content,
            usage: {
              ...rawUsage,
              input_tokens: usage.promptTokens,
              output_tokens: usage.completionTokens,
              total_tokens: usage.totalTokens,
              prompt_tokens: usage.promptTokens,
              completion_tokens: usage.completionTokens,
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
              requestKind: "responses",
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
              requestKind: "responses",
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

      return { response, timings, estimatedCostUsd: estimatedCost };
    } catch (error) {
      await this.emitFailureSideEffects(
        context,
        input,
        requestedModel,
        resolvedModel,
        policySet,
        Date.now() - startedAt,
        error,
      );

      const normalized = normalizeError(error);
      const metricAttributes = buildMetricAttributes({ error_code: normalized.code });
      recordRequest(metricAttributes, Date.now() - startedAt);
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

  async createResponseStream(
    context: AuthenticatedRequestContext,
    input: unknown,
  ): Promise<ResponsesStreamResult> {
    const request = responsesRequestSchema.parse(input);
    if (!request.stream) {
      throw new AppError("Responses stream endpoint requires stream=true", {
        statusCode: 400,
        code: "stream_required",
        type: "invalid_request_error",
        param: "stream",
      });
    }

    const appliedAppId = request.agumbe_guardrails_app_id ?? context.appId ?? "default";
    const routePlan = this.deps.modelResolver.resolveRoute(request.model, "responses");
    const initialModel = routePlan.candidates[0]?.model;
    if (!initialModel) {
      throw providerError(
        `No routing candidates were available for ${request.model}`,
        502,
        "route_unavailable",
      );
    }

    const policy = await this.deps.guardrailConfigService.getPolicy(context.tenantId, appliedAppId);
    const prepared = this.deps.guardrailEnforcer.prepareResponsesRequest(
      context,
      request,
      initialModel,
      policy,
      appliedAppId,
    );

    const routed = await executeRoutePlan(routePlan, async (candidateModel) => {
      const adapter = this.deps.providers[candidateModel.provider];
      if (!adapter?.responsesStream) {
        throw providerError(
          `Provider ${candidateModel.provider} responses streaming adapter is not enabled`,
          501,
          "unsupported_provider",
        );
      }

      return adapter.responsesStream({
        model: candidateModel,
        input: prepared.request.input,
        instructions: prepared.request.instructions,
        previousResponseId: prepared.request.previous_response_id,
        maxOutputTokens: prepared.request.max_output_tokens,
        temperature: prepared.request.temperature,
        responseFormat: prepared.request.response_format,
        text: prepared.request.text,
        tools: prepared.request.tools,
        toolChoice: prepared.request.tool_choice,
        parallelToolCalls: prepared.request.parallel_tool_calls,
        include: prepared.request.include,
        reasoning: prepared.request.reasoning,
        store: prepared.request.store,
        promptCacheKey: prepared.request.prompt_cache_key,
        serviceTier: prepared.request.service_tier,
        clientMetadata: prepared.request.client_metadata,
        metadata: prepared.request.metadata,
        anthropicBeta: prepared.request.anthropic_beta,
        anthropicVersion: prepared.request.anthropic_version,
        timeoutMs: this.deps.reliabilityService.getTimeoutMs(
          candidateModel,
          this.deps.requestTimeoutMs,
        ),
      });
    }, {
      beforeAttempt: async (candidateModel) => {
        this.deps.reliabilityService.assertCircuitClosed(candidateModel);
      },
      onSuccess: async (candidateModel) => {
        this.deps.reliabilityService.recordSuccess(candidateModel);
      },
      onFailure: async (candidateModel, error) => {
        if (error.type === "api_error" || error.type === "rate_limit_error") {
          this.deps.reliabilityService.recordFailure(candidateModel);
        }
      },
    });

    return { events: routed.result.events };
  }

  private async emitFailureSideEffects(
    context: AuthenticatedRequestContext,
    input: unknown,
    requestedModel: string,
    resolvedModel: ResolvedModel | undefined,
    policySet: string,
    latencyMs: number,
    error: unknown,
  ) {
    const normalized = normalizeError(error);
    let deadLetterEmitMs = 0;

    await Promise.allSettled([
      this.deps.requestLogService.log({
        tenantId: context.tenantId,
        userId: context.userId,
        requestId: context.requestId,
        subjectType: context.subjectType,
        appId: policySet,
        requestKind: "responses",
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
        requestKind: "responses",
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
      withSpan("dead_letter.emit", () =>
        measureAsync(() =>
          this.deps.deadLetterService.emit(
            toDeadLetterEvent({
              requestId: context.requestId,
              tenantId: context.tenantId,
              userId: context.userId,
              requestKind: "responses",
              requestedModel,
              provider: resolvedModel?.provider || "unknown",
              upstreamModel: resolvedModel?.upstreamModel || "unknown",
              error: normalized,
            }),
          ),
        ),
      ).then((measured) => {
        deadLetterEmitMs = measured.elapsedMs;
      }),
    ]);

    recordDeadLetterEmitLatency(
      {
        route_kind: "responses",
        provider: resolvedModel?.provider || "unknown",
        model: resolvedModel?.canonicalModel || requestedModel,
        request_mode: "sync",
        policy_set: policySet,
        error_code: normalized.code,
      },
      deadLetterEmitMs,
    );
  }
}
