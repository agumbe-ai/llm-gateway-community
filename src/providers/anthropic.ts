import Anthropic from "@anthropic-ai/sdk";
import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderChatStreamResult,
  ProviderResponsesRequest,
  ProviderResponsesResult,
  ProviderResponsesStreamResult,
} from "./types";
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
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_calls";
    default:
      return stopReason ?? null;
  }
}

type AnthropicClient = Pick<Anthropic, "messages" | "models">;
type AnthropicClientFactory = (apiKey: string) => AnthropicClient;

const defaultClientFactory: AnthropicClientFactory = (apiKey) => new Anthropic({ apiKey });

export async function testAnthropicConnection(
  apiKey: string,
  timeoutMs = 10_000,
  clientFactory: AnthropicClientFactory = defaultClientFactory,
) {
  const startedAt = Date.now();
  const client = clientFactory(apiKey);
  const response = await withTimeout((client.models as any).list({ limit: 1 }), timeoutMs);
  const models = Array.isArray((response as any).data) ? (response as any).data : [];

  return {
    ok: true,
    provider: "anthropic" as const,
    latencyMs: Date.now() - startedAt,
    modelCount: models.length,
    testedAt: new Date().toISOString(),
  };
}

export async function countAnthropicTokens(
  apiKey: string,
  payload: Record<string, unknown>,
  timeoutMs = 10_000,
  headers?: Record<string, string>,
  clientFactory: AnthropicClientFactory = defaultClientFactory,
) {
  const response = await withTimeout(
    (clientFactory(apiKey).messages as any).countTokens(
      payload,
      headers && Object.keys(headers).length ? { headers } : undefined,
    ),
    timeoutMs,
  );
  return Number((response as any).input_tokens || 0);
}

export class AnthropicProviderAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;

  constructor(
    private readonly defaultApiKey: string,
    private readonly clientFactory: AnthropicClientFactory = defaultClientFactory,
  ) {}

  private clientFor(request: ProviderChatRequest | ProviderResponsesRequest) {
    return this.clientFactory(request.credential?.apiKey || this.defaultApiKey);
  }

  async chat(request: ProviderChatRequest): Promise<ProviderChatResult> {
    const response = await this.createMessage(request, false);
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

  async chatStream(request: ProviderChatRequest): Promise<ProviderChatStreamResult> {
    const stream = await this.createMessage(request, true);
    return { events: normalizeAnthropicChatStream(stream as any, request.model.canonicalModel) };
  }

  async responses(request: ProviderResponsesRequest): Promise<ProviderResponsesResult> {
    const client = this.clientFor(request);
    const response = await withTimeout(
      client.messages.create(
        buildResponsesPayload(request, false) as any,
        anthropicRequestOptions(request),
      ),
      request.timeoutMs,
    );
    const output = anthropicContentToResponsesOutput((response as any).content);
    const rawResponse = buildCompletedResponse(request, response as any, output);

    return {
      id: (response as any).id,
      created: rawResponse.created_at as number,
      model: request.model.canonicalModel,
      outputText: extractText((response as any).content),
      rawResponse,
      usage: extractUsage({
        input_tokens: (response as any).usage?.input_tokens,
        output_tokens: (response as any).usage?.output_tokens,
      }),
    };
  }

  async responsesStream(request: ProviderResponsesRequest): Promise<ProviderResponsesStreamResult> {
    const client = this.clientFor(request);
    const stream = await withTimeout(
      client.messages.create(
        buildResponsesPayload(request, true) as any,
        anthropicRequestOptions(request),
      ),
      request.timeoutMs,
    );
    return { events: normalizeAnthropicResponsesStream(stream as any, request) };
  }

  private async createMessage(request: ProviderChatRequest, stream: boolean): Promise<any> {
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

    return withTimeout(
      this.clientFor(request).messages.create({
        model: request.model.upstreamModel,
        system: system || undefined,
        messages,
        max_tokens: request.maxOutputTokens ?? request.maxCompletionTokens ?? request.maxTokens ?? 512,
        temperature: request.temperature,
        stream,
      } as any),
      request.timeoutMs,
    );
  }
}

