import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MongoApiKeyService } from "../services/api-key.service";
import { AppError } from "../utils/errors";

const createApiKeyBodySchema = z.object({
  tenantId: z.string().min(1),
  clientId: z.string().min(1),
  appId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  scopes: z.array(z.string().min(1)).optional(),
});

const revokeApiKeyParamsSchema = z.object({
  keyId: z.string().min(1),
});

export function registerApiKeyRoutes(
  app: FastifyInstance,
  apiKeyService: MongoApiKeyService,
  requireAuth: (request: any, reply: any) => Promise<void>,
) {
  app.post(
    "/api/v1/internal/api-keys",
    { preHandler: requireAuth },
    async (request) => {
      const user = request.currentUser;
      if (!user?.isAdmin) {
        throw new AppError("Admin access required", {
          statusCode: 403,
          code: "forbidden",
          type: "authentication_error",
        });
      }

      const body = createApiKeyBodySchema.parse(request.body);
      const created = await apiKeyService.create(body);

      return {
        key_id: created.keyId,
        api_key: created.token,
        scope: body.appId ? "app" : "tenant",
        app_id: created.appId ?? null,
      };
    },
  );

  app.delete(
    "/api/v1/internal/api-keys/:keyId",
    { preHandler: requireAuth },
    async (request) => {
      const user = request.currentUser;
      if (!user?.isAdmin) {
        throw new AppError("Admin access required", {
          statusCode: 403,
          code: "forbidden",
          type: "authentication_error",
        });
      }

      const params = revokeApiKeyParamsSchema.parse(request.params);
      await apiKeyService.revoke(params.keyId);

      return { ok: true };
    },
  );
}