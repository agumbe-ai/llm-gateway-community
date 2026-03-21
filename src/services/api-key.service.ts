import crypto from "crypto";
import mongoose, { Schema, type InferSchemaType, type Model } from "mongoose";

export type ResolvedApiKey = {
  keyId: string;
  tenantId: string;
  clientId: string;
  appId?: string;
  isActive: boolean;
  name?: string;
  scopes?: string[];
};

type ApiKeyDocument = InferSchemaType<typeof apiKeySchema>;

const apiKeySchema = new Schema(
  {
    keyId: { type: String, required: true, unique: true, index: true },
    secretHash: { type: String, required: true },
    tenantId: { type: String, required: true, index: true },
    clientId: { type: String, required: true, index: true },
    appId: { type: String, index: true },
    name: { type: String },
    scopes: [{ type: String }],
    isActive: { type: Boolean, default: true, index: true },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    collection: "api_keys",
  },
);

const ApiKeyModel: Model<ApiKeyDocument> =
  (mongoose.models.ApiKey as Model<ApiKeyDocument>) ||
  mongoose.model<ApiKeyDocument>("ApiKey", apiKeySchema);

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

function randomId(bytes = 9): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

export type CreatedApiKey = {
  keyId: string;
  token: string;
  appId?: string;
};

export class MongoApiKeyService {
  async create(params: {
    tenantId: string;
    clientId: string;
    appId?: string;
    name?: string;
    scopes?: string[];
  }): Promise<CreatedApiKey> {
    const keyId = randomId();
    const secret = randomToken();
    const token = `agk_${keyId}.${secret}`;

    await ApiKeyModel.create({
      keyId,
      secretHash: sha256(secret),
      tenantId: params.tenantId,
      clientId: params.clientId,
      appId: params.appId,
      name: params.name,
      scopes: params.scopes ?? [],
      isActive: true,
    });

    return {
      keyId,
      token,
      appId: params.appId,
    };
  }

  async resolve(token: string): Promise<ResolvedApiKey | null> {
    const parsed = this.parse(token);
    if (!parsed) return null;

    const doc = await ApiKeyModel.findOne({
      keyId: parsed.keyId,
      isActive: true,
      revokedAt: null,
    }).lean();

    if (!doc) return null;
    if (doc.secretHash !== sha256(parsed.secret)) return null;

    await ApiKeyModel.updateOne(
      { keyId: parsed.keyId },
      { $set: { lastUsedAt: new Date() } },
    ).catch(() => undefined);

    return {
      keyId: doc.keyId,
      tenantId: doc.tenantId,
      clientId: doc.clientId,
      appId: doc.appId ?? undefined,
      isActive: doc.isActive,
      name: doc.name ?? undefined,
      scopes: doc.scopes ?? [],
    };
  }

  async revoke(keyId: string): Promise<void> {
    await ApiKeyModel.updateOne(
      { keyId },
      { $set: { isActive: false, revokedAt: new Date() } },
    );
  }

  private parse(token: string): { keyId: string; secret: string } | null {
    if (!token.startsWith("agk_")) return null;
    const dot = token.indexOf(".");
    if (dot === -1) return null;

    const keyId = token.slice(4, dot).trim();
    const secret = token.slice(dot + 1).trim();

    if (!keyId || !secret) return null;

    return { keyId, secret };
  }
}

export type ApiKeyService = Pick<MongoApiKeyService, "resolve">;