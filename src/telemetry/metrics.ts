import { metrics, type Attributes } from "@opentelemetry/api";

export type MetricAttributes = Attributes;

const meter = metrics.getMeter("llm-gateway");

const requestsTotal = meter.createCounter("llm_gateway_requests_total", {
  description: "Total gateway requests handled by route kind, provider, model, and mode.",
});

const errorsTotal = meter.createCounter("llm_gateway_errors_total", {
  description: "Total gateway request failures by route kind, provider, model, and error code.",
});

const policyBlockTotal = meter.createCounter("llm_gateway_policy_block_total", {
  description: "Total requests blocked by guardrail policy enforcement.",
});

const inputTokensTotal = meter.createCounter("llm_gateway_tokens_input_total", {
  description: "Total input tokens processed by the gateway.",
});

const outputTokensTotal = meter.createCounter("llm_gateway_tokens_output_total", {
  description: "Total output tokens produced by the gateway.",
});

const estimatedCostUsdTotal = meter.createCounter("llm_gateway_estimated_cost_usd_total", {
  description: "Total estimated request cost in USD.",
});

const requestDurationMs = meter.createHistogram("llm_gateway_request_duration_ms", {
  description: "End-to-end request duration in milliseconds.",
  unit: "ms",
});

const providerLatencyMs = meter.createHistogram("llm_gateway_provider_latency_ms", {
  description: "Provider request latency in milliseconds.",
  unit: "ms",
});

const guardrailLatencyMs = meter.createHistogram("llm_gateway_guardrail_latency_ms", {
  description: "Guardrail stage latency in milliseconds.",
  unit: "ms",
});

const requestLogLatencyMs = meter.createHistogram("llm_gateway_request_log_latency_ms", {
  description: "Request log write latency in milliseconds.",
  unit: "ms",
});

const usageEmitLatencyMs = meter.createHistogram("llm_gateway_usage_emit_latency_ms", {
  description: "Usage event emit latency in milliseconds.",
  unit: "ms",
});

const deadLetterEmitLatencyMs = meter.createHistogram("llm_gateway_dead_letter_emit_latency_ms", {
  description: "Dead-letter emit latency in milliseconds.",
  unit: "ms",
});

const circuitBreakerOpenTotal = meter.createCounter("llm_gateway_circuit_breaker_open_total", {
  description: "Total number of times a circuit breaker opened.",
});

const inflightRequests = meter.createUpDownCounter("llm_gateway_inflight_requests", {
  description: "Current number of in-flight gateway requests.",
});

export function incrementInflightRequests(attributes: MetricAttributes) {
  inflightRequests.add(1, attributes);
}

export function decrementInflightRequests(attributes: MetricAttributes) {
  inflightRequests.add(-1, attributes);
}

export function recordRequest(attributes: MetricAttributes, durationMs: number) {
  requestsTotal.add(1, attributes);
  requestDurationMs.record(durationMs, attributes);
}

export function recordRequestError(attributes: MetricAttributes) {
  errorsTotal.add(1, attributes);
}

export function recordPolicyBlock(attributes: MetricAttributes) {
  policyBlockTotal.add(1, attributes);
}

export function recordProviderLatency(attributes: MetricAttributes, durationMs: number) {
  providerLatencyMs.record(durationMs, attributes);
}

export function recordGuardrailLatency(
  attributes: MetricAttributes,
  durationMs: number,
  stage: "config_load" | "input_prepare" | "output_inspect",
) {
  guardrailLatencyMs.record(durationMs, {
    ...attributes,
    stage,
  });
}

export function recordRequestLogLatency(attributes: MetricAttributes, durationMs: number) {
  requestLogLatencyMs.record(durationMs, attributes);
}

export function recordUsageEmitLatency(attributes: MetricAttributes, durationMs: number) {
  usageEmitLatencyMs.record(durationMs, attributes);
}

export function recordDeadLetterEmitLatency(attributes: MetricAttributes, durationMs: number) {
  deadLetterEmitLatencyMs.record(durationMs, attributes);
}

export function recordCircuitBreakerOpen(attributes: MetricAttributes) {
  circuitBreakerOpenTotal.add(1, attributes);
}

export function recordTokenUsage(
  attributes: MetricAttributes,
  promptTokens: number,
  completionTokens: number,
) {
  if (promptTokens > 0) {
    inputTokensTotal.add(promptTokens, attributes);
  }

  if (completionTokens > 0) {
    outputTokensTotal.add(completionTokens, attributes);
  }
}

export function recordEstimatedCost(attributes: MetricAttributes, estimatedCostUsd: number) {
  if (estimatedCostUsd > 0) {
    estimatedCostUsdTotal.add(estimatedCostUsd, attributes);
  }
}
