import type { ReliabilityConfig, ReliabilityTargetConfig } from "../config/env";
import type { ResolvedModel } from "../providers/types";
import { providerError } from "../utils/errors";

type BreakerState = {
  consecutiveFailures: number;
  openedUntil?: number;
};

const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_COOLDOWN_MS = 30_000;

export class ReliabilityService {
  private readonly breakerState = new Map<string, BreakerState>();

  constructor(private readonly config: ReliabilityConfig = {}) {}

  getTimeoutMs(model: ResolvedModel, defaultTimeoutMs: number) {
    const target = this.getTargetConfig(model);
    return target.timeoutMs && target.timeoutMs > 0
      ? target.timeoutMs
      : this.config.defaultTimeoutMs || defaultTimeoutMs;
  }

  assertCircuitClosed(model: ResolvedModel) {
    const target = this.getTargetConfig(model);
    if (!target.circuitBreaker) {
      return;
    }

    const state = this.breakerState.get(this.getKey(model));
    if (!state?.openedUntil) {
      return;
    }

    if (Date.now() >= state.openedUntil) {
      this.breakerState.delete(this.getKey(model));
      return;
    }

    throw providerError(`Circuit breaker open for ${model.canonicalModel}`, 503, "circuit_open");
  }

  recordSuccess(model: ResolvedModel) {
    this.breakerState.delete(this.getKey(model));
  }

  recordFailure(model: ResolvedModel) {
    const target = this.getTargetConfig(model);
    if (!target.circuitBreaker) {
      return false;
    }

    const failureThreshold = target.circuitBreaker.failureThreshold || DEFAULT_FAILURE_THRESHOLD;
    const cooldownMs = target.circuitBreaker.cooldownMs || DEFAULT_COOLDOWN_MS;
    const key = this.getKey(model);
    const state = this.breakerState.get(key) || { consecutiveFailures: 0 };
    state.consecutiveFailures += 1;

    let opened = false;
    if (state.consecutiveFailures >= failureThreshold) {
      state.openedUntil = Date.now() + cooldownMs;
      state.consecutiveFailures = 0;
      opened = true;
    }

    this.breakerState.set(key, state);
    return opened;
  }

  private getTargetConfig(model: ResolvedModel): ReliabilityTargetConfig {
    return this.config.models?.[model.canonicalModel] || this.config.providers?.[model.provider] || {};
  }

  private getKey(model: ResolvedModel) {
    return `${model.provider}:${model.canonicalModel}`;
  }
}
