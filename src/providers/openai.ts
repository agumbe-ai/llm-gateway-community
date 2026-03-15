import OpenAI from "openai";
import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderEmbeddingsRequest,
  ProviderEmbeddingsResult,
} from "./types";
import { extractUsage } from "../utils/usage";
import { withTimeout } from "../utils/timeout";

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const response = await withTimeout(
      this.client.chat.completions.create({
        model: request.model.upstreamModel,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_tokens: request.maxTokens,
        temperature: request.temperature,
      }),
      request.timeoutMs,
    );

    const choice = response.choices[0];

    return {
      id: response.id,
      created: response.created,
      model: request.model.canonicalModel,
      message: {
        role: "assistant",
        content: String(choice?.message?.content ?? ""),
      },
      finishReason: choice?.finish_reason ?? null,
      usage: extractUsage(response.usage),
    };
  }

  async embeddings(request: ProviderEmbeddingsRequest): Promise<ProviderEmbeddingsResult> {
    const response = await withTimeout(
      this.client.embeddings.create({
        model: request.model.upstreamModel,
        input: request.input,
      }),
      request.timeoutMs,
    );

    return {
      model: request.model.canonicalModel,
      data: response.data.map((item) => ({
        embedding: item.embedding,
        index: item.index,
      })),
      usage: extractUsage(response.usage),
    };
  }
}
