import type { FastifyInstance } from "fastify";
import { EmbeddingsService } from "../services/embeddings.service";
import { setTimingHeaders } from "../utils/timing";

export function registerEmbeddingsRoutes(
  app: FastifyInstance,
  embeddingsService: EmbeddingsService,
  requireAuth: (request: any, reply: any) => Promise<void>,
) {
  app.post(
    "/api/v1/llm/embeddings",
    {
      preHandler: requireAuth,
    },
    async (request, reply) => {
      const currentUser = request.currentUser!;
      const result = await embeddingsService.createEmbeddings(
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
      setTimingHeaders(reply, result.timings);
      return result.response;
    },
  );
}
