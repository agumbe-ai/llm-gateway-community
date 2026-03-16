import type { FastifyInstance } from "fastify";
import { EmbeddingsService } from "../services/embeddings.service";

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
    async (request) => {
      const currentUser = request.currentUser!;
      return embeddingsService.createEmbeddings(
        {
          requestId: request.id,
          userId: currentUser.id,
          tenantId: currentUser.tenant_id,
          email: currentUser.email,
          bearerToken: request.authToken!,
          subjectType: typeof currentUser.client_key === "string" ? "app" : "session",
          appId:
            typeof currentUser.client_key === "string"
              ? currentUser.client_key
              : typeof currentUser.app_id === "string"
                ? currentUser.app_id
                : undefined,
        },
        request.body,
      );
    },
  );
}
