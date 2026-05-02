# llm-gateway-community

`llm-gateway-community` is a community edition of the gateway: an OpenAI-compatible HTTP service for chat completions and embeddings with provider routing, optional guardrails, request logging, and usage telemetry.

It is designed to run in a lightweight local setup:

- auth can be disabled for local and single-tenant use
- MongoDB is optional
- Kafka is optional
- provider adapters are enabled only when their API keys are configured

## Community edition scope

This package keeps the inference gateway core public and usable:

- `POST /api/v1/llm/chat/completions`
- `POST /api/v1/llm/embeddings`
- `GET /api/v1/llm/models`
- `GET /healthz`

Optional management routes remain available when auth and storage are configured:

- `GET /api/v1/llm/guardrails`
- `PUT /api/v1/llm/guardrails`
- `GET /api/v1/llm/requests`
- `POST /api/v1/internal/api-keys`
- `DELETE /api/v1/internal/api-keys/:keyId`

## Install

```bash
npm install
cp .env.example .env
npm run build
npm run start:prod
```

You can also run the published package as a CLI:

```bash
npx @agumbe/llm-gateway-community
```

## Quick start

The simplest local setup uses no auth, no MongoDB, and a single provider key:

```env
PORT=3000
AUTH_MODE=none
OPENAI_API_KEY=your-key-here
```

Then start the server:

```bash
npm start
```

Example request:

```bash
curl http://localhost:3000/api/v1/llm/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "@openai/gpt-4.1-mini",
    "messages": [
      { "role": "user", "content": "Say hello from the community gateway." }
    ]
  }'
```

## Auth modes

`AUTH_MODE=none`

- recommended for local development and simple trusted deployments
- the gateway injects a default user and tenant from `AUTH_DEFAULT_USER_ID` and `AUTH_DEFAULT_TENANT_ID`

`AUTH_MODE=jwt`

- requires `JWT_KEY`
- expects a JWT with `id` or `sub`, plus `tenant_id` or `tenantId`
- also supports API-key auth backed by MongoDB when `MONGO_URI` is set

## Storage and telemetry

Without `MONGO_URI`:

- guardrail policies are kept in memory
- request logs are kept in memory for the current process
- API-key management routes are not registered

With `MONGO_URI`:

- guardrail policies persist in MongoDB
- request logs persist in MongoDB
- API-key management routes are enabled

With `KAFKA_ENABLED=true`:

- usage events are emitted to `KAFKA_TOPIC_USAGE`
- dead-letter events can be emitted to `KAFKA_TOPIC_DEAD_LETTER` when `DEAD_LETTER_ENABLED=true`

## Supported model syntax

Provider-qualified examples:

- `@openai/gpt-5.4`
- `@openai/gpt-4.1-mini`
- `@openai/gpt-4o-mini`
- `@openai/text-embedding-3-small`
- `@anthropic/claude-sonnet-4`

Curated aliases:

- `smart-default -> @openai/gpt-4.1-mini`
- `cheap-fast -> @openai/gpt-4o-mini`
- `reasoning -> @anthropic/claude-sonnet-4`
- `embed-default -> @openai/text-embedding-3-small`

If a provider is not configured, requests for that provider return a clear unsupported-provider error.

## Environment

Common:

- `PORT` default `3000`
- `SERVICE_NAME` default `llm-gateway`
- `CORS_ALLOWED_ORIGINS` default `*`
- `AUTH_MODE` default `none`
- `AUTH_DEFAULT_USER_ID` default `community-user`
- `AUTH_DEFAULT_TENANT_ID` default `community`
- `REQUEST_TIMEOUT_MS` default `30000`
- `RATE_LIMIT_MAX` default `60`
- `RATE_LIMIT_WINDOW` default `1 minute`
- `STORE_LLM_PAYLOADS` default `false`

Auth:

- `JWT_KEY` required when `AUTH_MODE=jwt`

Providers:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`

Mongo:

- `MONGO_URI`

Kafka:

- `KAFKA_ENABLED` default `false`
- `KAFKA_BROKERS` or `KAFKA_SERVERS`
- `KAFKA_CLIENT_ID`
- `KAFKA_TOPIC_USAGE`
- `KAFKA_TOPIC_DEAD_LETTER`
- optional `KAFKA_PROTOCOL`
- optional `KAFKA_MECHANISMS`
- optional `KAFKA_USERNAME`
- optional `KAFKA_PASSWORD`
- optional `KAFKA_TIMEOUT_MS`

Pricing:

- `MODEL_PRICING_JSON`
- `ROUTING_CONFIG_JSON`
- `RELIABILITY_CONFIG_JSON`
- `DEAD_LETTER_ENABLED`

Example:

```json
{
  "@openai/gpt-4.1-mini": {
    "promptPer1kUsd": 0.0004,
    "completionPer1kUsd": 0.0016
  }
}
```

Routing example:

```json
{
  "smart-default": {
    "maxAttempts": 2,
    "candidates": [
      { "model": "@openai/gpt-4.1-mini", "weight": 3, "retryAttempts": 2 },
      { "model": "@anthropic/claude-sonnet-4", "weight": 1, "retryAttempts": 1 }
    ]
  }
}
```

When a routing rule is configured, the gateway:

- picks a primary candidate using weights
- retries that candidate up to `retryAttempts`
- falls back to the next candidate when the failure is retryable

Reliability example:

```json
{
  "defaultTimeoutMs": 30000,
  "providers": {
    "openai": {
      "timeoutMs": 20000,
      "circuitBreaker": {
        "failureThreshold": 3,
        "cooldownMs": 30000
      }
    }
  },
  "models": {
    "@openai/gpt-4.1-mini": {
      "timeoutMs": 10000
    }
  }
}
```

With reliability config enabled, the community gateway supports:

- timeout overrides by provider or model
- in-memory circuit breakers with cooldown-based recovery
- dead-letter events for terminal request failures

## Docker

```bash
cp .env.example .env
docker compose up --build
```

## Development

```bash
npm install
npm run test:ci
npm run build
```

## Publish notes

- Chosen npm package name: `@agumbe/llm-gateway-community`
- The scope keeps the package tied to the Agumbe namespace while still publishing publicly.
- `publishConfig.access=public` is already set for scoped public npm publishing.
- Use the checklist in `PUBLISHING.md` before running `npm publish`.

## Notes

- The gateway keeps a few existing `agumbe_*` metadata fields and headers for backward compatibility with current clients.
- Gemini remains scaffolded and returns a not-enabled response unless you extend the adapter.
