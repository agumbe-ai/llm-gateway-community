export type ProviderName = "openai" | "anthropic" | "google";

export type RequestKind = "chat" | "embeddings";

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

export type ProviderChatRequest = {
  model: ResolvedModel;
  messages: ChatMessage[];
  maxTokens?: number;
  maxCompletionTokens?: number;
  maxOutputTokens?: number;
  temperature?: number;
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

export type ProviderEmbeddingsRequest = {
  model: ResolvedModel;
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
  embeddings?(request: ProviderEmbeddingsRequest): Promise<ProviderEmbeddingsResult>;
}
