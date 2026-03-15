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
    upstreamModel: "claude-sonnet-4",
    kind: "chat",
  },
  {
    id: "@openai/text-embedding-3-small",
    provider: "openai",
    upstreamModel: "text-embedding-3-small",
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
};

export function inferRequestKind(provider: ProviderName, upstreamModel: string): RequestKind {
  if (provider === "openai" && /^text-embedding/i.test(upstreamModel)) {
    return "embeddings";
  }

  return "chat";
}