function anthropicRequestOptions(request: ProviderResponsesRequest) {
  const headers: Record<string, string> = {};
  if (request.anthropicBeta) headers["anthropic-beta"] = request.anthropicBeta;
  if (request.anthropicVersion) headers["anthropic-version"] = request.anthropicVersion;
  return Object.keys(headers).length ? { headers } : undefined;
}

function buildResponsesPayload(request: ProviderResponsesRequest, stream: boolean) {
  const messages = responsesInputToAnthropicMessages(request.input);
  if (messages.length === 0) {
    throw providerError("Anthropic requires at least one input message", 400, "invalid_input");
  }
  const tools = request.toolChoice === "none" ? undefined : responsesToolsToAnthropic(request.tools);

  return {
    model: request.model.upstreamModel,
    system: request.instructions || undefined,
    messages,
    max_tokens: request.maxOutputTokens ?? 4096,
    temperature: request.temperature,
    tools,
    tool_choice: responsesToolChoiceToAnthropic(request.toolChoice),
    metadata: request.metadata ? { user_id: request.metadata.user_id } : undefined,
    stream,
  };
}

function responsesInputToAnthropicMessages(input: unknown): Anthropic.MessageParam[] {
  if (typeof input === "string") {
    return [{ role: "user", content: input }];
  }
  if (!Array.isArray(input)) {
    return [];
  }

  const messages: Anthropic.MessageParam[] = [];
  for (const item of input as any[]) {
    if (item?.type === "function_call_output") {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: item.call_id, content: String(item.output ?? "") }],
      } as any);
      continue;
    }
    if (item?.type === "function_call") {
      messages.push({
        role: "assistant",
        content: [{
          type: "tool_use",
          id: item.call_id || item.id,
          name: item.name,
          input: parseJsonObject(item.arguments),
        }],
      } as any);
      continue;
    }
    if (item?.role === "user" || item?.role === "assistant") {
      messages.push({
        role: item.role,
        content: normalizeResponsesContent(item.content),
      } as any);
    }
  }
  return messages;
}

function normalizeResponsesContent(content: unknown): any {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part: any) => {
      if (typeof part === "string") return { type: "text", text: part };
      if (["input_text", "output_text", "text"].includes(part?.type) && typeof part.text === "string") {
        return { type: "text", text: part.text };
      }
      return null;
    })
    .filter(Boolean);
}

function responsesToolsToAnthropic(tools: unknown) {
  if (!Array.isArray(tools)) return undefined;
  const mapped = tools
    .filter((tool: any) => tool?.type === "function" && typeof tool.name === "string")
    .map((tool: any) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters || { type: "object", properties: {} },
    }));
  return mapped.length ? mapped : undefined;
}

