import type { FastifyInstance } from "fastify";
import { ResponsesService } from "../services/responses.service";
import {
  decrementInflightRequests,
  incrementInflightRequests,
} from "../telemetry/metrics";
import { withRootSpan } from "../telemetry/tracing";
import { setEstimatedCostHeader, setTimingHeaders } from "../utils/timing";
import { normalizeError } from "../utils/errors";

function readString(record: Record<string, unknown> | undefined, key: string) {
  return typeof record?.[key] === "string" ? record[key] : undefined;
}

function serializeSse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function serializeSseComment(comment: string) {
  return `: ${comment}\n\n`;
}

function responsesErrorEvent(error: ReturnType<typeof normalizeError>) {
  return {
    type: "error",
    code: error.code,
    message: error.message,
    param: error.param ?? null,
    sequence_number: 0,
  };
}

export function registerResponsesRoutes(
  app: FastifyInstance,
  responsesService: ResponsesService,
  requireAuth: (request: any, reply: any) => Promise<void>,
) {
  app.post(
    "/api/v1/llm/responses",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      const body =
        request.body && typeof request.body === "object"
          ? (request.body as Record<string, unknown>)
          : undefined;
      const metadata =
        body?.agumbe_metadata && typeof body.agumbe_metadata === "object"
          ? (body.agumbe_metadata as Record<string, unknown>)
          : undefined;
      const requestMode = body?.stream === true ? "stream" : "sync";
      const userRecord = currentUser as Record<string, unknown>;
      const appId =
        request.authContext?.appId ||
        readString(userRecord, "app_id") ||
        readString(userRecord, "client_key");
      const policySet = readString(body, "agumbe_guardrails_app_id") || appId || "default";
      const inflightAttributes = {
        route_kind: "responses",
        request_mode: requestMode,
      };

      incrementInflightRequests(inflightAttributes);

      try {
        return await withRootSpan(
          "gateway.responses.request",
          {
            "http.route": "/api/v1/llm/responses",
            "http.method": request.method,
            "request.id": request.id,
            "gen_ai.request.model": readString(body, "model"),
            "request.mode": requestMode,
            "agumbe.tenant_id": currentUser.tenant_id,
            "agumbe.workspace_id": readString(metadata, "workspace_id"),
            "agumbe.app_id": appId,
            "agumbe.api_key_id": readString(userRecord, "client_key"),
            "agumbe.policy_set": policySet,
          },
          async () => {
            const context = {
              requestId: request.id,
              userId: currentUser.id,
              tenantId: currentUser.tenant_id,
              email: currentUser.email,
              subjectType:
                request.authContext?.subjectType || (currentUser.email ? "session" : "app"),
              appId,
              apiKeyId: readString(userRecord, "client_key"),
            };

            if (requestMode === "stream") {
              const result = await responsesService.createResponseStream(
                context,
                request.body,
              );

              reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
              reply.raw.setHeader("Cache-Control", "no-cache, no-store, no-transform");
              reply.raw.setHeader("Connection", "keep-alive");
              reply.raw.setHeader("X-Accel-Buffering", "no");

              reply.raw.write(serializeSseComment("stream-open"));
              const heartbeat = setInterval(() => {
                reply.raw.write(serializeSseComment("heartbeat"));
              }, 10_000);

              try {
                for await (const event of result.events) {
                  reply.raw.write(serializeSse(event.event, event.data));
                }
                reply.raw.write("data: [DONE]\n\n");
              } catch (error) {
                const normalized = normalizeError(error);
                request.log.error(
                  { err: error, errorCode: normalized.code },
                  "responses stream failed",
                );
                reply.raw.write(serializeSse("error", responsesErrorEvent(normalized)));
              } finally {
                clearInterval(heartbeat);
                reply.raw.end();
              }

              return reply;
            }

            const result = await responsesService.createResponse(
              context,
              request.body,
            );

            setTimingHeaders(reply, result.timings);
            setEstimatedCostHeader(reply, result.estimatedCostUsd);
            return result.response;
          },
        );
      } finally {
        decrementInflightRequests(inflightAttributes);
      }
    },
  );
}
