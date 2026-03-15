import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance, serviceName: string) {
  app.get("/healthz", async () => ({
    ok: true,
    service: serviceName,
  }));
}
