import type { NormalizedUsage } from "../providers/types";

type UsageLike =
  | {
      total_tokens?: number;
      prompt_tokens?: number;
      completion_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
      cached_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    }
  | undefined
  | null;

export function extractUsage(usage: UsageLike): NormalizedUsage {
  const prompt =
    (usage as any)?.input_tokens ??
    (usage as any)?.prompt_tokens ??
    0;

  const completion =
    (usage as any)?.output_tokens ??
    (usage as any)?.completion_tokens ??
    0;

  const total = (usage as any)?.total_tokens ?? prompt + completion;
  const cached =
    (usage as any)?.cached_tokens ??
    (usage as any)?.prompt_tokens_details?.cached_tokens ??
    0;

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    cachedPromptTokens: cached,
  };
}
