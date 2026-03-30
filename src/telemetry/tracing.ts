import {
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  context,
  trace,
  type Attributes,
  type Context,
  type Span,
  type SpanOptions,
} from "@opentelemetry/api";
import { shouldCaptureGenAiEvents } from "../observability";

export type SpanAttributeMap = Attributes;

const tracer = trace.getTracer("llm-gateway");

function setDefinedAttributes(span: Span, attributes?: SpanAttributeMap) {
  if (!attributes) {
    return;
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (value !== undefined) {
      span.setAttribute(key, value);
    }
  }
}

function recordFailure(span: Span, error: unknown) {
  const exception = error instanceof Error ? error : new Error(String(error));

  span.recordException(exception);
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: exception.message,
  });
}

export function getActiveSpan() {
  return trace.getActiveSpan();
}

export function setActiveSpanAttributes(attributes: SpanAttributeMap) {
  const activeSpan = getActiveSpan();
  if (!activeSpan) {
    return;
  }

  setDefinedAttributes(activeSpan, attributes);
}

export function addActiveSpanEvent(name: string, attributes?: SpanAttributeMap) {
  if (!shouldCaptureGenAiEvents()) {
    return;
  }

  const activeSpan = getActiveSpan();
  if (!activeSpan) {
    return;
  }

  activeSpan.addEvent(name, attributes);
}

export function withSpanSync<T>(
  name: string,
  fn: (span: Span) => T,
  options?: SpanOptions,
  parentContext?: Context,
): T {
  const activeContext = parentContext ?? context.active();
  const span = tracer.startSpan(name, options, activeContext);

  try {
    const result = context.with(trace.setSpan(activeContext, span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordFailure(span, error);
    throw error;
  } finally {
    span.end();
  }
}

export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
  parentContext?: Context,
): Promise<T> {
  const activeContext = parentContext ?? context.active();
  const span = tracer.startSpan(name, options, activeContext);

  try {
    const result = await context.with(trace.setSpan(activeContext, span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (error) {
    recordFailure(span, error);
    throw error;
  } finally {
    span.end();
  }
}

export async function withRootSpan<T>(
  name: string,
  attributes: SpanAttributeMap,
  fn: (span: Span) => Promise<T>,
) {
  return withSpan(
    name,
    async (span) => {
      setDefinedAttributes(span, attributes);
      return fn(span);
    },
    {
      kind: SpanKind.SERVER,
      attributes,
    },
    ROOT_CONTEXT,
  );
}
