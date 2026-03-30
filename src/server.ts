import { getEnv } from "./config/env";
import { shutdownObservability, startObservability } from "./observability";

async function start() {
  const env = getEnv();
  await startObservability(env);

  const [
    { buildApp },
    { AnthropicProviderAdapter },
    { GeminiProviderAdapter },
    { OpenAIProviderAdapter },
    { ChatService },
    { EmbeddingsService },
    { GuardrailConfigService },
    { GuardrailEnforcerService },
    { KafkaService },
    { ModelResolver },
    { closeMongo, connectMongo },
    { RequestLogService },
    { UsageEmitterService },
    { logger },
  ] = await Promise.all([
    import("./app"),
    import("./providers/anthropic"),
    import("./providers/gemini"),
    import("./providers/openai"),
    import("./services/chat.service"),
    import("./services/embeddings.service"),
    import("./services/guardrail-config.service"),
    import("./services/guardrail-enforcer.service"),
    import("./services/kafka"),
    import("./services/model-resolver"),
    import("./services/mongo"),
    import("./services/request-log.service"),
    import("./services/usage-emitter.service"),
    import("./utils/logger"),
  ]);

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
    await shutdownObservability();
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

start().catch(async (error) => {
  console.error("failed to start llm-gateway", error);
  await shutdownObservability().catch(() => undefined);
  process.exit(1);
});
