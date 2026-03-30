import "dotenv/config";
import { trace } from "@opentelemetry/api";
import pino, { type LoggerOptions } from "pino";

export const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || "info",
  base: {
    service: process.env.SERVICE_NAME || "llm-gateway",
  },
  mixin() {
    const spanContext = trace.getActiveSpan()?.spanContext();
    if (!spanContext) {
      return {};
    }

    return {
      trace_id: spanContext.traceId,
      span_id: spanContext.spanId,
      trace_flags: spanContext.traceFlags,
    };
  },
};

export const logger = pino(loggerOptions);
