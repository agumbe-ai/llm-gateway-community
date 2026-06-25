import { z } from "zod";
import { guardrailPolicySchema, type GuardrailTrace } from "./guardrails";

const agumbeMetadataSchema = z.object({
  environment: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  workspace_id: z.string().min(1).optional(),
  xnamespace_id: z.string().min(1).optional(),
  source_service: z.string().min(1).optional(),
  operation: z.string().min(1).optional(),
  external_request_id: z.string().min(1).optional(),
});

const responseFormatSchema = z.union([
  z.object({
    type: z.literal("json_object"),
  }),
  z.object({
    type: z.literal("json_schema"),
    json_schema: z
      .object({
        name: z.string().min(1),
        strict: z.boolean().optional(),
      })
      .passthrough(),
  }),
]);

const responseInputSchema = z.union([
  z.string().min(1),
  z.array(z.unknown()).min(1),
]);

export const responsesRequestSchema = z.object({
  model: z.string().min(1),
  input: responseInputSchema,
  instructions: z.string().min(1).optional(),
  previous_response_id: z.string().min(1).optional(),
  max_output_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  response_format: responseFormatSchema.optional(),
  text: z.unknown().optional(),
  tools: z.unknown().optional(),
  tool_choice: z.unknown().optional(),
  parallel_tool_calls: z.boolean().optional(),
  include: z.unknown().optional(),
  reasoning: z.unknown().optional(),
  store: z.boolean().optional(),
  prompt_cache_key: z.string().min(1).optional(),
  service_tier: z.string().min(1).optional(),
  client_metadata: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  anthropic_beta: z.string().min(1).optional(),
  anthropic_version: z.string().min(1).optional(),
  stream: z.boolean().optional(),
  agumbe_metadata: agumbeMetadataSchema.optional(),
  agumbe_guardrails_app_id: z.string().min(1).optional(),
  agumbe_grounding_context: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .optional(),
  agumbe_guardrails: guardrailPolicySchema.optional(),
});

export type ResponsesRequest = z.infer<typeof responsesRequestSchema>;

export type ResponsesResponse = Record<string, unknown> & {
  id?: string;
  object?: string;
  created_at?: number;
  model?: string;
  output_text?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  agumbe_guardrails?: GuardrailTrace;
};
