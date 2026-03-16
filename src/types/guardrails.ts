import { z } from "zod";

export const guardrailModeSchema = z.enum(["off", "detect", "redact", "block"]);

export const guardrailPolicySchema = z.object({
  promptInjection: guardrailModeSchema.optional(),
  indirectPromptInjection: guardrailModeSchema.optional(),
  pii: guardrailModeSchema.optional(),
  secrets: guardrailModeSchema.optional(),
  deniedTopics: guardrailModeSchema.optional(),
  outputSafety: guardrailModeSchema.optional(),
  groundedness: guardrailModeSchema.optional(),
  deniedTopicsList: z.array(z.string().min(1)).optional(),
  allowedModels: z.array(z.string().min(1)).optional(),
  maxTokens: z.number().int().positive().optional(),
  rateLimitPerMinute: z.number().int().positive().optional(),
});

export type GuardrailMode = z.infer<typeof guardrailModeSchema>;
export type GuardrailPolicy = z.infer<typeof guardrailPolicySchema>;

export const DEFAULT_GUARDRAIL_POLICY: Required<GuardrailPolicy> = {
  promptInjection: "detect",
  indirectPromptInjection: "detect",
  pii: "redact",
  secrets: "redact",
  deniedTopics: "detect",
  outputSafety: "detect",
  groundedness: "detect",
  deniedTopicsList: [],
  allowedModels: [],
  maxTokens: 1024,
  rateLimitPerMinute: 60,
};

export type GuardrailDecisionAction =
  | "detected"
  | "redacted"
  | "blocked"
  | "capped"
  | "rate_limited";

export type GuardrailDecisionStage = "request" | "input" | "output";

export type GuardrailDecision = {
  guardrail:
    | "allowed_models"
    | "max_tokens"
    | "rate_limit"
    | "prompt_injection"
    | "indirect_prompt_injection"
    | "pii"
    | "secrets"
    | "denied_topics"
    | "output_safety"
    | "groundedness";
  stage: GuardrailDecisionStage;
  action: GuardrailDecisionAction;
  mode: GuardrailMode | "enforce";
  detail: string;
};

export type GuardrailTrace = {
  applied: boolean;
  subject: "session" | "app";
  appId?: string;
  decisions: GuardrailDecision[];
};
