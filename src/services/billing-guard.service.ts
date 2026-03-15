import type { ModelPricing } from "../config/env";
import type { RequestKind, ResolvedModel } from "../providers/types";
import type { ChatRequest } from "../types/chat";
import type { EmbeddingsRequest } from "../types/embeddings";
import { estimateChatMaxUsage, estimateCostUsdForUsage, estimateEmbeddingsUsage, ensurePricedModel } from "../utils/billing";
import { AppError } from "../utils/errors";
import type { AuthenticatedRequestContext } from "./chat.service";

type BillingGuardDeps = {
  enabled: boolean;
  tenantsBaseUrl?: string;
  timeoutMs: number;
  billingPricing: ModelPricing;
  defaultChatMaxCompletionTokens: number;
};

type WalletSummary = {
  tenant_id: string;
  currency: string;
  balance_denits: number;
  balance_units: number;
  denits_per_unit: number;
  low_threshold_units: number;
  status: "ok" | "low" | "empty";
};

type AuthorizationInput =
  | {
      requestKind: "chat";
      context: AuthenticatedRequestContext;
      model: ResolvedModel;
      request: ChatRequest;
      bearerToken: string;
    }
  | {
      requestKind: "embeddings";
      context: AuthenticatedRequestContext;
      model: ResolvedModel;
      request: EmbeddingsRequest;
      bearerToken: string;
    };

export type BillingAuthorization = {
  estimatedChargeUnits: number;
  estimatedDebitDenits: number;
  wallet: WalletSummary;
};

export class BillingGuardService {
  constructor(private readonly deps: BillingGuardDeps) {}

  async authorize(input: AuthorizationInput): Promise<BillingAuthorization | null> {
    if (!this.deps.enabled) {
      return null;
    }

    if (!this.deps.tenantsBaseUrl) {
      throw new AppError("Billing enforcement is enabled but tenants base URL is not configured", {
        statusCode: 503,
        code: "billing_not_configured",
        type: "api_error",
      });
    }

    if (input.model.provider !== "openai") {
      throw new AppError(`Billing enforcement is not enabled for provider ${input.model.provider}`, {
        statusCode: 503,
        code: "billing_provider_unavailable",
        type: "api_error",
        param: "model",
      });
    }

    if (!ensurePricedModel(input.model, this.deps.billingPricing)) {
      throw new AppError(`Billing price is not configured for model ${input.model.canonicalModel}`, {
        statusCode: 503,
        code: "billing_price_unavailable",
        type: "api_error",
        param: "model",
      });
    }

    const usage =
      input.requestKind === "chat"
        ? estimateChatMaxUsage(input.request, this.deps.defaultChatMaxCompletionTokens)
        : estimateEmbeddingsUsage(input.request);

    const estimatedChargeUnits = estimateCostUsdForUsage(input.model, usage, this.deps.billingPricing);
    if (estimatedChargeUnits === null) {
      throw new AppError(`Billing price is not configured for model ${input.model.canonicalModel}`, {
        statusCode: 503,
        code: "billing_price_unavailable",
        type: "api_error",
        param: "model",
      });
    }

    const wallet = await this.fetchWallet(input.bearerToken);
    const estimatedDebitDenits = Math.max(
      1,
      Math.ceil(estimatedChargeUnits * wallet.denits_per_unit),
    );

    if (wallet.tenant_id !== input.context.tenantId) {
      throw new AppError("Billing wallet response tenant mismatch", {
        statusCode: 502,
        code: "billing_wallet_mismatch",
        type: "api_error",
      });
    }

    if (wallet.balance_denits < estimatedDebitDenits) {
      throw new AppError("Insufficient credits for this request", {
        statusCode: 402,
        code: "insufficient_credits",
        type: "authentication_error",
      });
    }

    return {
      estimatedChargeUnits,
      estimatedDebitDenits,
      wallet,
    };
  }

  private async fetchWallet(bearerToken: string): Promise<WalletSummary> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.deps.timeoutMs);

    try {
      const response = await fetch(`${this.deps.tenantsBaseUrl}/api/v1/tenants/wallet`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
        },
        signal: controller.signal,
      });

      const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        throw new AppError(
          typeof data?.msg === "string" ? data.msg : "Failed to fetch tenant wallet",
          {
            statusCode: response.status >= 500 ? 502 : response.status,
            code: "billing_wallet_unavailable",
            type: response.status >= 500 ? "api_error" : "authentication_error",
          },
        );
      }

      if (
        !data ||
        typeof data.tenant_id !== "string" ||
        typeof data.currency !== "string" ||
        typeof data.balance_denits !== "number" ||
        typeof data.balance_units !== "number" ||
        typeof data.denits_per_unit !== "number" ||
        typeof data.low_threshold_units !== "number" ||
        (data.status !== "ok" && data.status !== "low" && data.status !== "empty")
      ) {
        throw new AppError("Tenant wallet response was invalid", {
          statusCode: 502,
          code: "billing_wallet_invalid",
          type: "api_error",
        });
      }

      return data as unknown as WalletSummary;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }

      if ((error as Error).name === "AbortError") {
        throw new AppError("Billing wallet check timed out", {
          statusCode: 504,
          code: "billing_timeout",
          type: "api_error",
        });
      }

      throw new AppError("Failed to fetch tenant wallet", {
        statusCode: 502,
        code: "billing_wallet_unavailable",
        type: "api_error",
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
