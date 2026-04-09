import { ModelResolver } from "./model-resolver";

afterEach(() => {
  jest.restoreAllMocks();
});

test("resolveRoute uses configured weighted candidates and retry attempts", () => {
  jest.spyOn(Math, "random")
    .mockReturnValueOnce(0.8)
    .mockReturnValueOnce(0.2);

  const resolver = new ModelResolver({
    "smart-default": {
      maxAttempts: 2,
      candidates: [
        { model: "@openai/gpt-4.1-mini", weight: 1, retryAttempts: 2 },
        { model: "@anthropic/claude-sonnet-4", weight: 3, retryAttempts: 1 },
      ],
    },
  });

  const route = resolver.resolveRoute("smart-default", "chat");

  expect(route.candidates).toHaveLength(2);
  expect(route.candidates[0].model.canonicalModel).toBe("@anthropic/claude-sonnet-4");
  expect(route.candidates[0].retryAttempts).toBe(1);
  expect(route.candidates[1].model.canonicalModel).toBe("@openai/gpt-4.1-mini");
  expect(route.candidates[1].retryAttempts).toBe(2);
});

test("resolveRoute falls back to a single direct candidate when no routing rule is configured", () => {
  const resolver = new ModelResolver();

  const route = resolver.resolveRoute("@openai/text-embedding-3-small", "embeddings");

  expect(route.candidates).toHaveLength(1);
  expect(route.candidates[0].model.canonicalModel).toBe("@openai/text-embedding-3-small");
  expect(route.candidates[0].retryAttempts).toBe(1);
});
