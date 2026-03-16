import { z } from "zod";
import { guardrailPolicySchema, type GuardrailTrace } from "./guardrails";

const embeddingInputSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

export const embeddingsRequestSchema = z.object({
  model: z.string().min(1),
  input: embeddingInputSchema,
  agumbe_guardrails_app_id: z.string().min(1).optional(),
  agumbe_guardrails: guardrailPolicySchema.optional(),
});

export type EmbeddingsRequest = z.infer<typeof embeddingsRequestSchema>;

export type EmbeddingsResponse = {
  object: "list";
  data: Array<{
    object: "embedding";
    embedding: number[];
    index: number;
  }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
  agumbe_guardrails?: GuardrailTrace;
};
