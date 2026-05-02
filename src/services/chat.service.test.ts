import { AppError } from "../utils/errors";
import type { ChatRequest } from "../types/chat";
import { ChatService, type AuthenticatedRequestContext } from "./chat.service";
import { ModelResolver } from "./model-resolver";
import { ReliabilityService } from "./reliability.service";

const baseContext: AuthenticatedRequestContext = {
  requestId: "req-1",
  userId: "user-1",
  tenantId: "tenant-1",
  subjectType: "session",
  appId: "default",
};

function createChatService(overrides: Partial<ConstructorParameters<typeof ChatService>[0]> = {}) {
  const openAiChat = jest.fn();
  const anthropicChat = jest.fn();
  const deadLetterService = {
    emit: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ChatService({
    providers: {
      openai: { provider: "openai", chat: openAiChat },
      anthropic: { provider: "anthropic", chat: anthropicChat },
      google: { provider: "google" },
    } as any,
    modelResolver: new ModelResolver({
      "smart-default": {
        candidates: [
          { model: "@openai/gpt-4.1-mini", retryAttempts: 1 },
          { model: "@anthropic/claude-sonnet-4", retryAttempts: 1 },
        ],
      },
    }),
    requestLogService: {
      log: jest.fn().mockResolvedValue(undefined),
    } as any,
    usageEmitter: {
      emit: jest.fn().mockResolvedValue(undefined),
    } as any,
    deadLetterService: deadLetterService as any,
    reliabilityService: new ReliabilityService({
      models: {
        "@openai/gpt-4.1-mini": {
          circuitBreaker: {
            failureThreshold: 1,
            cooldownMs: 60_000,
          },
        },
      },
    }),
    guardrailConfigService: {
      getPolicy: jest.fn().mockResolvedValue({}),
    } as any,
    guardrailEnforcer: {
      prepareChatRequest: jest.fn((_context, request: ChatRequest) => ({
        request,
        trace: undefined,
      })),
      inspectChatOutput: jest.fn((_context, content: string) => ({
        content,
        trace: undefined,
      })),
      attachTrace: jest.fn((payload) => payload),
    } as any,
    modelPricing: {},
    requestTimeoutMs: 30_000,
    ...overrides,
  });

  return {
    service,
    openAiChat,
    anthropicChat,
    deadLetterService,
  };
}

test("chat service falls back when the primary provider circuit is open", async () => {
  const reliabilityService = new ReliabilityService({
    models: {
      "@openai/gpt-4.1-mini": {
        circuitBreaker: {
          failureThreshold: 1,
          cooldownMs: 60_000,
        },
      },
    },
  });
  reliabilityService.recordFailure({
    requestedModel: "smart-default",
    canonicalModel: "@openai/gpt-4.1-mini",
    provider: "openai",
    upstreamModel: "gpt-4.1-mini",
    kind: "chat",
    isAlias: false,
  });

  const { service, openAiChat, anthropicChat } = createChatService({
    reliabilityService,
  });
  anthropicChat.mockResolvedValueOnce({
    id: "msg_1",
    created: 1,
    model: "@anthropic/claude-sonnet-4",
    message: { role: "assistant", content: "fallback" },
    finishReason: "stop",
    usage: {
      promptTokens: 12,
      completionTokens: 4,
      totalTokens: 16,
    },
  });

  const result = await service.createCompletion(baseContext, {
    model: "smart-default",
    messages: [{ role: "user", content: "hello" }],
  });

  expect(result.response.model).toBe("@anthropic/claude-sonnet-4");
  expect(openAiChat).not.toHaveBeenCalled();
  expect(anthropicChat).toHaveBeenCalledTimes(1);
});

test("chat service uses model-specific timeout overrides", async () => {
  const { service, openAiChat } = createChatService({
    modelResolver: new ModelResolver(),
    reliabilityService: new ReliabilityService({
      models: {
        "@openai/gpt-4.1-mini": {
          timeoutMs: 10_000,
        },
      },
    }),
  });
  openAiChat.mockResolvedValueOnce({
    id: "msg_1",
    created: 1,
    model: "@openai/gpt-4.1-mini",
    message: { role: "assistant", content: "ok" },
    finishReason: "stop",
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
    },
  });

  await service.createCompletion(baseContext, {
    model: "@openai/gpt-4.1-mini",
    messages: [{ role: "user", content: "hello" }],
  });

  expect(openAiChat).toHaveBeenCalledWith(
    expect.objectContaining({
      timeoutMs: 10_000,
    }),
  );
});

test("chat service emits dead-letter event on terminal provider failure", async () => {
  const { service, openAiChat, deadLetterService } = createChatService({
    modelResolver: new ModelResolver(),
  });
  openAiChat.mockRejectedValueOnce(
    new AppError("provider crashed", {
      statusCode: 502,
      code: "provider_error",
      type: "api_error",
    }),
  );

  await expect(
    service.createCompletion(baseContext, {
      model: "@openai/gpt-4.1-mini",
      messages: [{ role: "user", content: "hello" }],
    }),
  ).rejects.toMatchObject({
    code: "provider_error",
  });

  expect(deadLetterService.emit).toHaveBeenCalledTimes(1);
});
