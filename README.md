# llm-gateway

`llm-gateway` is a compatibility-first Agumbe core service for LLM inference. It exposes OpenAI-style chat and embeddings endpoints, resolves Agumbe aliases like `smart-default`, routes to provider-native adapters, logs request metadata to MongoDB, and emits raw usage events to Kafka.

## Reused Agumbe conventions

- JWT payload shape matches the existing auth service: `id`, `email`, `tenant_id`, `isVerified`, `isAdmin`
- Mongo connectivity uses the same single-process Mongoose connection pattern used by nearby services
- Kafka publishing follows the existing cached producer style used in `auth`, `tenants`, and `codegen`
- Kubernetes manifests mirror the current `*-depl` / `*-srv` naming and `mongodb-secret` / `auth-jwt-secret` secret wiring

## Endpoints

- `POST /api/v1/llm/chat/completions`
- `POST /api/v1/llm/embeddings`
- `GET /api/v1/llm/models`
- `GET /playground`
- `GET /healthz`

## Public model syntax

Provider-qualified:

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
- `REQUEST_TIMEOUT_MS` default `30000`
- `RATE_LIMIT_MAX` default `60`
- `RATE_LIMIT_WINDOW` default `1 minute`
- `STORE_LLM_PAYLOADS` default `false`

Kafka:

- `KAFKA_ENABLED` default `false`
- `KAFKA_BROKERS` or `KAFKA_SERVERS`
- `KAFKA_CLIENT_ID`
- `KAFKA_TOPIC_USAGE`
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

## Local development

```bash
npm install
cp .env.example .env
npm start
```

If you do not want Kafka locally, keep `KAFKA_ENABLED=false`.

If browser code hosted on `agumbe.ai` calls `api.agumbe.ai` directly, keep `CORS_ALLOWED_ORIGINS=https://agumbe.ai`. Multiple allowed origins can be supplied as a comma-separated list.

For internal testing, the gateway also exposes a lightweight browser playground at `/playground`.

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
