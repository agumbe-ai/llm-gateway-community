import type { ModelPricing } from "../config/env";
import type { NormalizedUsage, ResolvedModel } from "../providers/types";

export function estimateCostUsd(
  model: ResolvedModel,
  usage: NormalizedUsage,
  pricing: ModelPricing,
): number {
  const config = pricing[model.canonicalModel];
  if (!config) {
    return 0;
  }

  const estimated =
    (usage.promptTokens / 1000) * config.promptPer1kUsd +
    (usage.completionTokens / 1000) * config.completionPer1kUsd;

  return Number(estimated.toFixed(8));
}
