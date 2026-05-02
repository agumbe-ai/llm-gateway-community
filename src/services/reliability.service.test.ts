import type { ResolvedModel } from "../providers/types";
import { ReliabilityService } from "./reliability.service";

const openAiModel: ResolvedModel = {
  requestedModel: "smart-default",
  canonicalModel: "@openai/gpt-4.1-mini",
  provider: "openai",
  upstreamModel: "gpt-4.1-mini",
  kind: "chat",
  isAlias: true,
  alias: "smart-default",
};

test("reliability service returns model-specific timeout override", () => {
  const service = new ReliabilityService({
    defaultTimeoutMs: 30_000,
    providers: {
      openai: { timeoutMs: 20_000 },
    },
    models: {
      "@openai/gpt-4.1-mini": { timeoutMs: 10_000 },
    },
  });

  expect(service.getTimeoutMs(openAiModel, 30_000)).toBe(10_000);
});

test("reliability service opens circuit after failure threshold", () => {
  const service = new ReliabilityService({
    models: {
      "@openai/gpt-4.1-mini": {
        circuitBreaker: {
          failureThreshold: 2,
          cooldownMs: 1000,
        },
      },
    },
  });

  expect(service.recordFailure(openAiModel)).toBe(false);
  expect(service.recordFailure(openAiModel)).toBe(true);
  expect(() => service.assertCircuitClosed(openAiModel)).toThrow(/Circuit breaker open/);
});
