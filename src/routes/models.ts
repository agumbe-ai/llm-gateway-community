import type { FastifyInstance } from "fastify";
import { ModelResolver } from "../services/model-resolver";

export function registerModelsRoutes(app: FastifyInstance, modelResolver: ModelResolver) {
  app.get("/api/v1/llm/models", async () => ({
    object: "list",
    data: modelResolver.listCatalog(),
  }));
}
