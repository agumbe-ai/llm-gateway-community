import type { ModelPricing } from "../config/env";
import type { ChatRequest } from "../types/chat";
import type { EmbeddingsRequest } from "../types/embeddings";
import type { NormalizedUsage, ResolvedModel } from "../providers/types";

const CHARS_PER_TOKEN = 4;
const MESSAGE_OVERHEAD_TOKENS = 4;

function estimateTextTokens(text: string) {
  return Math.max(1, Math.ceil(text.length / CHARS_PER_TOKEN));
}

function hasPricing(model: ResolvedModel, pricing: ModelPricing) {
  return Boolean(pricing[model.canonicalModel]);
}

export function estimateChatMaxUsage(
  request: ChatRequest,
  defaultMaxCompletionTokens: number,
): NormalizedUsage {
  const promptTokens = request.messages.reduce((sum, message) => {
    return sum + estimateTextTokens(message.content) + MESSAGE_OVERHEAD_TOKENS;
  }, 0);

  const completionTokens = request.max_tokens ?? defaultMaxCompletionTokens;
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  };
}

export function estimateEmbeddingsUsage(request: EmbeddingsRequest): NormalizedUsage {
  const values = Array.isArray(request.input) ? request.input : [request.input];
  const promptTokens = values.reduce((sum, value) => sum + estimateTextTokens(value), 0);
  return {
    promptTokens,
    completionTokens: 0,
    totalTokens: promptTokens,
  };
}

export function estimateCostUsdForUsage(
  model: ResolvedModel,
  usage: NormalizedUsage,
  pricing: ModelPricing,
) {
  const config = pricing[model.canonicalModel];
  if (!config) {
    return null;
  }

  const estimated =
    (usage.promptTokens / 1000) * config.promptPer1kUsd +
    (usage.completionTokens / 1000) * config.completionPer1kUsd;

  return Number(estimated.toFixed(8));
}

export function ensurePricedModel(model: ResolvedModel, pricing: ModelPricing) {
  return hasPricing(model, pricing);
}
