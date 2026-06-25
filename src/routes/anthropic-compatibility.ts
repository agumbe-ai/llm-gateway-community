import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import type { ResponsesService } from "../services/responses.service";
import type { ModelResolver } from "../services/model-resolver";
import { normalizeError } from "../utils/errors";
import { countAnthropicTokens } from "../providers/anthropic";

const contentBlockSchema = z.object({ type: z.string() }).passthrough();
const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.union([z.string(), z.array(contentBlockSchema)]),
});
const messagesRequestSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  system: z.union([z.string(), z.array(contentBlockSchema)]).optional(),
  max_tokens: z.number().int().positive(),
  temperature: z.number().optional(),
  tools: z.array(z.record(z.string(), z.unknown())).optional(),
  tool_choice: z.unknown().optional(),
  stream: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

function paths(suffix: string) {
  return [`/api/v1/anthropic/v1/${suffix}`, `/v1/${suffix}`];
}

function authContext(request: any) {
  const user = request.currentUser;
  const userRecord = user as Record<string, unknown>;
  return {
    requestId: request.id,
    userId: user.id,
    tenantId: user.tenant_id,
    email: user.email,
    subjectType: request.authContext?.subjectType || (user.email ? "session" : "app"),
    appId: request.authContext?.appId || readString(userRecord, "app_id"),
    apiKeyId: readString(userRecord, "client_key"),
  } as const;
}

function readString(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? record[key] as string : undefined;
}

function gatewayModel(model: string) {
  return model.startsWith("@") ? model : `@anthropic/${model}`;
}

function systemText(system: unknown) {
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) return undefined;
  const text = system
    .map((part: any) => part?.type === "text" && typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n\n");
  return text || undefined;
}

function toResponsesInput(messages: z.infer<typeof messageSchema>[]) {
  const input: any[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      input.push({ role: message.role, content: message.content });
      continue;
    }

    const textParts = message.content
      .filter((part: any) => part.type === "text" && typeof part.text === "string")
      .map((part: any) => ({ type: message.role === "user" ? "input_text" : "output_text", text: part.text }));
    if (textParts.length) input.push({ role: message.role, content: textParts });

    for (const part of message.content as any[]) {
      if (part.type === "tool_use") {
        input.push({
          type: "function_call",
          id: part.id,
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.input || {}),
        });
      }
      if (part.type === "tool_result") {
        input.push({
          type: "function_call_output",
          call_id: part.tool_use_id,
          output: typeof part.content === "string" ? part.content : JSON.stringify(part.content ?? ""),
        });
      }
    }
  }
  return input;
}

function toResponsesTools(tools: unknown[] | undefined) {
  return tools?.map((tool: any) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema || { type: "object", properties: {} },
  }));
}

function toResponsesToolChoice(choice: any) {
  if (!choice || choice.type === "auto") return "auto";
  if (choice.type === "any") return "required";
  if (choice.type === "none") return "none";
  if (choice.type === "tool") return { type: "function", name: choice.name };
  return "auto";
}

function toResponsesRequest(body: z.infer<typeof messagesRequestSchema>, request: any) {
  return {
    model: gatewayModel(body.model),
    instructions: systemText(body.system),
    input: toResponsesInput(body.messages),
    max_output_tokens: body.max_tokens,
    temperature: body.temperature,
    tools: toResponsesTools(body.tools),
    tool_choice: toResponsesToolChoice(body.tool_choice),
    parallel_tool_calls: true,
    metadata: body.metadata
      ? Object.fromEntries(Object.entries(body.metadata).map(([key, value]) => [key, String(value)]))
      : undefined,
    stream: body.stream === true,
    anthropic_beta:
      typeof request.headers["anthropic-beta"] === "string" ? request.headers["anthropic-beta"] : undefined,
    anthropic_version:
      typeof request.headers["anthropic-version"] === "string" ? request.headers["anthropic-version"] : undefined,
  };
}

function claudeMetadata(request: any) {
  return {
    source_service: "claude-code",
    external_request_id:
      typeof request.headers["x-claude-code-session-id"] === "string"
        ? request.headers["x-claude-code-session-id"]
        : undefined,
  };
}

