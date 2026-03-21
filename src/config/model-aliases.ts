import type { ProviderName, RequestKind } from "../providers/types";

export type CatalogModel = {
  id: string;
  provider: ProviderName;
  upstreamModel: string;
  kind: RequestKind;
  public?: boolean;
};

export const CURATED_MODELS: CatalogModel[] = [
  {
    id: "@openai/gpt-5.4",
    provider: "openai",
    upstreamModel: "gpt-5.4",
    kind: "chat",
  },
  {
    id: "@openai/gpt-5.3",
    provider: "openai",
    upstreamModel: "gpt-5.3",
    kind: "chat",
  },
  {
    id: "@openai/gpt-5.2",
    provider: "openai",
    upstreamModel: "gpt-5.2",
    kind: "chat",
  },
  {
    id: "@openai/gpt-5.1",
    provider: "openai",
    upstreamModel: "gpt-5.1",
    kind: "chat",
  },
  {
    id: "@openai/gpt-4.1-mini",
    provider: "openai",
    upstreamModel: "gpt-4.1-mini",
    kind: "chat",
  },
  {
    id: "@openai/gpt-4o-mini",
    provider: "openai",
    upstreamModel: "gpt-4o-mini",
    kind: "chat",
  },
  {
    id: "@anthropic/claude-sonnet-4",
    provider: "anthropic",
    upstreamModel: "claude-sonnet-4-0",
    kind: "chat",
  },
  {
    id: "@openai/text-embedding-3-small",
    provider: "openai",
    upstreamModel: "text-embedding-3-small",
    kind: "embeddings",
  },
  {
    id: "@openai/text-embedding-3-large",
    provider: "openai",
    upstreamModel: "text-embedding-3-large",
    kind: "embeddings",
  },
  {
    id: "@google/gemini-2.0-flash",
    provider: "google",
    upstreamModel: "gemini-2.0-flash",
    kind: "chat",
    public: false,
  },
];

export const MODEL_ALIASES: Record<string, string> = {
  "smart-default": "@openai/gpt-4.1-mini",
  "cheap-fast": "@openai/gpt-4o-mini",
  reasoning: "@anthropic/claude-sonnet-4",
  "embed-default": "@openai/text-embedding-3-small",
  "gpt-5.4": "@openai/gpt-5.4",
  "gpt-5.3": "@openai/gpt-5.3",
  "gpt-5.2": "@openai/gpt-5.2",
  "gpt-5.1": "@openai/gpt-5.1",
  "gpt-4.1-mini": "@openai/gpt-4.1-mini",
  "gpt-4o-mini": "@openai/gpt-4o-mini",
  "text-embedding-3-small": "@openai/text-embedding-3-small",
  "text-embedding-3-large": "@openai/text-embedding-3-large",
};

export function inferRequestKind(provider: ProviderName, upstreamModel: string): RequestKind {
  if (provider === "openai" && /^text-embedding/i.test(upstreamModel)) {
    return "embeddings";
  }

  return "chat";
}
