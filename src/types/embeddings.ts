import { z } from "zod";
import { guardrailPolicySchema, type GuardrailTrace } from "./guardrails";

const agumbeMetadataSchema = z.object({
  workspace_id: z.string().min(1).optional(),
  xnamespace_id: z.string().min(1).optional(),
  source_service: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
  external_request_id: z.string().min(1).optional(),
});

const embeddingInputSchema = z.union([
  z.string().min(1),
  z.array(z.string().min(1)).min(1),
]);

export const embeddingsRequestSchema = z.object({
  model: z.string().min(1),
  input: embeddingInputSchema,
  agumbe_metadata: agumbeMetadataSchema.optional(),
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
