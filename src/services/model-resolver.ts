import type { RoutingConfig } from "../config/env";
import { CURATED_MODELS, MODEL_ALIASES, inferRequestKind } from "../config/model-aliases";
import type {
  ProviderName,
  RequestKind,
  ResolvedModel,
  ResolvedRouteCandidate,
  ResolvedRoutePlan,
} from "../providers/types";
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
  constructor(private readonly routingConfig: RoutingConfig = {}) {}

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

  resolveRoute(requestedModel: string, requestKind: RequestKind): ResolvedRoutePlan {
    const primary = this.resolve(requestedModel, requestKind);
    const configuredRule =
      this.routingConfig[requestedModel] || this.routingConfig[primary.canonicalModel];

    if (!configuredRule) {
      return {
        requestedModel,
        kind: requestKind,
        candidates: [{ model: primary, retryAttempts: 1 }],
      };
    }

    const resolvedCandidates = configuredRule.candidates.map((candidate) => ({
      model: this.resolve(candidate.model, requestKind),
      weight: normalizePositiveInt(candidate.weight, 1),
      retryAttempts: normalizePositiveInt(candidate.retryAttempts, 1),
    }));

    if (resolvedCandidates.length === 0) {
      throw invalidModel(`Routing rule for ${requestedModel} has no valid candidates`);
    }

    const orderedCandidates = weightedShuffle(resolvedCandidates).map<ResolvedRouteCandidate>(
      (candidate) => ({
        model: candidate.model,
        retryAttempts: candidate.retryAttempts,
      }),
    );
    const maxAttempts = normalizePositiveInt(configuredRule.maxAttempts, orderedCandidates.length);

    return {
      requestedModel,
      kind: requestKind,
      candidates: orderedCandidates.slice(0, maxAttempts),
    };
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
    const curatedModel = CURATED_MODELS.find((model) => model.id === targetModel);
    if (curatedModel) {
      return {
        requestedModel,
        canonicalModel: curatedModel.id,
        provider: curatedModel.provider,
        upstreamModel: curatedModel.upstreamModel,
        kind: curatedModel.kind,
        isAlias,
        alias: isAlias ? requestedModel : undefined,
      };
    }

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

function normalizePositiveInt(value: number | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.max(1, Math.floor(value));
}

function weightedShuffle<T extends { weight: number }>(items: T[]): T[] {
  const pool = items.map((item) => ({ ...item }));
  const ordered: T[] = [];

  while (pool.length > 0) {
    const totalWeight = pool.reduce((sum, item) => sum + item.weight, 0);
    let draw = Math.random() * totalWeight;
    let selectedIndex = pool.length - 1;

    for (let index = 0; index < pool.length; index += 1) {
      draw -= pool[index].weight;
      if (draw < 0) {
        selectedIndex = index;
        break;
      }
    }

    ordered.push(pool.splice(selectedIndex, 1)[0]);
  }

  return ordered;
}
