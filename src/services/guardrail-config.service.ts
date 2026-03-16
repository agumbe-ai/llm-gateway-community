import mongoose from "mongoose";
import {
  DEFAULT_GUARDRAIL_POLICY,
  guardrailPolicySchema,
  type GuardrailPolicy,
} from "../types/guardrails";

type GuardrailConfigRecord = {
  tenantId: string;
  appId: string;
  settings: GuardrailPolicy;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
};

type GuardrailConfigDocument = mongoose.Document & GuardrailConfigRecord;

const guardrailConfigSchema = new mongoose.Schema<GuardrailConfigDocument>(
  {
    tenantId: { type: String, required: true, index: true },
    appId: { type: String, required: true, index: true },
    settings: { type: mongoose.Schema.Types.Mixed, required: true },
    updatedBy: { type: String, required: true },
    createdAt: { type: Date, required: true, default: Date.now },
    updatedAt: { type: Date, required: true, default: Date.now },
  },
  {
    collection: "llm_guardrail_configs",
    versionKey: false,
  },
);

guardrailConfigSchema.index({ tenantId: 1, appId: 1 }, { unique: true });

const GuardrailConfigModel =
  (mongoose.models.LLMGuardrailConfig as mongoose.Model<GuardrailConfigDocument> | undefined) ||
  mongoose.model<GuardrailConfigDocument>("LLMGuardrailConfig", guardrailConfigSchema);

function normalizedDefaults() {
  return structuredClone(DEFAULT_GUARDRAIL_POLICY);
}

type CacheEntry = {
  expiresAt: number;
  value: Required<GuardrailPolicy>;
};

export class GuardrailConfigService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly cacheTtlMs = 30_000) {}

  async getPolicy(tenantId: string, appId: string) {
    const key = `${tenantId}:${appId}`;
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return structuredClone(cached.value);
    }

    const document = await GuardrailConfigModel.findOne({ tenantId, appId }).lean<GuardrailConfigRecord | null>();
    const merged = this.normalizeSettings(document?.settings);

    this.cache.set(key, {
      expiresAt: Date.now() + this.cacheTtlMs,
      value: merged,
    });

    return structuredClone(merged);
  }

  async savePolicy(params: {
    tenantId: string;
    appId: string;
    settings: GuardrailPolicy;
    updatedBy: string;
  }) {
    const normalized = this.normalizeSettings(params.settings);
    const now = new Date();

    await GuardrailConfigModel.updateOne(
      { tenantId: params.tenantId, appId: params.appId },
      {
        $set: {
          settings: normalized,
          updatedBy: params.updatedBy,
          updatedAt: now,
        },
        $setOnInsert: {
          tenantId: params.tenantId,
          appId: params.appId,
          createdAt: now,
        },
      },
      { upsert: true },
    );

    this.cache.set(`${params.tenantId}:${params.appId}`, {
      expiresAt: Date.now() + this.cacheTtlMs,
      value: normalized,
    });

    return structuredClone(normalized);
  }

  private normalizeSettings(settings?: GuardrailPolicy | null): Required<GuardrailPolicy> {
    const parsed = guardrailPolicySchema.safeParse(settings || {});
    return {
      ...normalizedDefaults(),
      ...(parsed.success ? parsed.data : {}),
      deniedTopicsList: parsed.success ? parsed.data.deniedTopicsList || [] : [],
      allowedModels: parsed.success ? parsed.data.allowedModels || [] : [],
      maxTokens:
        parsed.success && typeof parsed.data.maxTokens === "number"
          ? parsed.data.maxTokens
          : DEFAULT_GUARDRAIL_POLICY.maxTokens,
      rateLimitPerMinute:
        parsed.success && typeof parsed.data.rateLimitPerMinute === "number"
          ? parsed.data.rateLimitPerMinute
          : DEFAULT_GUARDRAIL_POLICY.rateLimitPerMinute,
    };
  }
}

