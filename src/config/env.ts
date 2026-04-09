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

export type RoutingConfig = Record<
  string,
  {
    maxAttempts?: number;
    candidates: Array<{
      model: string;
      weight?: number;
      retryAttempts?: number;
    }>;
  }
>;

export type Env = {
  PORT: number;
  SERVICE_NAME: string;
  OTEL_SERVICE_NAME: string;
  OTEL_SERVICE_VERSION: string;
  DEPLOYMENT_ENVIRONMENT: string;
  LOG_LEVEL: string;
  CORS_ALLOWED_ORIGINS: string[];
  MONGO_URI?: string;
  AUTH_MODE: "none" | "jwt";
  AUTH_DEFAULT_USER_ID: string;
  AUTH_DEFAULT_TENANT_ID: string;
  JWT_KEY?: string;
  KAFKA_ENABLED: boolean;
  KAFKA_BROKERS: string[];
  KAFKA_CLIENT_ID: string;
  KAFKA_TOPIC_USAGE: string;
  KAFKA_PROTOCOL?: string;
  KAFKA_MECHANISMS?: string;
  KAFKA_USERNAME?: string;
  KAFKA_PASSWORD?: string;
  KAFKA_TIMEOUT_MS: number;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  REQUEST_TIMEOUT_MS: number;
  RATE_LIMIT_MAX: number;
  RATE_LIMIT_WINDOW: string;
  STORE_LLM_PAYLOADS: boolean;
  OTEL_ENABLED: boolean;
  OTEL_EXPORTER_OTLP_PROTOCOL: string;
  OTEL_EXPORTER_OTLP_ENDPOINT: string;
  OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?: string;
  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?: string;
  OTEL_RESOURCE_ATTRIBUTES: string;
  OTEL_CAPTURE_GENAI_EVENTS: boolean;
  OTEL_TRACES_SAMPLER: string;
  OTEL_TRACES_SAMPLER_ARG?: string;
  MODEL_PRICING: ModelPricing;
  ROUTING_CONFIG: RoutingConfig;
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

function parseRoutingConfig(value?: string): RoutingConfig {
  if (!value || !value.trim()) {
    return {};
  }

  const parsed = JSON.parse(value) as Record<string, any>;
  const result: RoutingConfig = {};

  for (const [routeKey, routeValue] of Object.entries(parsed)) {
    if (!routeValue || typeof routeValue !== "object" || !Array.isArray(routeValue.candidates)) {
      throw new Error(`ROUTING_CONFIG_JSON entry ${routeKey} must include a candidates array`);
    }

    result[routeKey] = {
      maxAttempts:
        typeof routeValue.maxAttempts === "number" && Number.isFinite(routeValue.maxAttempts)
          ? routeValue.maxAttempts
          : undefined,
      candidates: routeValue.candidates.map((candidate: any, index: number) => {
        if (!candidate || typeof candidate.model !== "string" || !candidate.model.trim()) {
          throw new Error(
            `ROUTING_CONFIG_JSON entry ${routeKey} candidate ${index} must include a model`,
          );
        }

        return {
          model: candidate.model.trim(),
          weight:
            typeof candidate.weight === "number" && Number.isFinite(candidate.weight)
              ? candidate.weight
              : undefined,
          retryAttempts:
            typeof candidate.retryAttempts === "number" &&
            Number.isFinite(candidate.retryAttempts)
              ? candidate.retryAttempts
              : undefined,
        };
      }),
    };
  }

  return result;
}

function parseAuthMode(value?: string): "none" | "jwt" {
  if (!value) {
    return "none";
  }

  if (value === "none" || value === "jwt") {
    return value;
  }

  throw new Error('AUTH_MODE must be either "none" or "jwt"');
}

export function getEnv(): Env {
  const schema = z.object({
    PORT: z.coerce.number().int().positive().default(3000),
    SERVICE_NAME: z.string().default("llm-gateway-community"),
    OTEL_SERVICE_NAME: z.string().default("llm-gateway-community"),
    OTEL_SERVICE_VERSION: z.string().default(process.env.npm_package_version || "0.1.0"),
    DEPLOYMENT_ENVIRONMENT: z.string().default(process.env.NODE_ENV || "development"),
    LOG_LEVEL: z.string().default("info"),
    CORS_ALLOWED_ORIGINS: z.string().default("*"),
    MONGO_URI: z.string().trim().optional(),
    AUTH_MODE: z.string().default("none"),
    AUTH_DEFAULT_USER_ID: z.string().default("community-user"),
    AUTH_DEFAULT_TENANT_ID: z.string().default("community"),
    JWT_KEY: z.string().trim().optional(),
    KAFKA_ENABLED: booleanString.default("false").transform(Boolean),
    KAFKA_BROKERS: z.string().optional(),
    KAFKA_SERVERS: z.string().optional(),
    KAFKA_CLIENT_ID: z.string().default("llm-gateway-community"),
    KAFKA_TOPIC_USAGE: z.string().default("llm_usage_raw"),
    KAFKA_PROTOCOL: z.string().optional(),
    KAFKA_MECHANISMS: z.string().optional(),
    KAFKA_USERNAME: z.string().optional(),
    KAFKA_PASSWORD: z.string().optional(),
    KAFKA_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
    KAFKA_TIMEOUT: z.coerce.number().int().positive().optional(),
    OPENAI_API_KEY: z.string().trim().optional(),
    ANTHROPIC_API_KEY: z.string().trim().optional(),
    GOOGLE_API_KEY: z.string().optional(),
    REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_WINDOW: z.string().default("1 minute"),
    STORE_LLM_PAYLOADS: booleanString.default("false").transform(Boolean),
    OTEL_ENABLED: booleanString.default("false").transform(Boolean),
    OTEL_EXPORTER_OTLP_PROTOCOL: z.string().default("http/protobuf"),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().default("http://localhost:4318"),
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: z.string().optional(),
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: z.string().optional(),
    OTEL_RESOURCE_ATTRIBUTES: z.string().default(""),
    OTEL_CAPTURE_GENAI_EVENTS: booleanString.default("false").transform(Boolean),
    OTEL_TRACES_SAMPLER: z.string().default("parentbased_always_on"),
    OTEL_TRACES_SAMPLER_ARG: z.string().optional(),
    MODEL_PRICING_JSON: z.string().default("{}"),
    ROUTING_CONFIG_JSON: z.string().default("{}"),
  });

  const raw = schema.parse(process.env);
  const brokers = splitCsv(raw.KAFKA_BROKERS || raw.KAFKA_SERVERS);
  const authMode = parseAuthMode(raw.AUTH_MODE);

  if (raw.KAFKA_ENABLED && brokers.length === 0) {
    throw new Error("KAFKA_BROKERS or KAFKA_SERVERS is required when KAFKA_ENABLED=true");
  }

  if (authMode === "jwt" && !raw.JWT_KEY) {
    throw new Error("JWT_KEY is required when AUTH_MODE=jwt");
  }

  return {
    PORT: raw.PORT,
    SERVICE_NAME: raw.SERVICE_NAME,
    OTEL_SERVICE_NAME: raw.OTEL_SERVICE_NAME,
    OTEL_SERVICE_VERSION: raw.OTEL_SERVICE_VERSION,
    DEPLOYMENT_ENVIRONMENT: raw.DEPLOYMENT_ENVIRONMENT,
    LOG_LEVEL: raw.LOG_LEVEL,
    CORS_ALLOWED_ORIGINS: splitCsv(raw.CORS_ALLOWED_ORIGINS),
    MONGO_URI: raw.MONGO_URI || undefined,
    AUTH_MODE: authMode,
    AUTH_DEFAULT_USER_ID: raw.AUTH_DEFAULT_USER_ID,
    AUTH_DEFAULT_TENANT_ID: raw.AUTH_DEFAULT_TENANT_ID,
    JWT_KEY: raw.JWT_KEY || undefined,
    KAFKA_ENABLED: raw.KAFKA_ENABLED,
    KAFKA_BROKERS: brokers,
    KAFKA_CLIENT_ID: raw.KAFKA_CLIENT_ID,
    KAFKA_TOPIC_USAGE: raw.KAFKA_TOPIC_USAGE,
    KAFKA_PROTOCOL: raw.KAFKA_PROTOCOL,
    KAFKA_MECHANISMS: raw.KAFKA_MECHANISMS,
    KAFKA_USERNAME: raw.KAFKA_USERNAME,
    KAFKA_PASSWORD: raw.KAFKA_PASSWORD,
    KAFKA_TIMEOUT_MS: raw.KAFKA_TIMEOUT ?? raw.KAFKA_TIMEOUT_MS,
    OPENAI_API_KEY: raw.OPENAI_API_KEY || undefined,
    ANTHROPIC_API_KEY: raw.ANTHROPIC_API_KEY || undefined,
    GOOGLE_API_KEY: raw.GOOGLE_API_KEY,
    REQUEST_TIMEOUT_MS: raw.REQUEST_TIMEOUT_MS,
    RATE_LIMIT_MAX: raw.RATE_LIMIT_MAX,
    RATE_LIMIT_WINDOW: raw.RATE_LIMIT_WINDOW,
    STORE_LLM_PAYLOADS: raw.STORE_LLM_PAYLOADS,
    OTEL_ENABLED: raw.OTEL_ENABLED,
    OTEL_EXPORTER_OTLP_PROTOCOL: raw.OTEL_EXPORTER_OTLP_PROTOCOL,
    OTEL_EXPORTER_OTLP_ENDPOINT: raw.OTEL_EXPORTER_OTLP_ENDPOINT,
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: raw.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: raw.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT,
    OTEL_RESOURCE_ATTRIBUTES: raw.OTEL_RESOURCE_ATTRIBUTES,
    OTEL_CAPTURE_GENAI_EVENTS: raw.OTEL_CAPTURE_GENAI_EVENTS,
    OTEL_TRACES_SAMPLER: raw.OTEL_TRACES_SAMPLER,
    OTEL_TRACES_SAMPLER_ARG: raw.OTEL_TRACES_SAMPLER_ARG,
    MODEL_PRICING: parsePricing(raw.MODEL_PRICING_JSON),
    ROUTING_CONFIG: parseRoutingConfig(raw.ROUTING_CONFIG_JSON),
  };
}
