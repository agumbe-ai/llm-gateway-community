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
        },
        request.body,
      );
    },
  );
}
