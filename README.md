# llm-gateway

`llm-gateway` is a compatibility-first Agumbe core service for LLM inference. It exposes OpenAI-style chat and embeddings endpoints, resolves Agumbe aliases like `smart-default`, routes to provider-native adapters, logs request metadata to MongoDB, and emits raw usage events to Kafka.

## Reused Agumbe conventions

- JWT payload shape matches the existing auth service: `id`, `email`, `tenant_id`, `isVerified`, `isAdmin`
- Mongo connectivity uses the same single-process Mongoose connection pattern used by nearby services
- Kafka publishing follows the existing cached producer style used in `auth`, `tenants`, and `codegen`
- Kubernetes manifests mirror the current `*-depl` / `*-srv` naming and `mongodb-secret` / `auth-jwt-secret` secret wiring
- Wallet and pricebook integration now reuse the existing tenant wallet and billing-rating pipeline already running in the platform

## Endpoints

- `POST /api/v1/llm/chat/completions`
- `POST /api/v1/llm/embeddings`
- `GET /api/v1/llm/models`
- `GET /playground`
- `GET /healthz`

## Public model syntax

Provider-qualified:

- `@openai/gpt-5.4`
- `@openai/gpt-5.3`
- `@openai/gpt-5.2`
- `@openai/gpt-5.1`
- `@openai/gpt-4.1-mini`
- `@openai/gpt-4o-mini`
- `@openai/text-embedding-3-small`
- `@anthropic/claude-sonnet-4`

Agumbe aliases:

- `smart-default -> @openai/gpt-4.1-mini`
- `cheap-fast -> @openai/gpt-4o-mini`
- `reasoning -> @anthropic/claude-sonnet-4`
- `embed-default -> @openai/text-embedding-3-small`

Model resolution rules:

- `@openai/...` resolves to provider `openai`
- `@anthropic/...` resolves to provider `anthropic`
- `@google/...` resolves to provider `google` (Gemini scaffold only in this MVP)
- unqualified values are treated as Agumbe aliases
- chat routes reject embeddings-only models
- embeddings routes reject chat-only models

## Provider translation

The public API stays compatibility-first, but the adapters stay provider-native:

- OpenAI chat strips the provider prefix and forwards the request to `chat.completions.create`
- Anthropic chat combines system messages into top-level `system`, maps the rest into Anthropic Messages API format, and normalizes the response back to an OpenAI-style shape
- OpenAI embeddings strip the provider prefix and normalize the embeddings response back to OpenAI-compatible output
- Gemini is scaffolded in `src/providers/gemini.ts` and currently returns a clear not-enabled error

## Mongo logging

Each inference request writes a record to the `llm_requests` collection with:

- `tenantId`
- `userId`
- `requestId`
- `requestKind`
- `requestedModel`
- `provider`
- `upstreamModel`
- `status`
- `latencyMs`
- `promptTokens`
- `completionTokens`
- `totalTokens`
- `estimatedCost`
- `errorCode`
- `createdAt`

Full request and response payload storage is off by default and can be enabled with `STORE_LLM_PAYLOADS=true`.

## Kafka usage events

Success and failure both emit to `KAFKA_TOPIC_USAGE` (default `llm_usage_raw`) with:

- `eventType`
- `tenantId`
- `userId`
- `requestId`
- `requestKind`
- `requestedModel`
- `provider`
- `upstreamModel`
- `promptTokens`
- `completionTokens`
- `totalTokens`
- `latencyMs`
- `status`
- `estimatedCost`
- `errorCode`
- `timestamp`

When `KAFKA_TOPIC_BILLING` is set, successful requests also emit a second billing envelope with Kafka key `billing_usage_raw`. That envelope matches the existing tenants billing listener shape so the current pricebook and wallet-debit flow can rate and charge usage without changing the public API.

## Billing enforcement

`llm-gateway` can now block unpaid usage before it calls an upstream model.

When `BILLING_ENFORCEMENT_ENABLED=true` the gateway will:

- fetch the tenant wallet from `TENANTS_BASE_URL/api/v1/tenants/wallet` using the caller's Bearer token
- estimate the maximum request spend from `BILLING_PRICING_JSON` and request size
- convert the estimated billable amount into wallet denits using the tenant wallet's `denits_per_unit`
- reject the request with `402 insufficient_credits` if the tenant balance is too low

