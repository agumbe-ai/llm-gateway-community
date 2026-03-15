import type { RequestKind } from "../providers/types";
import { KafkaService } from "./kafka";

export type UsageEvent = {
  eventType: "llm_usage_raw";
  tenantId: string;
  userId: string;
  requestId: string;
  requestKind: RequestKind;
  requestedModel: string;
  provider: string;
  upstreamModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: "success" | "error";
  estimatedCost: number;
  errorCode?: string;
  timestamp: string;
};

export class UsageEmitterService {
  constructor(
    private readonly kafkaService: KafkaService,
    private readonly topic: string,
  ) {}

  async emit(event: UsageEvent): Promise<void> {
    await this.kafkaService.produce(this.topic, event.requestId, event);
  }
}
