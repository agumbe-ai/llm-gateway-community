import type { FastifyReply } from "fastify";

export type GatewayTimingBreakdown = {
  totalMs: number;
  modelResolveMs: number;
  guardrailConfigMs: number;
  guardrailInputMs: number;
  providerMs: number;
  guardrailOutputMs: number;
  requestLogMs: number;
  usageEmitMs: number;
  sideEffectsMs: number;
  gatewayOverheadMs: number;
};

export type TimedResult<T> = {
  response: T;
  timings: GatewayTimingBreakdown;
  estimatedCostUsd?: number;
};

const TIMING_HEADERS: Record<keyof GatewayTimingBreakdown, string> = {
  totalMs: "x-agumbe-timing-total-ms",
  modelResolveMs: "x-agumbe-timing-model-resolve-ms",
  guardrailConfigMs: "x-agumbe-timing-guardrail-config-ms",
  guardrailInputMs: "x-agumbe-timing-guardrail-input-ms",
  providerMs: "x-agumbe-timing-provider-ms",
  guardrailOutputMs: "x-agumbe-timing-guardrail-output-ms",
  requestLogMs: "x-agumbe-timing-request-log-ms",
  usageEmitMs: "x-agumbe-timing-usage-emit-ms",
  sideEffectsMs: "x-agumbe-timing-side-effects-ms",
  gatewayOverheadMs: "x-agumbe-timing-gateway-overhead-ms",
};

export const ESTIMATED_COST_USD_HEADER = "x-agumbe-estimated-cost-usd";

export function measureSync<T>(fn: () => T): { result: T; elapsedMs: number } {
  const startedAt = Date.now();
  const result = fn();

  return {
    result,
    elapsedMs: Date.now() - startedAt,
  };
}

export async function measureAsync<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; elapsedMs: number }> {
  const startedAt = Date.now();
  const result = await fn();

  return {
    result,
    elapsedMs: Date.now() - startedAt,
  };
}

export function setTimingHeaders(reply: FastifyReply, timings: GatewayTimingBreakdown) {
  for (const [key, headerName] of Object.entries(TIMING_HEADERS) as Array<
    [keyof GatewayTimingBreakdown, string]
  >) {
    reply.header(headerName, String(timings[key]));
  }
}

export function setEstimatedCostHeader(reply: FastifyReply, estimatedCostUsd?: number) {
  if (typeof estimatedCostUsd !== "number" || Number.isNaN(estimatedCostUsd)) {
    return;
  }

  reply.header(ESTIMATED_COST_USD_HEADER, String(estimatedCostUsd));
}
