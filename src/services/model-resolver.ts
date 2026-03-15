import { CURATED_MODELS, MODEL_ALIASES, inferRequestKind } from "../config/model-aliases";
import type { ProviderName, RequestKind, ResolvedModel } from "../providers/types";
import { invalidModel } from "../utils/errors";

export type CatalogEntry = {
  id: string;
  object: "model";
  provider: ProviderName;
  kind: RequestKind;
  upstream_model?: string;
  is_alias?: boolean;
};

export class ModelResolver {
  resolve(requestedModel: string, requestKind: RequestKind): ResolvedModel {
    const aliasTarget = MODEL_ALIASES[requestedModel];
    const resolved = aliasTarget
      ? this.resolveQualifiedModel(aliasTarget, requestedModel, true)
      : this.resolveQualifiedModel(requestedModel, requestedModel, false);

    if (resolved.kind !== requestKind) {
      throw invalidModel(
        `Model ${requestedModel} resolves to ${resolved.kind} and cannot be used with the ${requestKind} endpoint`,
      );
    }

    return resolved;
  }

  listCatalog(): CatalogEntry[] {
    const canonicalModels = CURATED_MODELS.filter((model) => model.public !== false).map((model) => ({
      id: model.id,
      object: "model" as const,
      provider: model.provider,
      kind: model.kind,
    }));

    const aliases = Object.entries(MODEL_ALIASES).map(([alias, target]) => {
      const resolved = this.resolveQualifiedModel(target, alias, true);
      return {
        id: alias,
        object: "model" as const,
        provider: resolved.provider,
        upstream_model: resolved.upstreamModel,
        kind: resolved.kind,
        is_alias: true,
      };
    });

    return [...canonicalModels, ...aliases];
  }

  private resolveQualifiedModel(
    targetModel: string,
    requestedModel: string,
    isAlias: boolean,
  ): ResolvedModel {
    const match = targetModel.match(/^@(openai|anthropic|google)\/(.+)$/);
    if (!match) {
      if (isAlias) {
        throw invalidModel(`Alias ${requestedModel} points to an invalid model target`);
      }

      throw invalidModel(`Unknown model alias: ${requestedModel}`);
    }

    const provider = match[1] as ProviderName;
    const upstreamModel = match[2];
    const kind = inferRequestKind(provider, upstreamModel);
    const canonicalModel = `@${provider}/${upstreamModel}`;

    return {
      requestedModel,
      canonicalModel,
      provider,
      upstreamModel,
      kind,
      isAlias,
      alias: isAlias ? requestedModel : undefined,
    };
  }
}
