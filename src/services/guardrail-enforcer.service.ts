import type { ChatMessage, ResolvedModel } from "../providers/types";
import type { ChatRequest } from "../types/chat";
import type { EmbeddingsRequest } from "../types/embeddings";
import type {
  GuardrailDecision,
  GuardrailMode,
  GuardrailPolicy,
  GuardrailTrace,
} from "../types/guardrails";
import { AppError } from "../utils/errors";
import type { AuthenticatedRequestContext } from "./chat.service";

type PreparedChatRequest = {
  request: ChatRequest;
  trace: GuardrailTrace;
};

type PreparedEmbeddingsRequest = {
  request: EmbeddingsRequest;
  trace: GuardrailTrace;
};

type OutputInspection = {
  content: string;
  trace: GuardrailTrace;
};

type RedactionRule = {
  label: string;
  pattern: RegExp;
  replacement: string;
};

const DIRECT_PROMPT_INJECTION_RULES: RedactionRule[] = [
  {
    label: "ignore previous instructions",
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/gi,
    replacement: "[REDACTED_PROMPT_INJECTION]",
  },
  {
    label: "disregard system prompt",
    pattern: /disregard\s+(the\s+)?(system|previous)\s+prompt/gi,
    replacement: "[REDACTED_PROMPT_INJECTION]",
  },
  {
    label: "reveal hidden prompt",
    pattern: /reveal\s+(the\s+)?(system|hidden)\s+prompt/gi,
    replacement: "[REDACTED_PROMPT_INJECTION]",
  },
  {
    label: "bypass safety",
    pattern: /bypass\s+(safety|guardrails|filters)/gi,
    replacement: "[REDACTED_PROMPT_INJECTION]",
  },
];

const INDIRECT_PROMPT_INJECTION_RULES: RedactionRule[] = [
  {
    label: "document embedded instruction override",
    pattern: /(?:the\s+following\s+text|document|article).{0,80}(?:ignore|override|disregard).{0,80}(?:instructions|system)/gis,
    replacement: "[REDACTED_INDIRECT_PROMPT_INJECTION]",
  },
  {
    label: "hidden instruction marker",
    pattern: /(?:system\s+override|developer\s+instruction|hidden\s+instruction)/gi,
    replacement: "[REDACTED_INDIRECT_PROMPT_INJECTION]",
  },
  {
    label: "retrieved content jailbreak",
    pattern: /(?:when\s+you\s+read\s+this\s+document|from\s+this\s+document).{0,80}(?:follow\s+these\s+instructions|answer\s+with)/gis,
    replacement: "[REDACTED_INDIRECT_PROMPT_INJECTION]",
  },
];

const PII_RULES: RedactionRule[] = [
  {
    label: "email address",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    label: "phone number",
    pattern: /(?:\+?\d{1,3}[\s-]?)?(?:\(?\d{3}\)?[\s-]?)\d{3}[\s-]?\d{4}\b/g,
    replacement: "[REDACTED_PHONE]",
  },
  {
    label: "social security number",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
  },
  {
    label: "payment card number",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: "[REDACTED_CARD]",
  },
];

