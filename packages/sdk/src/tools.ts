import type { SirayaToolDefinition } from "./types.js";

export function tool<TInput = unknown, TResult = unknown>(definition: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  strict?: boolean;
  execute: (input: TInput) => Promise<TResult> | TResult;
}): SirayaToolDefinition<TInput, TResult> {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
      strict: definition.strict ?? true
    },
    execute: definition.execute
  };
}
