import type { FastifyInstance } from "fastify";
import { buildApp } from "../app";
import type { Env } from "../config/env";
import { ModelResolver } from "../services/model-resolver";

type TestAppOverrides = {
  env?: Partial<Env>;
};

function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    PORT: 3000,
    SERVICE_NAME: "llm-gateway-test",
    OTEL_SERVICE_NAME: "llm-gateway-test",
    OTEL_SERVICE_VERSION: "0.1.0-test",
    DEPLOYMENT_ENVIRONMENT: "test",
    LOG_LEVEL: "silent",
    CORS_ALLOWED_ORIGINS: ["https://app.example.com"],
    // Current route tests stub data services and never open a Mongo connection.
    MONGO_URI: "mongodb://example.invalid/llm-gateway-test",
    AUTH_MODE: "jwt",
    AUTH_DEFAULT_USER_ID: "test-user",
    AUTH_DEFAULT_TENANT_ID: "test-tenant",
    JWT_KEY: "test-jwt-key",
    KAFKA_ENABLED: false,
    KAFKA_BROKERS: [],
    KAFKA_CLIENT_ID: "llm-gateway-test",
    KAFKA_TOPIC_USAGE: "llm_usage_raw",
    KAFKA_TOPIC_DEAD_LETTER: "llm_dead_letter",
    KAFKA_PROTOCOL: undefined,
    KAFKA_MECHANISMS: undefined,
    KAFKA_USERNAME: undefined,
    KAFKA_PASSWORD: undefined,
    KAFKA_TIMEOUT_MS: 1000,
    OPENAI_API_KEY: "test-openai-key",
    ANTHROPIC_API_KEY: "test-anthropic-key",
    GOOGLE_API_KEY: "test-google-key",
    REQUEST_TIMEOUT_MS: 1000,
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW: "1 minute",
    STORE_LLM_PAYLOADS: false,
    OTEL_ENABLED: false,
    OTEL_EXPORTER_OTLP_PROTOCOL: "http/protobuf",
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: undefined,
    OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: undefined,
    OTEL_RESOURCE_ATTRIBUTES: "",
    OTEL_CAPTURE_GENAI_EVENTS: false,
    OTEL_TRACES_SAMPLER: "parentbased_always_on",
    OTEL_TRACES_SAMPLER_ARG: undefined,
    MODEL_PRICING: {},
    ROUTING_CONFIG: {},
    RELIABILITY_CONFIG: {},
    DEAD_LETTER_ENABLED: false,
    ...overrides,
  };
}

export function createTestApp(overrides: TestAppOverrides = {}): FastifyInstance {
  const env = createTestEnv(overrides.env);

  return buildApp({
    env,
    chatService: {
      async createCompletion() {
        throw new Error("chat service stub not implemented for this test");
      },
    } as any,
    embeddingsService: {
      async createEmbeddings() {
        throw new Error("embeddings service stub not implemented for this test");
      },
    } as any,
    guardrailConfigService: {
      async getPolicy() {
        return {};
      },
      async savePolicy({ settings }: { settings: unknown }) {
        return settings;
      },
    } as any,
    modelResolver: new ModelResolver(env.ROUTING_CONFIG),
    requestLogService: {
      async list() {
        return {
          data: [],
          pagination: {
            page: 1,
            pageSize: 25,
            total: 0,
            totalPages: 0,
          },
        };
      },
    } as any,
  });
}
