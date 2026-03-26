import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: {
      subjectType: "session" | "app";
      appId?: string;
    };
    currentUser?: {
      id: string;
      email?: string;
      tenant_id: string;
      tenantId: string;
      isVerified?: boolean;
      isAdmin?: boolean;
      [key: string]: unknown;
    };
  }
}
