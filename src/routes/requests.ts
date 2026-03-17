import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RequestLogService } from "../services/request-log.service";

const requestsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(10).max(100).default(25),
  status: z.enum(["success", "error"]).optional(),
  request_kind: z.enum(["chat", "embeddings"]).optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export function registerRequestRoutes(
  app: FastifyInstance,
  requestLogService: RequestLogService,
  requireAuth: (request: any, reply: any) => Promise<void>,
) {
  app.get(
    "/api/v1/llm/requests",
    {
      preHandler: requireAuth,
    },
    async (request) => {
      const currentUser = request.currentUser!;
      const query = requestsQuerySchema.parse(request.query || {});
      const result = await requestLogService.list({
        tenantId: currentUser.tenant_id,
        page: query.page,
        pageSize: query.page_size,
        status: query.status,
        requestKind: query.request_kind,
        model: query.model,
      });

      return {
        data: result.data,
        pagination: result.pagination,
      };
    },
  );
}