const SECRET_RULES: RedactionRule[] = [
  {
    label: "openai secret",
    pattern: /\bsk-[A-Za-z0-9]{20,}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
  {
    label: "github personal access token",
    pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
  {
    label: "aws access key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
  {
    label: "private key material",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    label: "jwt token",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}\.[A-Za-z0-9._-]{10,}\b/g,
    replacement: "[REDACTED_JWT]",
  },
];

const OUTPUT_SAFETY_RULES: RedactionRule[] = [
  {
    label: "explosive instructions",
    pattern: /\b(?:build|make|assemble)\s+(?:a\s+)?bomb\b/gi,
    replacement: "[REDACTED_UNSAFE_OUTPUT]",
  },
  {
    label: "malware instructions",
    pattern: /\b(?:write|create|deploy)\s+(?:a\s+)?(?:malware|ransomware|keylogger)\b/gi,
    replacement: "[REDACTED_UNSAFE_OUTPUT]",
  },
  {
    label: "phishing guidance",
    pattern: /\b(?:write|generate|draft)\s+(?:a\s+)?phishing\s+(?:email|message)\b/gi,
    replacement: "[REDACTED_UNSAFE_OUTPUT]",
  },
  {
    label: "credential theft guidance",
    pattern: /\b(?:steal|exfiltrate|harvest)\s+(?:passwords|credentials|tokens)\b/gi,
    replacement: "[REDACTED_UNSAFE_OUTPUT]",
  },
];

function cloneMessages(messages: ChatMessage[]) {
  return messages.map((message) => ({ ...message }));
}

function cloneEmbeddingsInput(input: string | string[]) {
  return Array.isArray(input) ? [...input] : input;
}

function summarizeMatches(text: string, rules: RedactionRule[]) {
  const labels: string[] = [];

  for (const rule of rules) {
    rule.pattern.lastIndex = 0;
    if (rule.pattern.test(text)) {
      labels.push(rule.label);
    }
  }

  return labels;
}

function redactText(text: string, rules: RedactionRule[]) {
  let next = text;

  for (const rule of rules) {
    next = next.replace(rule.pattern, rule.replacement);
  }

  return next;
}

function normalizeTopic(value: string) {
  return value.trim().toLowerCase();
}

function createTrace(
  context: AuthenticatedRequestContext,
  policy: GuardrailPolicy | undefined,
  appliedAppId?: string,
): GuardrailTrace {
  return {
    applied: Boolean(policy),
    subject: context.subjectType,
    appId: appliedAppId || context.appId,
    decisions: [],
  };
}

function addDecision(
  trace: GuardrailTrace,
  decision: Omit<GuardrailDecision, "detail"> & { detail?: string },
) {
  trace.decisions.push({
    ...decision,
    detail: decision.detail || "",
  });
}

function blockError(message: string, param: string, code = "guardrail_blocked") {
  return new AppError(message, {
    statusCode: 400,
    code,
    type: "invalid_request_error",
    param,
  });
}

function rateLimitError(message = "Request blocked by guardrail rate limit") {
  return new AppError(message, {
    statusCode: 429,
    code: "guardrail_rate_limit_exceeded",
    type: "rate_limit_error",
    param: "rateLimitPerMinute",
  });
}

function tokenize(text: string) {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).filter((token) => token.length > 2);
}

function uniqueTokens(text: string) {
  return new Set(tokenize(text));
}

function splitSentences(text: string) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 18);
}

export class GuardrailEnforcerService {
  private readonly requestBuckets = new Map<string, number[]>();

  prepareChatRequest(
    context: AuthenticatedRequestContext,
    input: ChatRequest,
    resolvedModel: ResolvedModel,
    policy: GuardrailPolicy | undefined,
    appliedAppId?: string,
  ): PreparedChatRequest {
    const trace = createTrace(context, policy, appliedAppId);
    const request: ChatRequest = {
      ...input,
      messages: cloneMessages(input.messages),
    };

    this.enforceSharedPolicies(context, request.model, resolvedModel, policy, trace, appliedAppId);

    if (policy?.maxTokens) {
      const nextMaxTokens = Math.min(request.max_tokens ?? policy.maxTokens, policy.maxTokens);
      if (request.max_tokens !== nextMaxTokens) {
        addDecision(trace, {
          guardrail: "max_tokens",
          stage: "request",
          action: "capped",
          mode: "enforce",
          detail: `Capped max tokens to ${policy.maxTokens}`,
        });
      }
      request.max_tokens = nextMaxTokens;
    }

    request.messages = request.messages.map((message) => {
      let content = message.content;

      content = this.applyRuleSet({
        content,
        mode: policy?.promptInjection ?? "off",
        rules: DIRECT_PROMPT_INJECTION_RULES,
        trace,
        guardrail: "prompt_injection",
        stage: "input",
        blockMessage: "Prompt blocked by prompt-injection guardrail",
        blockParam: "messages",
      });

      content = this.applyRuleSet({
        content,
        mode: policy?.indirectPromptInjection ?? "off",
        rules: INDIRECT_PROMPT_INJECTION_RULES,
        trace,
        guardrail: "indirect_prompt_injection",
        stage: "input",
        blockMessage: "Prompt blocked by indirect prompt-injection guardrail",
        blockParam: "messages",
      });

      if (message.role === "user") {
        content = this.applyRuleSet({
          content,
          mode: policy?.pii ?? "off",
          rules: PII_RULES,
          trace,
          guardrail: "pii",
          stage: "input",
          blockMessage: "Prompt blocked by PII guardrail",
          blockParam: "messages",
        });

        content = this.applyRuleSet({
          content,
          mode: policy?.secrets ?? "off",
          rules: SECRET_RULES,
          trace,
          guardrail: "secrets",
          stage: "input",
          blockMessage: "Prompt blocked by secrets guardrail",
          blockParam: "messages",
        });

        content = this.applyDeniedTopics({
          content,
          mode: policy?.deniedTopics ?? "off",
          topics: policy?.deniedTopicsList || [],
          trace,
          blockMessage: "Prompt blocked by denied-topics guardrail",
          blockParam: "messages",
        });
      }

      return {
        ...message,
        content,
      };
    });

    return { request, trace };
  }

