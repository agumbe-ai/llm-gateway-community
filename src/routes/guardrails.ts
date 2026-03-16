import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { guardrailPolicySchema } from "../types/guardrails";
import { AppError } from "../utils/errors";
import { GuardrailConfigService } from "../services/guardrail-config.service";

const getGuardrailsQuerySchema = z.object({
  app_id: z.string().trim().min(1).optional(),
});

const updateGuardrailsBodySchema = z.object({
  app_id: z.string().trim().min(1),
  settings: guardrailPolicySchema,
});

export function registerGuardrailRoutes(
  app: FastifyInstance,
  guardrailConfigService: GuardrailConfigService,
  requireAuth: (request: any, reply: any) => Promise<void>,
) {
  app.get(
    "/api/v1/llm/guardrails",
    {
      preHandler: requireAuth,
    },
    async (request) => {
      const currentUser = request.currentUser!;
      const query = getGuardrailsQuerySchema.parse(request.query || {});
      const appId = query.app_id || "default";

      const settings = await guardrailConfigService.getPolicy(currentUser.tenant_id, appId);

      return {
        data: {
          app_id: appId,
          settings,
        },
      };
    },
  );

  app.put(
    "/api/v1/llm/guardrails",
    {
      preHandler: requireAuth,
    },
    async (request) => {
      const currentUser = request.currentUser!;
      if (typeof currentUser.client_key === "string") {
        throw new AppError("App tokens cannot update guardrail policies", {
          statusCode: 403,
          code: "guardrail_policy_forbidden",
          type: "authentication_error",
        });
      }

      const body = updateGuardrailsBodySchema.parse(request.body || {});
      const settings = await guardrailConfigService.savePolicy({
        tenantId: currentUser.tenant_id,
        appId: body.app_id,
        settings: body.settings,
        updatedBy: currentUser.id,
      });

      return {
        data: {
          app_id: body.app_id,
          settings,
        },
      };
    },
  );
}
