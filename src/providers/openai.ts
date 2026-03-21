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

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;
  private readonly client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const needsStructuredOutput = !!request.responseFormat;

      const callChatCompletions = async () => {
        const payload: Record<string, unknown> = {
          model: request.model.upstreamModel,
          messages: request.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          max_completion_tokens: request.maxCompletionTokens ?? request.maxTokens,
          temperature: request.temperature,
        };

        if (request.responseFormat) {
          if (request.responseFormat.type === "json_object") {
            payload.response_format = { type: "json_object" };
          } else {
            payload.response_format = {
              type: "json_schema",
              json_schema: request.responseFormat.json_schema,
            };
          }
        }

        return withTimeout(
          this.client.chat.completions.create(payload as any),
          request.timeoutMs,
        );
      };

    if (isGpt5Model(request.model.upstreamModel) && !needsStructuredOutput) {
      const response = await withTimeout(
        this.client.responses.create({
          model: request.model.upstreamModel,
          input: request.messages.map((message) => ({
            role: message.role as any,
            content: [{ type: "input_text", text: message.content }],
          })),
          max_output_tokens:
            request.maxOutputTokens ?? request.maxCompletionTokens ?? request.maxTokens,
        } as any),
        request.timeoutMs,
      );

      const text =
        typeof response.output_text === "string" ? response.output_text : "";

      return {
        id: response.id,
        created: Math.floor(Date.now() / 1000),
        model: request.model.canonicalModel,
        message: {
          role: "assistant",
          content: text,
        },
        finishReason: "stop",
        usage: extractUsage(response.usage),
      };
    }

    let response = await callChatCompletions();
    let choice = response.choices[0];
    let content = String(choice?.message?.content ?? "");

    if (!content.trim()) {
      response = await callChatCompletions();
      choice = response.choices[0];
      content = String(choice?.message?.content ?? "");
    }

    return {
      id: response.id,
      created: response.created,
      model: request.model.canonicalModel,
      message: {
        role: "assistant",
        content,
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