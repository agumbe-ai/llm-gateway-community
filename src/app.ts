import { randomUUID } from "crypto";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Env } from "./config/env";
import { createRequireAuth } from "./middleware/requireAuth";
import { registerChatRoutes } from "./routes/chat";
import { registerEmbeddingsRoutes } from "./routes/embeddings";
import { registerGuardrailRoutes } from "./routes/guardrails";
import { registerHealthRoutes } from "./routes/health";
import { registerModelsRoutes } from "./routes/models";
import { registerRequestRoutes } from "./routes/requests";
import { registerResponsesRoutes } from "./routes/responses";
import { registerAnthropicCompatibilityRoutes } from "./routes/anthropic-compatibility";
import { ChatService } from "./services/chat.service";
import { EmbeddingsService } from "./services/embeddings.service";
import { ResponsesService } from "./services/responses.service";
import { GuardrailConfigService } from "./services/guardrail-config.service";
import { ModelResolver } from "./services/model-resolver";
import { RequestLogService } from "./services/request-log.service";
import { normalizeError, toErrorResponse } from "./utils/errors";
import { loggerOptions } from "./utils/logger";
import { MongoApiKeyService } from "./services/api-key.service";
import { registerApiKeyRoutes } from "./routes/api-keys";

type BuildAppOptions = {
  env: Env;
  chatService: ChatService;
  responsesService: ResponsesService;
  embeddingsService: EmbeddingsService;
  guardrailConfigService: GuardrailConfigService;
  modelResolver: ModelResolver;
  requestLogService: RequestLogService;
};

const CORS_ALLOWED_HEADERS =
  "authorization, content-type, x-api-key, anthropic-version, anthropic-beta, x-claude-code-session-id, x-claude-code-agent-id, x-claude-code-parent-agent-id, x-request-id, x-agumbe-workspace-id, x-agumbe-xnamespace-id, x-agumbe-source-service, x-agumbe-operation, x-agumbe-external-request-id";
const CORS_ALLOWED_METHODS = "GET,HEAD,POST,PUT,OPTIONS";

function applyCorsHeaders(request: FastifyRequest, reply: FastifyReply, allowedOrigins: Set<string>) {
  const origin = request.headers.origin;
  const allowAnyOrigin = allowedOrigins.has("*");
  if (!origin || (!allowAnyOrigin && !allowedOrigins.has(origin))) {
    return false;
  }

  reply.header("Access-Control-Allow-Origin", allowAnyOrigin ? "*" : origin);
  if (!allowAnyOrigin) {
    reply.header("Access-Control-Allow-Credentials", "true");
  }
  reply.header("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  reply.header("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
  reply.header("Vary", "Origin");
  return true;
}

export function buildApp(options: BuildAppOptions) {
  const app = Fastify({
    logger: loggerOptions,
    trustProxy: true,
    requestIdHeader: "x-request-id",
    genReqId: (request) =>
      (typeof request.headers["x-request-id"] === "string" && request.headers["x-request-id"]) ||
      randomUUID(),
  });

  const apiKeyService = options.env.MONGO_URI ? new MongoApiKeyService() : undefined;
  const requireAuth = createRequireAuth(options.env, apiKeyService);
  const allowedOrigins = new Set(options.env.CORS_ALLOWED_ORIGINS);

  app.register(cookie);
  app.register(rateLimit, {
    global: true,
    max: options.env.RATE_LIMIT_MAX,
    timeWindow: options.env.RATE_LIMIT_WINDOW,
    errorResponseBuilder: () => ({
      error: {
        message: "Rate limit exceeded",
        type: "rate_limit_error",
        param: null,
        code: "rate_limit_exceeded",
      },
    }),
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.code(404).send({
      error: {
        message: "Route not found",
        type: "invalid_request_error",
        param: null,
        code: "route_not_found",
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    const normalized = normalizeError(error);

    if (normalized.statusCode >= 500) {
      request.log.error({ err: error }, "request failed");
    } else {
      request.log.warn({ err: error }, "request failed");
    }

    reply.code(normalized.statusCode).send(toErrorResponse(normalized));
  });

  app.addHook("onRequest", async (request, reply) => {
    const corsApplied = applyCorsHeaders(request, reply, allowedOrigins);

    if (request.method === "OPTIONS") {
      if (request.headers.origin && !corsApplied) {
        reply.code(403).send({
          error: {
            message: "Origin not allowed",
            type: "authentication_error",
            param: null,
            code: "cors_origin_denied",
          },
        });
        return;
      }

      reply.code(204).send();
    }
  });

  if (apiKeyService) {
    registerApiKeyRoutes(app, apiKeyService, requireAuth);
  }
  registerHealthRoutes(app, options.env.SERVICE_NAME);
  registerModelsRoutes(app, options.modelResolver);
  registerGuardrailRoutes(app, options.guardrailConfigService, requireAuth);
  registerRequestRoutes(app, options.requestLogService, requireAuth);
  registerChatRoutes(app, options.chatService, requireAuth);
  registerResponsesRoutes(app, options.responsesService, requireAuth);
  registerAnthropicCompatibilityRoutes(
    app,
    options.responsesService,
    options.modelResolver,
    requireAuth,
  );
  registerEmbeddingsRoutes(app, options.embeddingsService, requireAuth);

  return app;
}
