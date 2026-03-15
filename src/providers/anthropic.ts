import Anthropic from "@anthropic-ai/sdk";
import type { ProviderAdapter, ProviderChatRequest, ProviderChatResult } from "./types";
import { extractUsage } from "../utils/usage";
import { withTimeout } from "../utils/timeout";
import { providerError } from "../utils/errors";

function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: any) => (part?.type === "text" ? part.text : ""))
      .join("")
      .trim();
  }

  return "";
}

function mapFinishReason(stopReason?: string | null): string | null {
  switch (stopReason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return stopReason ?? null;
  }
}

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const system = request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n")
      .trim();

    const messages: Anthropic.MessageParam[] = request.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: message.content,
      }));

    if (messages.length === 0) {
      throw providerError("Anthropic requires at least one non-system message", 400, "invalid_messages");
    }

    const response = await withTimeout(
      this.client.messages.create({
        model: request.model.upstreamModel,
        system: system || undefined,
        messages,
        max_tokens: request.maxTokens ?? 512,
        temperature: request.temperature,
        stream: false,
      }),
      request.timeoutMs,
    );

    const text = extractText(response.content);

    return {
      id: response.id,
      created: Math.floor(Date.now() / 1000),
      model: request.model.canonicalModel,
      message: {
        role: "assistant",
        content: text,
      },
      finishReason: mapFinishReason(response.stop_reason),
      usage: extractUsage({
        input_tokens: response.usage?.input_tokens,
        output_tokens: response.usage?.output_tokens,
      }),
    };
  }
}
