import type { FastifyInstance } from "fastify";
import { ChatService } from "../services/chat.service";

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
    async (request) => {
      const currentUser = request.currentUser!;
      return chatService.createCompletion(
        {
          requestId: request.id,
          userId: currentUser.id,
          tenantId: currentUser.tenant_id,
          email: currentUser.email,
          subjectType:
            request.authContext?.subjectType ||
              (currentUser.email ? "session" : "app"),
          appId:
            request.authContext?.appId ||
            (typeof currentUser.client_key === "string"
              ? currentUser.client_key
              : typeof currentUser.app_id === "string"
                ? currentUser.app_id
                : undefined),
        },
        request.body,
      );
    },
  );
}
