export type ProviderName = "openai" | "anthropic" | "google";

export type RequestKind = "chat" | "embeddings" | "responses";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type NormalizedUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedPromptTokens?: number;
};

export type ResolvedModel = {
  requestedModel: string;
  canonicalModel: string;
  provider: ProviderName;
  upstreamModel: string;
  kind: RequestKind;
  isAlias: boolean;
  alias?: string;
};

export type ResolvedRouteCandidate = {
  model: ResolvedModel;
  retryAttempts: number;
};

export type ResolvedRoutePlan = {
  requestedModel: string;
  kind: RequestKind;
  candidates: ResolvedRouteCandidate[];
};

export type ProviderResponseFormat =
  | { type: "json_object" }
  | {
      type: "json_schema";
      json_schema: {
        name: string;
        strict?: boolean;
        [key: string]: unknown;
      };
    };

export type ProviderCredentialSource = "env" | "tenant_byok" | "app_byok" | "agumbe_managed";

export type ProviderCredentialContext = {
  provider: ProviderName;
  source: ProviderCredentialSource;
  apiKey: string;
  credentialId?: string;
  label?: string;
};

export type ProviderChatRequest = {
  model: ResolvedModel;
  credential?: ProviderCredentialContext;
  messages: ChatMessage[];
  maxTokens?: number;
  maxCompletionTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: ProviderResponseFormat;
  timeoutMs: number;
};

export type ProviderChatResult = {
  id?: string;
  created?: number;
  model: string;
  message: {
    role: "assistant";
    content: string;
  };
  finishReason?: string | null;
  usage: NormalizedUsage;
};

export type ProviderChatStreamEvent = {
  data: Record<string, unknown>;
};

export type ProviderChatStreamResult = {
  events: AsyncIterable<ProviderChatStreamEvent>;
};

export type ProviderResponsesRequest = {
  model: ResolvedModel;
  credential?: ProviderCredentialContext;
  input: unknown;
  instructions?: string;
  previousResponseId?: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: ProviderResponseFormat;
  text?: unknown;
  tools?: unknown;
  toolChoice?: unknown;
  parallelToolCalls?: boolean;
  include?: unknown;
  reasoning?: unknown;
  store?: boolean;
  promptCacheKey?: string;
  serviceTier?: string;
  clientMetadata?: Record<string, unknown>;
  metadata?: Record<string, string>;
  anthropicBeta?: string;
  anthropicVersion?: string;
  timeoutMs: number;
};

export type ProviderResponsesResult = {
  id?: string;
  created?: number;
  model: string;
  outputText: string;
  rawResponse: Record<string, unknown>;
  usage: NormalizedUsage;
};

export type ProviderResponsesStreamEvent = {
  event: string;
  data: Record<string, unknown>;
};

export type ProviderResponsesStreamResult = {
  events: AsyncIterable<ProviderResponsesStreamEvent>;
};

export type ProviderEmbeddingsRequest = {
  model: ResolvedModel;
  credential?: ProviderCredentialContext;
  input: string | string[];
  timeoutMs: number;
};

export type ProviderEmbeddingsResult = {
  model: string;
  data: Array<{
    embedding: number[];
    index: number;
  }>;
  usage: NormalizedUsage;
};

export interface ProviderAdapter {
  readonly provider: ProviderName;
  chat?(request: ProviderChatRequest): Promise<ProviderChatResult>;
  chatStream?(request: ProviderChatRequest): Promise<ProviderChatStreamResult>;
  responses?(request: ProviderResponsesRequest): Promise<ProviderResponsesResult>;
  responsesStream?(request: ProviderResponsesRequest): Promise<ProviderResponsesStreamResult>;
  embeddings?(request: ProviderEmbeddingsRequest): Promise<ProviderEmbeddingsResult>;
}
