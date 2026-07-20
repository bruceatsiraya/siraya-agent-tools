export type SirayaApiFormat = "openai_chat" | "openai_responses" | "anthropic_messages";

export type SirayaModelCategory = "text" | "image" | "video" | "audio" | "embedding" | "rerank";

export type SirayaTask =
  | "chat"
  | "agent"
  | "coding"
  | "reasoning"
  | "structured_output"
  | "vision"
  | "pdf"
  | "image_generation"
  | "video_generation"
  | "embedding"
  | "rerank";

export interface SirayaModel {
  id: string;
  object?: string;
  created?: number;
  owned_by?: string;
  [key: string]: unknown;
}

export interface SirayaModelCapability {
  id: string;
  provider?: string;
  providerName: string;
  family: "gpt" | "claude" | "gemini" | "deepseek" | "grok" | "qwen" | "kimi" | "glm" | "minimax" | "seed" | "image" | "video" | "audio" | "embedding" | "rerank" | "other";
  category: SirayaModelCategory;
  documentationUrl?: string;
  capabilitySource: "declared" | "inferred";
  apiFormats: SirayaApiFormat[];
  modalities: string[];
  features: {
    streaming: boolean;
    toolCalling: boolean;
    structuredOutputs: boolean;
    reasoning: boolean;
    promptCaching: "implicit" | "explicit" | "none" | "unknown";
    webSearch: boolean;
    imageInput: boolean;
    pdfInput: boolean;
    imageGeneration: boolean;
    videoGeneration: boolean;
    embeddings: boolean;
    reranking: boolean;
  };
  supportedParameters: string[];
  notes: string[];
  raw: SirayaModel;
}

export interface SirayaRegistry {
  object: "siraya.model_registry";
  generatedAt: string;
  source: string;
  models: SirayaModelCapability[];
}

export interface SirayaClientOptions {
  apiKey?: string;
  baseUrl?: string;
  registryUrl?: string;
  fetch?: typeof fetch;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: unknown;
  tool_call_id?: string;
  name?: string;
}

export interface SirayaToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface SirayaToolDefinition<TInput = unknown, TResult = unknown> {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
  execute?: (input: TInput) => Promise<TResult> | TResult;
}

export interface CallModelOptions {
  model?: string | "auto";
  task?: SirayaTask;
  messages: ChatMessage[];
  tools?: SirayaToolDefinition[];
  temperature?: number;
  maxCompletionTokens?: number;
  responseFormat?: Record<string, unknown>;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
  provider?: Record<string, unknown>;
  stopWhen?: StopCondition[];
  maxSteps?: number;
  extraBody?: Record<string, unknown>;
}

export interface CallModelStep {
  model: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
  toolResults: Array<{ toolCallId: string; name: string; result: unknown }>;
}

export interface CallModelResult {
  model: string;
  text: string;
  messages: ChatMessage[];
  steps: CallModelStep[];
  usage?: unknown;
  raw: unknown;
  getText(): string;
}

export interface RecommendModelOptions {
  task?: SirayaTask;
  require?: Partial<SirayaModelCapability["features"]>;
  preferProvider?: string[];
  avoidProvider?: string[];
  apiFormat?: SirayaApiFormat;
}

export interface ValidationIssue {
  level: "error" | "warning";
  parameter: string;
  message: string;
}

export interface StopContext {
  step: number;
  text: string;
  toolCallCount: number;
  usage?: unknown;
}

export type StopCondition = (context: StopContext) => boolean;
