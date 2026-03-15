import "dotenv/config";
import pino, { type LoggerOptions } from "pino";

export const loggerOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL || "info",
  base: {
    service: process.env.SERVICE_NAME || "llm-gateway",
  },
};

export const logger = pino(loggerOptions);
