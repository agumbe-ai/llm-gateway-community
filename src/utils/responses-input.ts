export function responseInputItemIsUntrusted(
  record: Record<string, unknown>,
  inherited: boolean,
): boolean {
  if (record.role === "user" || record.role === "tool") {
    return true;
  }
  if (record.role === "assistant" || record.role === "system" || record.role === "developer") {
    return false;
  }
  if (record.type === "function_call_output" || record.type === "computer_call_output") {
    return true;
  }
  if (record.type === "function_call") {
    return false;
  }
  return inherited;
}
