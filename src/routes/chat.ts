import type { FastifyInstance } from "fastify";
import { ChatService } from "../services/chat.service";
import {
  decrementInflightRequests,
  incrementInflightRequests,
} from "../telemetry/metrics";
import { withRootSpan } from "../telemetry/tracing";
import { setEstimatedCostHeader, setTimingHeaders } from "../utils/timing";

function readString(record: Record<string, unknown> | undefined, key: string) {
  return typeof record?.[key] === "string" ? record[key] : undefined;
}

export function registerChatRoutes(
  app: FastifyInstance,
  chatService: ChatService,
  requireAuth: (request: any, reply: any) => Promise<void>,
) {
  app.post(
    "/api/v1/llm/chat/completions",
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
        readString(userRecord, "client_key") ||
        readString(userRecord, "app_id");
      const policySet = readString(body, "agumbe_guardrails_app_id") || appId || "default";
      const inflightAttributes = {
        route_kind: "chat",
        request_mode: requestMode,
      };

      incrementInflightRequests(inflightAttributes);

      try {
        return await withRootSpan(
          "gateway.chat.request",
          {
            "http.route": "/api/v1/llm/chat/completions",
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
            const result = await chatService.createCompletion(
              {
                requestId: request.id,
                userId: currentUser.id,
                tenantId: currentUser.tenant_id,
                email: currentUser.email,
                subjectType:
                  request.authContext?.subjectType || (currentUser.email ? "session" : "app"),
                appId,
              },
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