This is intentionally conservative for chat:

- prompt tokens are estimated from request text length
- completion tokens use `max_tokens` if present
- otherwise they fall back to `BILLING_CHAT_DEFAULT_MAX_TOKENS`

Current enforcement is intentionally strict:

- only OpenAI models are allowed when billing enforcement is enabled
- Anthropic and Gemini requests are rejected with `billing_provider_unavailable` until the downstream billing listener and pricebook are expanded for those meters
- if a billable model has no entry in `BILLING_PRICING_JSON`, the request is rejected with `billing_price_unavailable` instead of running for free

## Environment variables

Required:

- `MONGO_URI`
- `JWT_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`

Common runtime:

- `PORT` default `3000`
- `SERVICE_NAME` default `llm-gateway`
- `CORS_ALLOWED_ORIGINS` default `https://agumbe.ai`
- `AUTH_BASE_URL` default `https://development.agumbe.dev`
- `TENANTS_BASE_URL` for wallet checks, for example `https://development.agumbe.dev`
- `REQUEST_TIMEOUT_MS` default `30000`
- `RATE_LIMIT_MAX` default `60`
- `RATE_LIMIT_WINDOW` default `1 minute`
- `STORE_LLM_PAYLOADS` default `false`
- `BILLING_ENFORCEMENT_ENABLED` default `false`
- `BILLING_TIMEOUT_MS` default `5000`
- `BILLING_CHAT_DEFAULT_MAX_TOKENS` default `512`
- `BILLING_PRICING_JSON` billable sell-side pricing used for wallet prechecks

Kafka:

- `KAFKA_ENABLED` default `false`
- `KAFKA_BROKERS` or `KAFKA_SERVERS`
- `KAFKA_CLIENT_ID`
- `KAFKA_TOPIC_USAGE`
- optional `KAFKA_TOPIC_BILLING`
- optional `KAFKA_PROTOCOL`
- optional `KAFKA_MECHANISMS`
- optional `KAFKA_USERNAME`
- optional `KAFKA_PASSWORD`
- optional `KAFKA_TIMEOUT_MS`

Optional:

- `GOOGLE_API_KEY`
- `MODEL_PRICING_JSON`

`MODEL_PRICING_JSON` lets you supply deploy-time cost estimates instead of hardwiring stale provider pricing into the service. Example:

```json
{
  "@openai/gpt-4.1-mini": {
    "promptPer1kUsd": 0.0004,
    "completionPer1kUsd": 0.0016
  }
}
```

For billing enforcement, make sure every billable model you expose has an entry in `BILLING_PRICING_JSON`. A model without pricing will be denied when `BILLING_ENFORCEMENT_ENABLED=true`.

## Local development

```bash
npm install
cp .env.example .env
npm start
```

If you do not want Kafka locally, keep `KAFKA_ENABLED=false`.

If browser code hosted on `agumbe.ai` calls `api.agumbe.ai` directly, keep `CORS_ALLOWED_ORIGINS=https://agumbe.ai`. Multiple allowed origins can be supplied as a comma-separated list.

For internal testing, the gateway also exposes a browser playground at `/playground`.

The playground now supports:

- email/password signup with verification-email handoff
- email/password sign-in through the existing auth service
- Google OAuth return-to-playground flow
- app token creation using the existing `/app/register` + `/app/token` flow
- local recent-request history
- per-run usage and estimated cost summaries

`AUTH_BASE_URL` controls which auth environment the playground proxies to. In the current short-lived `api.agumbe.ai -> development` setup, keep this pointed at `https://development.agumbe.dev`.

## Build and run

```bash
npm run build
npm run start:prod
```

## Kubernetes

`llm-gateway` manifests now live in the shared manifests repo at `manifests-index/infra/k8s/llm-gateway`, matching the other Agumbe core services.

Current conventions there:

- deployment name: `llm-gateway-depl`
- service name: `llm-gateway-srv`
- Mongo secret: `mongodb-secret`
- JWT secret: `auth-jwt-secret`
- Kafka secret: `confluent-kafka-secret`
- provider key secrets: `openai-api-secret` and `anthropic-api-secret`
