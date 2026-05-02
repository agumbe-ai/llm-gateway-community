import type { ResolvedModel, ResolvedRoutePlan } from "../providers/types";
import { AppError, normalizeError } from "../utils/errors";

export type RouteExecutionResult<T> = {
  result: T;
  resolvedModel: ResolvedModel;
  attempts: number;
};

type RouteExecutionOptions = {
  beforeAttempt?: (model: ResolvedModel, attemptNumber: number) => void | Promise<void>;
  onSuccess?: (model: ResolvedModel, attemptNumber: number) => void | Promise<void>;
  onFailure?: (
    model: ResolvedModel,
    error: AppError,
    attemptNumber: number,
  ) => void | Promise<void>;
};

export async function executeRoutePlan<T>(
  plan: ResolvedRoutePlan,
  invoke: (model: ResolvedModel) => Promise<T>,
  options: RouteExecutionOptions = {},
): Promise<RouteExecutionResult<T>> {
  let attempts = 0;
  let lastError: AppError | undefined;

  for (const candidate of plan.candidates) {
    for (let retryIndex = 0; retryIndex < candidate.retryAttempts; retryIndex += 1) {
      attempts += 1;

      try {
        await options.beforeAttempt?.(candidate.model, attempts);
        const result = await invoke(candidate.model);
        await options.onSuccess?.(candidate.model, attempts);
        return {
          result,
          resolvedModel: candidate.model,
          attempts,
        };
      } catch (error) {
        const normalized = normalizeError(error);
        lastError = normalized;
        await options.onFailure?.(candidate.model, normalized, attempts);

        if (!isRetryableRoutingError(normalized)) {
          throw normalized;
        }
      }
    }
  }

  throw (
    lastError ||
    new AppError(`No routing candidates were available for ${plan.requestedModel}`, {
      statusCode: 502,
      code: "route_unavailable",
      type: "api_error",
    })
  );
}

function isRetryableRoutingError(error: AppError) {
  return error.type === "api_error" || error.type === "rate_limit_error";
}
