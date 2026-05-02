import type { RequestKind } from "../providers/types";
import type { AppError } from "../utils/errors";
import { logger } from "../utils/logger";
import { KafkaService } from "./kafka";

export type DeadLetterEvent = {
  eventType: "llm_dead_letter";
  requestId: string;
  tenantId: string;
  userId: string;
  requestKind: RequestKind;
  requestedModel: string;
  provider: string;
  upstreamModel: string;
  errorCode: string;
  errorType: string;
  errorMessage: string;
  attempts?: number;
  timestamp: string;
};

export class DeadLetterService {
  constructor(
    private readonly kafkaService: KafkaService,
    private readonly topic: string,
    private readonly enabled: boolean,
  ) {}

  async emit(event: DeadLetterEvent): Promise<void> {
    if (!this.enabled) {
      logger.warn({ requestId: event.requestId, errorCode: event.errorCode }, "dead letter disabled");
      return;
    }

    await this.kafkaService.produce(this.topic, event.requestId, event);
  }
}

export function toDeadLetterEvent(params: {
  requestId: string;
  tenantId: string;
  userId: string;
  requestKind: RequestKind;
  requestedModel: string;
  provider: string;
  upstreamModel: string;
  error: AppError;
  attempts?: number;
}): DeadLetterEvent {
  return {
    eventType: "llm_dead_letter",
    requestId: params.requestId,
    tenantId: params.tenantId,
    userId: params.userId,
    requestKind: params.requestKind,
    requestedModel: params.requestedModel,
    provider: params.provider,
    upstreamModel: params.upstreamModel,
    errorCode: params.error.code,
    errorType: params.error.type,
    errorMessage: params.error.message,
    attempts: params.attempts,
    timestamp: new Date().toISOString(),
  };
}
