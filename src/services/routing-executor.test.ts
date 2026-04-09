import type { ResolvedRoutePlan } from "../providers/types";
import { AppError } from "../utils/errors";
import { executeRoutePlan } from "./routing-executor";

const chatPlan: ResolvedRoutePlan = {
  requestedModel: "smart-default",
  kind: "chat",
  candidates: [
    {
      model: {
        requestedModel: "smart-default",
        canonicalModel: "@openai/gpt-4.1-mini",
        provider: "openai",
        upstreamModel: "gpt-4.1-mini",
        kind: "chat",
        isAlias: true,
        alias: "smart-default",
      },
      retryAttempts: 2,
    },
    {
      model: {
        requestedModel: "smart-default",
        canonicalModel: "@anthropic/claude-sonnet-4",
        provider: "anthropic",
        upstreamModel: "claude-sonnet-4-0",
        kind: "chat",
        isAlias: true,
        alias: "smart-default",
      },
      retryAttempts: 1,
    },
  ],
};

test("executeRoutePlan retries and then falls back across candidates", async () => {
  const invoke = jest
    .fn<Promise<string>, [typeof chatPlan.candidates[number]["model"]]>()
    .mockRejectedValueOnce(
      new AppError("provider temporarily unavailable", {
        statusCode: 502,
        code: "provider_error",
        type: "api_error",
      }),
    )
    .mockRejectedValueOnce(
      new AppError("provider temporarily unavailable", {
        statusCode: 504,
        code: "request_timeout",
        type: "api_error",
      }),
    )
    .mockResolvedValueOnce("fallback-ok");

  const result = await executeRoutePlan(chatPlan, invoke);

  expect(result.result).toBe("fallback-ok");
  expect(result.resolvedModel.canonicalModel).toBe("@anthropic/claude-sonnet-4");
  expect(result.attempts).toBe(3);
  expect(invoke).toHaveBeenCalledTimes(3);
});

test("executeRoutePlan does not retry non-retryable request errors", async () => {
  const invoke = jest.fn().mockRejectedValue(
    new AppError("invalid request", {
      statusCode: 400,
      code: "validation_error",
      type: "invalid_request_error",
    }),
  );

  await expect(executeRoutePlan(chatPlan, invoke)).rejects.toMatchObject({
    code: "validation_error",
  });
  expect(invoke).toHaveBeenCalledTimes(1);
});
