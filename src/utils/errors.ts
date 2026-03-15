import { ZodError } from "zod";

type ErrorType =
  | "invalid_request_error"
  | "authentication_error"
  | "rate_limit_error"
  | "api_error";

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly type: ErrorType;
  readonly param?: string;

  constructor(
    message: string,
    options: {
      statusCode: number;
      code: string;
      type: ErrorType;
      param?: string;
    },
  ) {
    super(message);
    this.name = "AppError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.type = options.type;
    this.param = options.param;
  }
}

export function toErrorResponse(error: AppError) {
  return {
    error: {
      message: error.message,
      type: error.type,
      param: error.param ?? null,
      code: error.code,
    },
  };
}

export function normalizeError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  const raw = error as any;

  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return new AppError(issue?.message || "Invalid request body", {
      statusCode: 400,
      code: "validation_error",
      type: "invalid_request_error",
      param: issue?.path?.join(".") || undefined,
    });
  }

  if (raw?.code === "FST_ERR_RATE_LIMIT") {
    return new AppError("Rate limit exceeded", {
      statusCode: 429,
      code: "rate_limit_exceeded",
      type: "rate_limit_error",
    });
  }

  if (typeof raw?.status === "number") {
    return new AppError(raw.message || "Upstream provider request failed", {
      statusCode: raw.status >= 500 ? 502 : raw.status,
      code: raw.code || "provider_error",
      type: raw.status === 429 ? "rate_limit_error" : raw.status >= 500 ? "api_error" : "invalid_request_error",
    });
  }

  return new AppError("Internal Server Error", {
    statusCode: 500,
    code: "internal_error",
    type: "api_error",
  });
}

export function invalidModel(message: string): AppError {
  return new AppError(message, {
    statusCode: 400,
    code: "invalid_model",
    type: "invalid_request_error",
    param: "model",
  });
}

export function authError(message = "Unauthorized"): AppError {
  return new AppError(message, {
    statusCode: 401,
    code: "unauthorized",
    type: "authentication_error",
  });
}

export function providerError(message: string, statusCode = 502, code = "provider_error"): AppError {
  return new AppError(message, {
    statusCode,
    code,
    type: "api_error",
  });
}

export function timeoutError(message = "Upstream provider request timed out"): AppError {
  return new AppError(message, {
    statusCode: 504,
    code: "request_timeout",
    type: "api_error",
  });
}