  prepareEmbeddingsRequest(
    context: AuthenticatedRequestContext,
    input: EmbeddingsRequest,
    resolvedModel: ResolvedModel,
    policy: GuardrailPolicy | undefined,
    appliedAppId?: string,
  ): PreparedEmbeddingsRequest {
    const trace = createTrace(context, policy, appliedAppId);
    const request: EmbeddingsRequest = {
      ...input,
      input: cloneEmbeddingsInput(input.input),
    };

    this.enforceSharedPolicies(context, request.model, resolvedModel, policy, trace, appliedAppId);

    const transformValue = (value: string) => {
      let content = value;

      content = this.applyRuleSet({
        content,
        mode: policy?.promptInjection ?? "off",
        rules: DIRECT_PROMPT_INJECTION_RULES,
        trace,
        guardrail: "prompt_injection",
        stage: "input",
        blockMessage: "Embedding input blocked by prompt-injection guardrail",
        blockParam: "input",
      });

      content = this.applyRuleSet({
        content,
        mode: policy?.indirectPromptInjection ?? "off",
        rules: INDIRECT_PROMPT_INJECTION_RULES,
        trace,
        guardrail: "indirect_prompt_injection",
        stage: "input",
        blockMessage: "Embedding input blocked by indirect prompt-injection guardrail",
        blockParam: "input",
      });

      content = this.applyRuleSet({
        content,
        mode: policy?.pii ?? "off",
        rules: PII_RULES,
        trace,
        guardrail: "pii",
        stage: "input",
        blockMessage: "Embedding input blocked by PII guardrail",
        blockParam: "input",
      });

      content = this.applyRuleSet({
        content,
        mode: policy?.secrets ?? "off",
        rules: SECRET_RULES,
        trace,
        guardrail: "secrets",
        stage: "input",
        blockMessage: "Embedding input blocked by secrets guardrail",
        blockParam: "input",
      });

      content = this.applyDeniedTopics({
        content,
        mode: policy?.deniedTopics ?? "off",
        topics: policy?.deniedTopicsList || [],
        trace,
        blockMessage: "Embedding input blocked by denied-topics guardrail",
        blockParam: "input",
      });

      return content;
    };

    request.input = Array.isArray(request.input)
      ? request.input.map(transformValue)
      : transformValue(request.input);

    return { request, trace };
  }

