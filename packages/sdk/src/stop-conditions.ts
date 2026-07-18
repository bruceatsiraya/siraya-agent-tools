import type { StopCondition } from "./types.js";

export function stepCountIs(maxSteps: number): StopCondition {
  return ({ step }) => step >= maxSteps;
}

export function hasToolCall(): StopCondition {
  return ({ toolCallCount }) => toolCallCount > 0;
}

export function textIncludes(fragment: string): StopCondition {
  return ({ text }) => text.includes(fragment);
}
