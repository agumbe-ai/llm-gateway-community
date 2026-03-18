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

function isGpt5Model(model: string) {
  return /^gpt-5(\.|-|$)/i.test(model);
}

function flattenResponseText(outputText: unknown): string {
  if (typeof outputText === "string") {
    return outputText;
  }

  return "";
}

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    if (isGpt5Model(request.model.upstreamModel)) {
      const response = await withTimeout(
        this.client.responses.create({
          model: request.model.upstreamModel,
          input: request.messages.map((message) => ({
            role: message.role,
            content: [{ type: "input_text", text: message.content }],
          })),
          max_output_tokens: request.maxOutputTokens ?? request.maxCompletionTokens ?? request.maxTokens,
        }),
        request.timeoutMs,
      );

      return {
        id: response.id,
        created: Math.floor(Date.now() / 1000),
        model: request.model.canonicalModel,
        message: {
          role: "assistant",
          content: response.output_text ?? "",
        },
        finishReason: response.status ?? "stop",
        usage: extractUsage(response.usage),
      };
    }

    const response = await withTimeout(
      this.client.chat.completions.create({
        model: request.model.upstreamModel,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_completion_tokens: request.maxCompletionTokens ?? request.maxTokens,
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