  inspectChatOutput(
    context: AuthenticatedRequestContext,
    content: string,
    policy: GuardrailPolicy | undefined,
    trace: GuardrailTrace,
    groundingContext?: string | string[],
  ): OutputInspection {
    if (!policy) {
      return {
        content,
        trace,
      };
    }

    let nextContent = this.applyRuleSet({
      content,
      mode: policy.outputSafety ?? "off",
      rules: OUTPUT_SAFETY_RULES,
      trace,
      guardrail: "output_safety",
      stage: "output",
      blockMessage:
        context.subjectType === "app"
          ? "Output blocked by guardrail policy for this app"
          : "Output blocked by guardrail policy for this session",
      blockParam: "choices[0].message.content",
    });

    nextContent = this.applyRuleSet({
      content: nextContent,
      mode: policy.pii ?? "off",
      rules: PII_RULES,
      trace,
      guardrail: "pii",
      stage: "output",
      blockMessage: "Output blocked by PII guardrail",
      blockParam: "choices[0].message.content",
    });

    nextContent = this.applyRuleSet({
      content: nextContent,
      mode: policy.secrets ?? "off",
      rules: SECRET_RULES,
      trace,
      guardrail: "secrets",
      stage: "output",
      blockMessage: "Output blocked by secrets guardrail",
      blockParam: "choices[0].message.content",
    });

    nextContent = this.applyDeniedTopics({
      content: nextContent,
      mode: policy.deniedTopics ?? "off",
      topics: policy.deniedTopicsList || [],
      trace,
      blockMessage: "Output blocked by denied-topics guardrail",
      blockParam: "choices[0].message.content",
      stage: "output",
    });

    nextContent = this.applyGroundedness({
      content: nextContent,
      mode: policy.groundedness ?? "off",
      groundingContext,
      trace,
    });

    return {
      content: nextContent,
      trace,
    };
  }

  attachTrace<T extends object>(response: T, trace: GuardrailTrace): T {
    if (!trace.applied) {
      return response;
    }

    return {
      ...response,
      agumbe_guardrails: trace,
    };
  }

  private enforceSharedPolicies(
    context: AuthenticatedRequestContext,
    requestedModel: string,
    resolvedModel: ResolvedModel,
    policy: GuardrailPolicy | undefined,
    trace: GuardrailTrace,
    appliedAppId?: string,
  ) {
    if (!policy) {
      return;
    }

    if (policy.allowedModels?.length) {
      const allowed = new Set(policy.allowedModels);
      if (!allowed.has(requestedModel) && !allowed.has(resolvedModel.canonicalModel)) {
        addDecision(trace, {
          guardrail: "allowed_models",
          stage: "request",
          action: "blocked",
          mode: "enforce",
          detail: `Model ${resolvedModel.canonicalModel} is not in the allowlist`,
        });
        throw blockError("Model blocked by allowlist guardrail", "model", "guardrail_model_blocked");
      }
    }

    if (policy.rateLimitPerMinute) {
      const rateSubject = context.subjectType === "app"
        ? context.appId || context.userId
        : appliedAppId || context.userId;
      const key = [context.tenantId, context.subjectType, rateSubject, resolvedModel.kind].join(":");
      const now = Date.now();
      const windowStart = now - 60_000;
      const current = (this.requestBuckets.get(key) || []).filter((value) => value >= windowStart);

      if (current.length >= policy.rateLimitPerMinute) {
        addDecision(trace, {
          guardrail: "rate_limit",
          stage: "request",
          action: "rate_limited",
          mode: "enforce",
          detail: `Blocked after ${policy.rateLimitPerMinute} requests in one minute`,
        });
        this.requestBuckets.set(key, current);
        throw rateLimitError();
      }

      current.push(now);
      this.requestBuckets.set(key, current);
    }
  }

  private applyRuleSet({
    content,
    mode,
    rules,
    trace,
    guardrail,
    stage,
    blockMessage,
    blockParam,
  }: {
    content: string;
    mode: GuardrailMode;
    rules: RedactionRule[];
    trace: GuardrailTrace;
    guardrail: GuardrailDecision["guardrail"];
    stage: GuardrailDecision["stage"];
    blockMessage: string;
    blockParam: string;
  }) {
    if (mode === "off") {
      return content;
    }

    const matches = summarizeMatches(content, rules);
    if (!matches.length) {
      return content;
    }

    if (mode === "detect") {
      addDecision(trace, {
        guardrail,
        stage,
        action: "detected",
        mode,
        detail: `Detected ${matches.join(", ")}`,
      });
      return content;
    }

    if (mode === "redact") {
      addDecision(trace, {
        guardrail,
        stage,
        action: "redacted",
        mode,
        detail: `Redacted ${matches.join(", ")}`,
      });
      return redactText(content, rules);
    }

    addDecision(trace, {
      guardrail,
      stage,
      action: "blocked",
      mode,
      detail: `Blocked because of ${matches.join(", ")}`,
    });
    throw blockError(blockMessage, blockParam);
  }

