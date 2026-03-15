import type {
  ProviderAdapter,
  ProviderChatRequest,
  ProviderChatResult,
  ProviderEmbeddingsRequest,
  ProviderEmbeddingsResult,
} from "./types";
import { providerError } from "../utils/errors";

export class GeminiProviderAdapter implements ProviderAdapter {
  readonly provider = "google" as const;

  constructor(private readonly apiKey?: string) {}

  async chat(_request: ProviderChatRequest): Promise<ProviderChatResult> {
    if (!this.apiKey) {
      throw providerError("Gemini adapter is scaffolded but GOOGLE_API_KEY is not configured", 501, "unsupported_provider");
    }

    throw providerError("Gemini adapter scaffold is present but not enabled in this MVP", 501, "unsupported_provider");
  }

  async embeddings(_request: ProviderEmbeddingsRequest): Promise<ProviderEmbeddingsResult> {
    throw providerError("Gemini embeddings are not enabled in this MVP", 501, "unsupported_provider");
  }
}
