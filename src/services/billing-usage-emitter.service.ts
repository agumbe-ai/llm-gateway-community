import type { RequestKind } from "../providers/types";
import { KafkaService } from "./kafka";

export type BillingUsageEvent = {
  requestId: string;
  tenantId: string;
  requestKind: RequestKind;
  provider: "openai" | "anthropic" | "google";
  upstreamModel: string;
  requestedModel: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  status: "success" | "error";
  timestamp: string;
};

type Envelope<T> = {
  id: string;
  ts: string;
  subject: "billing_usage_raw";
  tenant_id: string;
  payload: T;
};

type BillingUsagePayload = {
  tenant_id: string;
  meter: "openai.tokens";
  model: string;
  value: number;
  unit: "1k_tokens";
  metadata: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    latency_ms: number;
    request_kind: RequestKind;
    requested_model: string;
  };
  source: "llm-gateway";
  source_ref: string;
};

export class BillingUsageEmitterService {
  constructor(
    private readonly kafkaService: KafkaService,
    private readonly topic?: string,
  ) {}

  async emit(event: BillingUsageEvent): Promise<void> {
    if (!this.topic || event.status !== "success" || event.totalTokens <= 0 || event.provider !== "openai") {
      return;
    }

    const payload: Envelope<BillingUsagePayload> = {
      id: event.requestId,
      ts: event.timestamp,
      subject: "billing_usage_raw",
      tenant_id: event.tenantId,
      payload: {
        tenant_id: event.tenantId,
        meter: "openai.tokens",
        model: event.upstreamModel,
        value: Number((event.totalTokens / 1000).toFixed(6)),
        unit: "1k_tokens",
        metadata: {
          prompt_tokens: event.promptTokens,
          completion_tokens: event.completionTokens,
          total_tokens: event.totalTokens,
          latency_ms: event.latencyMs,
          request_kind: event.requestKind,
          requested_model: event.requestedModel,
        },
        source: "llm-gateway",
        source_ref: event.requestId,
      },
    };

    await this.kafkaService.produce(this.topic, "billing_usage_raw", payload);
  }
}