  private applyDeniedTopics({
    content,
    mode,
    topics,
    trace,
    blockMessage,
    blockParam,
    stage = "input",
  }: {
    content: string;
    mode: GuardrailMode;
    topics: string[];
    trace: GuardrailTrace;
    blockMessage: string;
    blockParam: string;
    stage?: GuardrailDecision["stage"];
  }) {
    const normalizedTopics = topics.map(normalizeTopic).filter(Boolean);
    if (mode === "off" || normalizedTopics.length === 0) {
      return content;
    }

    const lowered = content.toLowerCase();
    const matched = normalizedTopics.filter((topic) => lowered.includes(topic));
    if (!matched.length) {
      return content;
    }

    if (mode === "detect") {
      addDecision(trace, {
        guardrail: "denied_topics",
        stage,
        action: "detected",
        mode,
        detail: `Detected denied topics: ${matched.join(", ")}`,
      });
      return content;
    }

    if (mode === "redact") {
      let next = content;
      for (const topic of matched) {
        const escaped = topic.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        next = next.replace(new RegExp(escaped, "gi"), "[REDACTED_TOPIC]");
      }
      addDecision(trace, {
        guardrail: "denied_topics",
        stage,
        action: "redacted",
        mode,
        detail: `Redacted denied topics: ${matched.join(", ")}`,
      });
      return next;
    }

    addDecision(trace, {
      guardrail: "denied_topics",
      stage,
      action: "blocked",
      mode,
      detail: `Blocked denied topics: ${matched.join(", ")}`,
    });
    throw blockError(blockMessage, blockParam, "guardrail_denied_topic_blocked");
  }

  private applyGroundedness({
    content,
    mode,
    groundingContext,
    trace,
  }: {
    content: string;
    mode: GuardrailMode;
    groundingContext?: string | string[];
    trace: GuardrailTrace;
  }) {
    if (mode === "off" || !groundingContext) {
      return content;
    }

    const contextText = Array.isArray(groundingContext)
      ? groundingContext.join("\n")
      : groundingContext;
    const contextTokens = uniqueTokens(contextText);
    if (contextTokens.size === 0) {
      return content;
    }

    const unsupportedSentences = splitSentences(content).filter((sentence) => {
      const sentenceTokens = tokenize(sentence);
      if (sentenceTokens.length < 4) {
        return false;
      }
      const overlap = sentenceTokens.filter((token) => contextTokens.has(token)).length;
      return overlap / sentenceTokens.length < 0.35;
    });

    if (!unsupportedSentences.length) {
      return content;
    }

    if (mode === "detect") {
      addDecision(trace, {
        guardrail: "groundedness",
        stage: "output",
        action: "detected",
        mode,
        detail: `Detected ${unsupportedSentences.length} potentially ungrounded sentences`,
      });
      return content;
    }

    if (mode === "redact") {
      let next = content;
      for (const sentence of unsupportedSentences) {
        next = next.replace(sentence, "[REDACTED_UNGROUNDED_CONTENT]");
      }
      addDecision(trace, {
        guardrail: "groundedness",
        stage: "output",
        action: "redacted",
        mode,
        detail: `Redacted ${unsupportedSentences.length} potentially ungrounded sentences`,
      });
      return next;
    }

    addDecision(trace, {
      guardrail: "groundedness",
      stage: "output",
      action: "blocked",
      mode,
      detail: `Blocked ${unsupportedSentences.length} potentially ungrounded sentences`,
    });
    throw blockError(
      "Output blocked by groundedness guardrail",
      "choices[0].message.content",
      "guardrail_groundedness_blocked",
    );
  }
}