function responsesToolChoiceToAnthropic(choice: unknown) {
  if (choice === "auto" || choice === undefined) return undefined;
  if (choice === "required") return { type: "any" };
  if (choice === "none") return undefined;
  if (choice && typeof choice === "object" && (choice as any).name) {
    return { type: "tool", name: (choice as any).name };
  }
  return undefined;
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function anthropicContentToResponsesOutput(content: unknown): any[] {
  if (!Array.isArray(content)) return [];
  const output: any[] = [];
  const text = extractText(content);
  if (text) {
    output.push({
      id: `msg_${Date.now()}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    });
  }
  for (const part of content as any[]) {
    if (part?.type === "tool_use") {
      output.push({
        id: part.id,
        type: "function_call",
        status: "completed",
        call_id: part.id,
        name: part.name,
        arguments: JSON.stringify(part.input || {}),
      });
    }
  }
  return output;
}

function buildCompletedResponse(request: ProviderResponsesRequest, response: any, output: any[]) {
  return {
    id: response.id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: request.model.canonicalModel,
    output,
    usage: {
      input_tokens: response.usage?.input_tokens || 0,
      output_tokens: response.usage?.output_tokens || 0,
      total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0),
    },
  };
}

async function* normalizeAnthropicChatStream(stream: AsyncIterable<any>, model: string) {
  const id = `chatcmpl_${Date.now()}`;
  const created = Math.floor(Date.now() / 1000);
  let inputTokens = 0;
  let outputTokens = 0;
  let finishReason: string | null = null;

  for await (const event of stream) {
    if (event.type === "message_start") inputTokens = event.message?.usage?.input_tokens || 0;
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      yield {
        data: {
          id, object: "chat.completion.chunk", created, model,
          choices: [{ index: 0, delta: { content: event.delta.text }, finish_reason: null }],
        },
      };
    }
    if (event.type === "message_delta") {
      outputTokens = event.usage?.output_tokens || outputTokens;
      finishReason = mapFinishReason(event.delta?.stop_reason);
    }
  }

  yield {
    data: {
      id, object: "chat.completion.chunk", created, model,
      choices: [{ index: 0, delta: {}, finish_reason: finishReason || "stop" }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
    },
  };
}

async function* normalizeAnthropicResponsesStream(
  stream: AsyncIterable<any>,
  request: ProviderResponsesRequest,
) {
  const responseId = `resp_${Date.now()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const output: any[] = [];
  const blocks = new Map<number, any>();
  let inputTokens = 0;
  let outputTokens = 0;

  yield {
    event: "response.created",
    data: { type: "response.created", response: { id: responseId, object: "response", created_at: createdAt, status: "in_progress", model: request.model.canonicalModel, output: [] } },
  };

  for await (const event of stream) {
    if (event.type === "message_start") inputTokens = event.message?.usage?.input_tokens || 0;
    if (event.type === "content_block_start") {
      const block = event.content_block;
      const item = block?.type === "tool_use"
        ? { id: block.id, type: "function_call", status: "in_progress", call_id: block.id, name: block.name, arguments: "" }
        : { id: `msg_${responseId}_${event.index}`, type: "message", status: "in_progress", role: "assistant", content: [] };
      blocks.set(event.index, { block, item, text: "", arguments: "" });
      yield { event: "response.output_item.added", data: { type: "response.output_item.added", output_index: output.length, item } };
    }
    if (event.type === "content_block_delta") {
      const state = blocks.get(event.index);
      if (event.delta?.type === "text_delta") {
        state.text += event.delta.text;
        yield { event: "response.output_text.delta", data: { type: "response.output_text.delta", item_id: state.item.id, output_index: output.length, content_index: 0, delta: event.delta.text } };
      }
      if (event.delta?.type === "input_json_delta") {
        state.arguments += event.delta.partial_json;
        yield { event: "response.function_call_arguments.delta", data: { type: "response.function_call_arguments.delta", item_id: state.item.id, output_index: output.length, delta: event.delta.partial_json } };
      }
    }
    if (event.type === "content_block_stop") {
      const state = blocks.get(event.index);
      if (!state) continue;
      const item = state.block?.type === "tool_use"
        ? { ...state.item, status: "completed", arguments: state.arguments || "{}" }
        : { ...state.item, status: "completed", content: [{ type: "output_text", text: state.text, annotations: [] }] };
      output.push(item);
      yield { event: "response.output_item.done", data: { type: "response.output_item.done", output_index: output.length - 1, item } };
    }
    if (event.type === "message_delta") outputTokens = event.usage?.output_tokens || outputTokens;
  }

  const response = {
    id: responseId, object: "response", created_at: createdAt, status: "completed",
    model: request.model.canonicalModel, output,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
  };
  yield { event: "response.completed", data: { type: "response.completed", response } };
}
