import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import type { Env } from "./config/env";

let sdk: NodeSDK | undefined;
let captureGenAiEvents = false;

function parseResourceAttributes(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce<Record<string, string>>((attributes, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return attributes;
      }

      const key = entry.slice(0, separatorIndex).trim();
      const attributeValue = entry.slice(separatorIndex + 1).trim();
      if (!key || !attributeValue) {
        return attributes;
      }

      attributes[key] = attributeValue;
      return attributes;
    }, {});
}

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function resolveOtlpEndpoint(baseEndpoint: string, signalPath: "v1/traces" | "v1/metrics") {
  return `${trimTrailingSlash(baseEndpoint)}/${signalPath}`;
}

export function shouldCaptureGenAiEvents() {
  return captureGenAiEvents;
}

export async function startObservability(env: Env) {
  captureGenAiEvents = env.OTEL_CAPTURE_GENAI_EVENTS;

  if (!env.OTEL_ENABLED || sdk) {
    return;
  }

  if (
    env.OTEL_EXPORTER_OTLP_PROTOCOL !== "http/json" &&
    env.OTEL_EXPORTER_OTLP_PROTOCOL !== "http/protobuf"
  ) {
    throw new Error(
      `Unsupported OTEL_EXPORTER_OTLP_PROTOCOL "${env.OTEL_EXPORTER_OTLP_PROTOCOL}" for HTTP OTLP exporters`,
    );
  }

  process.env.OTEL_TRACES_SAMPLER = process.env.OTEL_TRACES_SAMPLER || env.OTEL_TRACES_SAMPLER;
  if (env.OTEL_TRACES_SAMPLER_ARG) {
    process.env.OTEL_TRACES_SAMPLER_ARG =
      process.env.OTEL_TRACES_SAMPLER_ARG || env.OTEL_TRACES_SAMPLER_ARG;
  }

  if (env.LOG_LEVEL === "debug") {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO);
  }

  const traceEndpoint =
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
    resolveOtlpEndpoint(env.OTEL_EXPORTER_OTLP_ENDPOINT, "v1/traces");
  const metricsEndpoint =
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ||
    resolveOtlpEndpoint(env.OTEL_EXPORTER_OTLP_ENDPOINT, "v1/metrics");

  sdk = new NodeSDK({
    autoDetectResources: true,
    resource: resourceFromAttributes({
      ...parseResourceAttributes(env.OTEL_RESOURCE_ATTRIBUTES),
      "service.name": env.OTEL_SERVICE_NAME,
      "service.namespace": "agumbe",
      "service.version": env.OTEL_SERVICE_VERSION,
      "deployment.environment": env.DEPLOYMENT_ENVIRONMENT,
    }),
    traceExporter: new OTLPTraceExporter({
      url: traceEndpoint,
    }),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({
          url: metricsEndpoint,
        }),
      }),
    ],
    instrumentations: [
      getNodeAutoInstrumentations({
        "@opentelemetry/instrumentation-fastify": {
          enabled: false,
        },
        "@opentelemetry/instrumentation-http": {
          enabled: false,
        },
      }),
    ],
  });

  sdk.start();
}

export async function shutdownObservability() {
  if (!sdk) {
    return;
  }

  const currentSdk = sdk;
  sdk = undefined;
  await currentSdk.shutdown();
}
