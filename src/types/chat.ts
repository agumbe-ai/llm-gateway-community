import { z } from "zod";
import { guardrailPolicySchema, type GuardrailTrace } from "./guardrails";

export const chatMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1),
});

const rawChatRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    agumbe_guardrails_app_id: z.string().min(1).optional(),
    agumbe_grounding_context: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]).optional(),
    agumbe_guardrails: guardrailPolicySchema.optional(),
  })
  .refine((value) => value.messages.some((message) => message.role === "user"), {
    message: "messages must include at least one user message",
    path: ["messages"],
  });

export const chatRequestSchema = z
  .object({
    model: z.string().min(1),
    messages: z.array(chatMessageSchema).min(1),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    max_output_tokens: z.number().int().positive().optional(),
    temperature: z.number().min(0).max(2).optional(),
    agumbe_guardrails_app_id: z.string().min(1).optional(),
    agumbe_grounding_context: z
      .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
      .optional(),
    agumbe_guardrails: guardrailPolicySchema.optional(),
  })
  .refine((value) => value.messages.some((message) => message.role === "user"), {
    message: "messages must include at least one user message",
    path: ["messages"],
  });

export type ChatRequest = z.infer<typeof chatRequestSchema>;

export type ChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: string | null;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  agumbe_guardrails?: GuardrailTrace;
};
