import { buildApp } from "./app";
import { getEnv } from "./config/env";
import { AnthropicProviderAdapter } from "./providers/anthropic";
import { GeminiProviderAdapter } from "./providers/gemini";
import { OpenAIProviderAdapter } from "./providers/openai";
import { ChatService } from "./services/chat.service";
import { EmbeddingsService } from "./services/embeddings.service";
import { GuardrailConfigService } from "./services/guardrail-config.service";
import { GuardrailEnforcerService } from "./services/guardrail-enforcer.service";
import { KafkaService } from "./services/kafka";
import { ModelResolver } from "./services/model-resolver";
import { closeMongo, connectMongo } from "./services/mongo";
import { RequestLogService } from "./services/request-log.service";
import { UsageEmitterService } from "./services/usage-emitter.service";
import { logger } from "./utils/logger";

async function start() {
  const env = getEnv();

  await connectMongo(env.MONGO_URI);

  const kafkaService = new KafkaService(env);
  await kafkaService.connect();

  const requestLogService = new RequestLogService(env.STORE_LLM_PAYLOADS);
  const usageEmitter = new UsageEmitterService(kafkaService, env.KAFKA_TOPIC_USAGE);
  const modelResolver = new ModelResolver();
  const guardrailConfigService = new GuardrailConfigService();
  const guardrailEnforcer = new GuardrailEnforcerService();

  const providers = {
    openai: new OpenAIProviderAdapter(env.OPENAI_API_KEY),
    anthropic: new AnthropicProviderAdapter(env.ANTHROPIC_API_KEY),
    google: new GeminiProviderAdapter(env.GOOGLE_API_KEY),
  };

  const chatService = new ChatService({
    providers,
    modelResolver,
    requestLogService,
    usageEmitter,
    guardrailConfigService,
    guardrailEnforcer,
    modelPricing: env.MODEL_PRICING,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
  });

  const embeddingsService = new EmbeddingsService({
    providers,
    modelResolver,
    requestLogService,
    usageEmitter,
    guardrailConfigService,
    guardrailEnforcer,
    modelPricing: env.MODEL_PRICING,
    requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
  });

  const app = buildApp({
    env,
    chatService,
    embeddingsService,
    guardrailConfigService,
    modelResolver,
    requestLogService,
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting down");
    await app.close();
    await closeMongo();
    kafkaService.close();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  const address = await app.listen({
    host: "0.0.0.0",
    port: env.PORT,
  });

  logger.info({ address }, "llm-gateway listening");
}

start().catch((error) => {
  logger.error({ err: error }, "failed to start llm-gateway");
  process.exit(1);
});