function anthropicHeaders(request: any) {
  return Object.fromEntries(
    ["anthropic-beta", "anthropic-version"]
      .map((name) => [name, request.headers[name]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function anthropicErrorHandler(error: unknown, _request: unknown, reply: FastifyReply) {
  const normalized = normalizeError(error);
  reply.code(normalized.statusCode).send({
    type: "error",
    error: {
      type: normalized.type,
      message: normalized.message,
    },
  });
}

function responseContent(response: any) {
  if (!Array.isArray(response?.output)) return [];
  const content: any[] = [];
  for (const item of response.output) {
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (typeof part?.text === "string") content.push({ type: "text", text: part.text });
      }
    }
    if (item?.type === "function_call") {
      content.push({
        type: "tool_use",
        id: item.call_id || item.id,
        name: item.name,
        input: parseArguments(item.arguments),
      });
    }
  }
  return content;
}

function parseArguments(value: unknown) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function anthropicResponse(response: any, requestedModel: string) {
  const content = responseContent(response);
  const toolUse = content.some((part) => part.type === "tool_use");
  const usage = response?.usage || {};
  return {
    id: response?.id || `msg_${Date.now()}`,
    type: "message",
    role: "assistant",
    model: requestedModel,
    content,
    stop_reason: toolUse ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: usage.input_tokens || usage.prompt_tokens || 0,
      output_tokens: usage.output_tokens || usage.completion_tokens || 0,
    },
  };
}

function writeEvent(reply: FastifyReply, event: string, data: unknown) {
  reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function streamAnthropic(reply: FastifyReply, events: AsyncIterable<any>, requestedModel: string) {
  const messageId = `msg_${Date.now()}`;
  let nextIndex = 0;
  let outputTokens = 0;
  let stopReason = "end_turn";
  const itemIndexes = new Map<string, number>();

  writeEvent(reply, "message_start", {
    type: "message_start",
    message: {
      id: messageId, type: "message", role: "assistant", model: requestedModel,
      content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0 },
    },
  });

  for await (const event of events) {
    const data = event.data || {};
    if (event.event === "response.output_item.added") {
      const item = data.item || {};
      const index = nextIndex++;
      itemIndexes.set(item.id, index);
      const contentBlock = item.type === "function_call"
        ? { type: "tool_use", id: item.call_id || item.id, name: item.name, input: {} }
        : { type: "text", text: "" };
      writeEvent(reply, "content_block_start", { type: "content_block_start", index, content_block: contentBlock });
    }
    if (event.event === "response.output_text.delta") {
      const index = itemIndexes.get(data.item_id) ?? 0;
      writeEvent(reply, "content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: data.delta || "" } });
    }
    if (event.event === "response.function_call_arguments.delta") {
      const index = itemIndexes.get(data.item_id) ?? 0;
      writeEvent(reply, "content_block_delta", { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: data.delta || "" } });
    }
    if (event.event === "response.output_item.done") {
      const item = data.item || {};
      const index = itemIndexes.get(item.id) ?? Math.max(0, nextIndex - 1);
      if (item.type === "function_call") stopReason = "tool_use";
      writeEvent(reply, "content_block_stop", { type: "content_block_stop", index });
    }
    if (event.event === "response.completed") {
      const usage = data.response?.usage || {};
      outputTokens = usage.output_tokens || usage.completion_tokens || 0;
    }
  }

  writeEvent(reply, "message_delta", {
    type: "message_delta",
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  });
  writeEvent(reply, "message_stop", { type: "message_stop" });
}

function estimatedInputTokens(body: z.infer<typeof messagesRequestSchema>) {
  const text = JSON.stringify({ system: body.system, messages: body.messages, tools: body.tools });
  return Math.max(1, Math.ceil(text.length / 4));
}

export function registerAnthropicCompatibilityRoutes(
  app: FastifyInstance,
  responsesService: ResponsesService,
  modelResolver: ModelResolver,
  requireAuth: (request: any, reply: any) => Promise<void>,
) {
  for (const path of paths("messages")) {
    app.post(path, { preHandler: requireAuth, errorHandler: anthropicErrorHandler }, async (request, reply) => {
      const body = messagesRequestSchema.parse(request.body);
      const translated = { ...toResponsesRequest(body, request), agumbe_metadata: claudeMetadata(request) };
      if (body.stream) {
        const result = await responsesService.createResponseStream(authContext(request), translated);
        reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        reply.raw.setHeader("Cache-Control", "no-cache, no-store, no-transform");
        try {
          await streamAnthropic(reply, result.events, body.model);
        } catch (error) {
          const normalized = normalizeError(error);
          writeEvent(reply, "error", { type: "error", error: { type: normalized.type, message: normalized.message } });
        }
        reply.raw.end();
        return reply;
      }

      const result = await responsesService.createResponse(authContext(request), translated);
      return anthropicResponse(result.response, body.model);
    });
  }

  for (const path of paths("messages/count_tokens")) {
    app.post(path, { preHandler: requireAuth, errorHandler: anthropicErrorHandler }, async (request) => {
      const body = messagesRequestSchema.omit({ max_tokens: true, stream: true }).extend({
        max_tokens: z.number().int().positive().optional(),
      }).parse(request.body);
      if (process.env.ANTHROPIC_API_KEY) {
        const inputTokens = await countAnthropicTokens(process.env.ANTHROPIC_API_KEY, {
          model: body.model,
          system: body.system,
          messages: body.messages,
          tools: body.tools,
        }, 10_000, anthropicHeaders(request));
        return { input_tokens: inputTokens };
      }
      return { input_tokens: estimatedInputTokens({ ...body, max_tokens: body.max_tokens || 1 }) };
    });
  }

  for (const path of paths("models")) {
    app.get(path, { preHandler: requireAuth, errorHandler: anthropicErrorHandler }, async () => ({
      data: modelResolver.listCatalog()
        .filter((model) => model.provider === "anthropic" && model.kind === "chat")
        .map((model) => {
          const id = model.id.startsWith("@anthropic/") ? model.id.slice("@anthropic/".length) : model.id;
          return { id, type: "model", display_name: id, created_at: "1970-01-01T00:00:00Z" };
        }),
      has_more: false,
      first_id: null,
      last_id: null,
    }));
  }
}
