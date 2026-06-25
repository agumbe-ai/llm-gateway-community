import OpenAI from "openai";
import type {
  ChatMessage,
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderChatStreamResult,
  ProviderEmbeddingsRequest,
  ProviderEmbeddingsResult,
  ProviderResponsesRequest,
  ProviderResponsesResult,
  ProviderResponsesStreamResult,
} from "./types";
import { providerError } from "../utils/errors";
import { withTimeout } from "../utils/timeout";
import { extractUsage } from "../utils/usage";

const DEFAULT_GEMINI_OPENAI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/";

type GeminiOpenAIClient = OpenAI;
type GeminiClientFactory = (apiKey: string, baseURL: string) => GeminiOpenAIClient;

const defaultClientFactory: GeminiClientFactory = (apiKey, baseURL) => new OpenAI({ apiKey, baseURL });

export async function testGeminiConnection(
  apiKey: string,
  timeoutMs = 10_000,
  clientFactory: GeminiClientFactory = defaultClientFactory,
  baseURL = process.env.GEMINI_OPENAI_COMPAT_BASE_URL || DEFAULT_GEMINI_OPENAI_BASE_URL,
) {
  const startedAt = Date.now();
  const client = clientFactory(apiKey, baseURL);
  const response = await withTimeout(client.models.list(), timeoutMs);
  const models = Array.isArray((response as any).data) ? (response as any).data : [];

  return {
    ok: true,
    provider: "google" as const,
    latencyMs: Date.now() - startedAt,
    modelCount: models.length,
    testedAt: new Date().toISOString(),
  };
}

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly provider = "google" as const;
  private readonly baseURL: string;

  constructor(
    private readonly apiKey?: string,
    baseURL = process.env.GEMINI_OPENAI_COMPAT_BASE_URL || DEFAULT_GEMINI_OPENAI_BASE_URL,
    private readonly clientFactory: GeminiClientFactory = defaultClientFactory,
  ) {
    this.baseURL = baseURL;
  }

  private clientFor(request: ProviderChatRequest | ProviderEmbeddingsRequest | ProviderResponsesRequest) {
    const apiKey = request.credential?.apiKey || this.apiKey;
    if (!apiKey) {
      throw providerError("Gemini provider credential is not configured", 400, "provider_credential_missing");
    }

    return this.clientFactory(apiKey, this.baseURL);
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const client = this.clientFor(request);
    const response = await withTimeout(
      client.chat.completions.create(buildChatPayload(request) as any),
      request.timeoutMs,
    );
    const choice = response.choices[0];

    return {
      id: response.id,
      created: response.created,
      model: request.model.canonicalModel,
      message: {
        role: "assistant",
        content: extractMessageContent(choice?.message?.content),
      },
      finishReason: normalizeFinishReason(choice?.finish_reason),
      usage: extractUsage(response.usage),
    };
  }

  async chatStream(request: ProviderChatRequest): Promise<ProviderChatStreamResult> {
    const client = this.clientFor(request);
    const stream = await withTimeout(
      client.chat.completions.create({
        ...buildChatPayload(request),
        stream: true,
      } as any),
      request.timeoutMs,
    );

    return {
      events: normalizeChatCompletionsStream(
        stream as unknown as AsyncIterable<Record<string, unknown>>,
        request.model.canonicalModel,
      ),
    };
  }

  async responses(request: ProviderResponsesRequest): Promise<ProviderResponsesResult> {
    const client = this.clientFor(request);
    const messages = responsesInputToMessages(request);
    const response = await withTimeout(
      client.chat.completions.create({
        model: request.model.upstreamModel,
        messages,
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        tools: request.tools,
        tool_choice: request.toolChoice,
        response_format: responseFormatForChatCompletions(request),
      } as any),
      request.timeoutMs,
    );
    const choice = response.choices[0];
    const outputText = extractMessageContent(choice?.message?.content);

    return {
      id: response.id,
      created: response.created,
      model: request.model.canonicalModel,
      outputText,
      rawResponse: {
        id: response.id,
        object: "response",
        created_at: response.created,
        model: request.model.canonicalModel,
        output_text: outputText,
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: outputText }],
          },
        ],
        finish_reason: normalizeFinishReason(choice?.finish_reason),
        usage: response.usage,
        provider_metadata: {
          provider: "google",
          compatibilityMode: "openai",
        },
      },
      usage: extractUsage(response.usage),
    };
  }

  async responsesStream(request: ProviderResponsesRequest): Promise<ProviderResponsesStreamResult> {
    const client = this.clientFor(request);
    const stream = await withTimeout(
      client.chat.completions.create({
        model: request.model.upstreamModel,
        messages: responsesInputToMessages(request),
        max_tokens: request.maxOutputTokens,
        temperature: request.temperature,
        tools: request.tools,
        tool_choice: request.toolChoice,
        response_format: responseFormatForChatCompletions(request),
        stream: true,
      } as any),
      request.timeoutMs,
    );

    return {
      events: normalizeChatStreamAsResponses(
        stream as unknown as AsyncIterable<Record<string, unknown>>,
        request.model.canonicalModel,
      ),
    };
  }

  async embeddings(request: ProviderEmbeddingsRequest): Promise<ProviderEmbeddingsResult> {
    const client = this.clientFor(request);
    const response = await withTimeout(
      client.embeddings.create({
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

function buildChatPayload(request: ProviderChatRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: request.model.upstreamModel,
    messages: request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    max_tokens: request.maxTokens ?? request.maxCompletionTokens ?? request.maxOutputTokens,
    temperature: request.temperature,
  };

  const responseFormat = responseFormatForChatCompletions(request);
  if (responseFormat) {
    payload.response_format = responseFormat;
  }

  return omitUndefined(payload);
}

function responseFormatForChatCompletions(
  request: { responseFormat?: ProviderChatRequest["responseFormat"]; text?: unknown },
) {
  if ("text" in request && request.text && typeof request.text === "object") {
    const format = (request.text as any).format;
    if (format) return format;
  }
  if (!request.responseFormat) return undefined;
  if (request.responseFormat.type === "json_object") {
    return { type: "json_object" };
  }
  return {
    type: "json_schema",
    json_schema: request.responseFormat.json_schema,
  };
}

function omitUndefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function extractMessageContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeFinishReason(reason: unknown) {
  if (typeof reason !== "string") return null;
  const normalized = reason.toLowerCase();
  if (normalized === "max_tokens") return "length";
  if (normalized === "safety" || normalized === "recitation" || normalized === "content_filter") {
    return "content_filter";
  }
  if (normalized === "stop" || normalized === "length" || normalized === "tool_calls") {
    return normalized;
  }
  return normalized;
}

function responsesInputToMessages(request: ProviderResponsesRequest): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (request.instructions) {
    messages.push({ role: "system", content: request.instructions });
  }

  if (typeof request.input === "string") {
    messages.push({ role: "user", content: request.input });
    return messages;
  }

  if (Array.isArray(request.input)) {
    for (const item of request.input) {
      if (typeof item === "string") {
        messages.push({ role: "user", content: item });
        continue;
      }
      if (!item || typeof item !== "object") {
        continue;
      }

      const record = item as Record<string, any>;
      const role = normalizeMessageRole(record.role);
      const content = extractResponsesInputText(record.content ?? record.text ?? record.output);
      if (content) {
        messages.push({ role, content });
      }
    }
  }

  if (messages.length === 0 || messages.every((message) => message.role === "system")) {
    messages.push({ role: "user", content: "" });
  }

  return messages;
}

function normalizeMessageRole(role: unknown): ChatMessage["role"] {
  return role === "assistant" || role === "system" ? role : "user";
}

function extractResponsesInputText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((part: any) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function* normalizeChatCompletionsStream(
  stream: AsyncIterable<Record<string, unknown>>,
  model: string,
) {
  for await (const chunk of stream) {
    yield {
      data: {
        ...chunk,
        model,
      },
    };
  }
}

async function* normalizeChatStreamAsResponses(
  stream: AsyncIterable<Record<string, unknown>>,
  model: string,
) {
  const id = `resp_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let outputText = "";
  let usage: unknown;

  yield {
    event: "response.created",
    data: {
      id,
      object: "response",
      created_at: created,
      model,
      status: "in_progress",
    },
  };

  for await (const chunk of stream) {
    usage = (chunk as any).usage || usage;
    const choices = Array.isArray((chunk as any).choices) ? (chunk as any).choices : [];
    const delta = choices[0]?.delta?.content;
    if (typeof delta === "string" && delta) {
      outputText += delta;
      yield {
        event: "response.output_text.delta",
        data: { delta },
      };
    }
  }

  yield {
    event: "response.completed",
    data: {
      response: {
        id,
        object: "response",
        created_at: created,
        model,
        status: "completed",
        output_text: outputText,
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: outputText }],
          },
        ],
        usage,
      },
    },
  };
}
