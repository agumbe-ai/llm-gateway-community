import OpenAI from "openai";
import type {
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
import { extractUsage } from "../utils/usage";
import { withTimeout } from "../utils/timeout";

function isGpt5Model(model: string) {
  return /^gpt-5(\.|-|$)/i.test(model);
}

export async function testOpenAIConnection(apiKey: string, timeoutMs = 10_000) {
  const startedAt = Date.now();
  const client = new OpenAI({ apiKey });
  const response = await withTimeout(client.models.list(), timeoutMs);
  const models = Array.isArray((response as any).data) ? (response as any).data : [];

  return {
    ok: true,
    provider: "openai" as const,
    latencyMs: Date.now() - startedAt,
    modelCount: models.length,
    testedAt: new Date().toISOString(),
  };
}

export class OpenAIProviderAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;
  private readonly defaultApiKey: string;

  constructor(apiKey: string) {
    this.defaultApiKey = apiKey;
  }

  private clientFor(request: ProviderChatRequest | ProviderEmbeddingsRequest | ProviderResponsesRequest) {
    return new OpenAI({ apiKey: request.credential?.apiKey || this.defaultApiKey });
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const client = this.clientFor(request);
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
          client.chat.completions.create(payload as any),
          request.timeoutMs,
        );
      };

    if (isGpt5Model(request.model.upstreamModel) && !needsStructuredOutput) {
      const response = await withTimeout(
        client.responses.create({
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

  async chatStream(request: ProviderChatRequest): Promise<ProviderChatStreamResult> {
    const client = this.clientFor(request);

    if (isGpt5Model(request.model.upstreamModel) && !request.responseFormat) {
      const stream = await withTimeout(
        client.responses.create({
          model: request.model.upstreamModel,
          input: request.messages.map((message) => ({
            role: message.role as any,
            content: [{ type: "input_text", text: message.content }],
          })),
          max_output_tokens:
            request.maxOutputTokens ?? request.maxCompletionTokens ?? request.maxTokens,
          stream: true,
        } as any),
        request.timeoutMs,
      );

      return {
        events: normalizeResponsesAsChatStream(
          stream as unknown as AsyncIterable<Record<string, unknown>>,
          request.model.canonicalModel,
        ),
      };
    }

    const stream = await withTimeout(
      client.chat.completions.create({
        model: request.model.upstreamModel,
        messages: request.messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        max_completion_tokens: request.maxCompletionTokens ?? request.maxTokens,
        temperature: request.temperature,
        stream: true,
        stream_options: { include_usage: true },
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
    const payload = buildResponsesPayload(request);

    const response = await withTimeout(
      client.responses.create(payload as any),
      request.timeoutMs,
    );
    const rawResponse = response as unknown as Record<string, unknown>;
    const outputText =
      typeof (response as any).output_text === "string"
        ? (response as any).output_text
        : extractResponseOutputText((response as any).output);

    return {
      id: response.id,
      created: typeof (response as any).created_at === "number"
        ? (response as any).created_at
        : Math.floor(Date.now() / 1000),
      model: request.model.canonicalModel,
      outputText,
      rawResponse,
      usage: extractUsage(response.usage),
    };
  }

  async responsesStream(request: ProviderResponsesRequest): Promise<ProviderResponsesStreamResult> {
    const client = this.clientFor(request);
    const stream = await withTimeout(
      client.responses.create({
        ...buildResponsesPayload(request),
        stream: true,
      } as any),
      request.timeoutMs,
    );

    return {
      events: normalizeOpenAIResponsesStream(stream as unknown as AsyncIterable<Record<string, unknown>>),
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

function buildResponsesPayload(request: ProviderResponsesRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    model: request.model.upstreamModel,
    input: request.input,
    instructions: request.instructions,
    previous_response_id: request.previousResponseId,
    max_output_tokens: request.maxOutputTokens,
    temperature: request.temperature,
    tools: request.tools,
    tool_choice: request.toolChoice,
    parallel_tool_calls: request.parallelToolCalls,
    include: request.include,
    reasoning: request.reasoning,
    store: request.store,
    prompt_cache_key: request.promptCacheKey,
    service_tier: request.serviceTier,
    client_metadata: request.clientMetadata,
    metadata: request.metadata,
  };

  if (request.text) {
    payload.text = request.text;
  } else if (request.responseFormat) {
    payload.text = {
      format:
        request.responseFormat.type === "json_object"
          ? { type: "json_object" }
          : {
              type: "json_schema",
              ...request.responseFormat.json_schema,
            },
    };
  }

  return payload;
}

async function* normalizeOpenAIResponsesStream(
  stream: AsyncIterable<Record<string, unknown>>,
) {
  for await (const event of stream) {
    yield {
      event: typeof event.type === "string" ? event.type : "message",
      data: event,
    };
  }
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

async function* normalizeResponsesAsChatStream(
  stream: AsyncIterable<Record<string, unknown>>,
  model: string,
) {
  const id = `chatcmpl_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);

  for await (const event of stream) {
    if (event.type === "response.output_text.delta" && typeof event.delta === "string") {
      yield {
        data: {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: { content: event.delta }, finish_reason: null }],
        },
      };
    }

    if (event.type === "response.completed") {
      const response =
        event.response && typeof event.response === "object"
          ? event.response as Record<string, unknown>
          : {};
      yield {
        data: {
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: response.usage,
        },
      };
    }
  }
}

function extractResponseOutputText(output: unknown): string {
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
    .map((part: any) => {
      if (typeof part?.text === "string") {
        return part.text;
      }
      if (typeof part?.content === "string") {
        return part.content;
      }
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
