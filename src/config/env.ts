import "dotenv/config";
import { z } from "zod";

const booleanString = z
  .string()
  .optional()
  .transform((value) => {
    if (value === undefined) {
      return undefined;
    }
    return value.toLowerCase() === "true";
  });

const pricingSchema = z.record(
  z.object({
    promptPer1kUsd: z.number().nonnegative(),
    completionPer1kUsd: z.number().nonnegative(),
  }),
);

export type ModelPricing = z.infer<typeof pricingSchema>;

export type Env = {
  PORT: number;
  SERVICE_NAME: string;
  LOG_LEVEL: string;
  CORS_ALLOWED_ORIGINS: string[];
  MONGO_URI: string;
  JWT_KEY: string;
  KAFKA_ENABLED: boolean;
  KAFKA_BROKERS: string[];
  KAFKA_CLIENT_ID: string;
  KAFKA_TOPIC_USAGE: string;
  KAFKA_PROTOCOL?: string;
  KAFKA_MECHANISMS?: string;
  KAFKA_USERNAME?: string;
  KAFKA_PASSWORD?: string;
  KAFKA_TIMEOUT_MS: number;
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
  GOOGLE_API_KEY?: string;
  REQUEST_TIMEOUT_MS: number;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_WINDOW: string;
  STORE_LLM_PAYLOADS: boolean;
  MODEL_PRICING: ModelPricing;
};

function splitCsv(value?: string): string[] {
  return (value || "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function parsePricing(value?: string): ModelPricing {
  if (!value || !value.trim()) {
    return {};
  }

  const parsed = JSON.parse(value);
  return pricingSchema.parse(parsed);
}

export function getEnv(): Env {
  const schema = z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    SERVICE_NAME: z.string().default("llm-gateway"),
    LOG_LEVEL: z.string().default("info"),
    CORS_ALLOWED_ORIGINS: z.string().default("https://agumbe.ai"),
    MONGO_URI: z.string().min(1, "MONGO_URI is required"),
    JWT_KEY: z.string().min(1, "JWT_KEY is required"),
    KAFKA_ENABLED: booleanString.default("false").transform(Boolean),
    KAFKA_BROKERS: z.string().optional(),
    KAFKA_SERVERS: z.string().optional(),
    KAFKA_CLIENT_ID: z.string().default("llm-gateway"),
    KAFKA_TOPIC_USAGE: z.string().default("llm_usage_raw"),
    KAFKA_PROTOCOL: z.string().optional(),
    KAFKA_MECHANISMS: z.string().optional(),
    KAFKA_USERNAME: z.string().optional(),
    KAFKA_PASSWORD: z.string().optional(),
    KAFKA_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
    KAFKA_TIMEOUT: z.coerce.number().int().positive().optional(),
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required"),
    GOOGLE_API_KEY: z.string().optional(),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW: z.string().default("1 minute"),
    STORE_LLM_PAYLOADS: booleanString.default("false").transform(Boolean),
    MODEL_PRICING_JSON: z.string().default("{}"),
  });

  const raw = schema.parse(process.env);
  const brokers = splitCsv(raw.KAFKA_BROKERS || raw.KAFKA_SERVERS);

  if (raw.KAFKA_ENABLED && brokers.length === 0) {
    throw new Error("KAFKA_BROKERS or KAFKA_SERVERS is required when KAFKA_ENABLED=true");
  }

  return {
    PORT: raw.PORT,
    SERVICE_NAME: raw.SERVICE_NAME,
    LOG_LEVEL: raw.LOG_LEVEL,
    CORS_ALLOWED_ORIGINS: splitCsv(raw.CORS_ALLOWED_ORIGINS),
    MONGO_URI: raw.MONGO_URI,
    JWT_KEY: raw.JWT_KEY,
    KAFKA_ENABLED: raw.KAFKA_ENABLED,
    KAFKA_BROKERS: brokers,
    KAFKA_CLIENT_ID: raw.KAFKA_CLIENT_ID,
    KAFKA_TOPIC_USAGE: raw.KAFKA_TOPIC_USAGE,
    KAFKA_PROTOCOL: raw.KAFKA_PROTOCOL,
    KAFKA_MECHANISMS: raw.KAFKA_MECHANISMS,
    KAFKA_USERNAME: raw.KAFKA_USERNAME,
    KAFKA_PASSWORD: raw.KAFKA_PASSWORD,
    KAFKA_TIMEOUT_MS: raw.KAFKA_TIMEOUT ?? raw.KAFKA_TIMEOUT_MS,
    OPENAI_API_KEY: raw.OPENAI_API_KEY,
    ANTHROPIC_API_KEY: raw.ANTHROPIC_API_KEY,
    GOOGLE_API_KEY: raw.GOOGLE_API_KEY,
    REQUEST_TIMEOUT_MS: raw.REQUEST_TIMEOUT_MS,
    RATE_LIMIT_MAX: raw.RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW: raw.RATE_LIMIT_WINDOW,
    STORE_LLM_PAYLOADS: raw.STORE_LLM_PAYLOADS,
    MODEL_PRICING: parsePricing(raw.MODEL_PRICING_JSON),
  };
}
