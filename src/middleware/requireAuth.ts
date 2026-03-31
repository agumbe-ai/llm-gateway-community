import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { JwtPayload } from "jsonwebtoken";
import { authError } from "../utils/errors";
import type { Env } from "../config/env";
import type { ApiKeyService } from "../services/api-key.service";

type JwtUserPayload = JwtPayload & {
  id?: string;
  email?: string;
  tenant_id?: string;
  tenantId?: string;
  isVerified?: boolean;
  isAdmin?: boolean;
};

function readBearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization || !authorization.startsWith("Bearer ")) {
    return undefined;
  }

  return authorization.slice("Bearer ".length).trim() || undefined;
}

function readSessionCookieToken(request: FastifyRequest): string | undefined {
  const cookieValue = request.cookies.session;
  if (!cookieValue) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(cookieValue, "base64").toString("utf8");
    const session = JSON.parse(decoded) as { jwt?: unknown };
    return typeof session.jwt === "string" ? session.jwt : undefined;
  } catch {
    return undefined;
  }
}

export function createRequireAuth(env: Env, apiKeyService?: ApiKeyService) {
  return async function requireAuth(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    if (env.AUTH_MODE === "none") {
      request.currentUser = {
        id: env.AUTH_DEFAULT_USER_ID,
        email: undefined,
        tenant_id: env.AUTH_DEFAULT_TENANT_ID,
        tenantId: env.AUTH_DEFAULT_TENANT_ID,
      };
      request.authContext = {
        subjectType: "session",
      };
      return;
    }

    const token = readBearerToken(request) || readSessionCookieToken(request);
    if (!token) {
      throw authError("Missing Bearer token or session cookie");
    }

    if (token.startsWith("agk_")) {
      if (!apiKeyService) {
        throw authError("API key auth is not enabled");
      }

      const apiKey = await apiKeyService.resolve(token);
      if (!apiKey || !apiKey.isActive) {
        throw authError("Invalid API key");
      }

      request.currentUser = {
        id: apiKey.clientId,
        email: undefined,
        tenant_id: apiKey.tenantId,
        tenantId: apiKey.tenantId,
        client_key: apiKey.keyId,
        app_id: apiKey.appId,
      };
      request.authContext = {
        subjectType: "app",
        appId: apiKey.appId,
      };
      return;
    }

    let payload: JwtUserPayload;

    try {
      payload = jwt.verify(token, env.JWT_KEY!) as JwtUserPayload;
    } catch (error: any) {
      if (error?.name === "TokenExpiredError") {
        throw authError("JWT expired");
      }

      throw authError("Invalid JWT");
    }

    const userId = payload.id || payload.sub;
    const tenantId = payload.tenant_id || payload.tenantId;

    if (!userId || !tenantId) {
      throw authError("JWT missing required id or tenant_id claim");
    }

    request.currentUser = {
      ...payload,
      id: String(userId),
      email: payload.email ? String(payload.email) : undefined,
      tenant_id: String(tenantId),
      tenantId: String(tenantId),
      isVerified: payload.isVerified,
      isAdmin: payload.isAdmin,
    };
    request.authContext = {
      subjectType: "session",
    };
  };
}
