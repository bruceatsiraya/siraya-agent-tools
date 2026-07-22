import {
  buildRegistry,
  filterModels,
  recommendModel,
  validateRequest
} from "./registry.js";
import type {
  CallModelOptions,
  CallModelResult,
  ChatMessage,
  FilterModelsOptions,
  RecommendModelOptions,
  SirayaClientOptions,
  SirayaModel,
  SirayaModelCapability,
  SirayaRegistry,
  SirayaToolCall,
  SirayaToolDefinition,
  ValidationIssue
} from "./types.js";

declare const process: { env?: Record<string, string | undefined> } | undefined;

export class Siraya {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly registryUrl?: string;
  private readonly fetchImpl: typeof fetch;
  private registryCache?: SirayaRegistry;

  constructor(options: SirayaClientOptions = {}) {
    this.apiKey = options.apiKey ?? env("SIRAYA_API_KEY");
    this.baseUrl = trimRight(options.baseUrl ?? env("SIRAYA_BASE_URL") ?? "https://llm.siraya.ai/v1", "/");
    this.registryUrl = options.registryUrl;
    this.fetchImpl = options.fetch ?? fetch;
  }

  async listModels(): Promise<SirayaModel[]> {
    const json = await this.request<{ data: SirayaModel[] }>("/models");
    return json.data;
  }

  async getRegistry(options: { refresh?: boolean } = {}): Promise<SirayaRegistry> {
    if (!options.refresh && this.registryCache) return this.registryCache;
    if (this.registryUrl) {
      const response = await this.fetchImpl(this.registryUrl);
      if (response.ok) {
        this.registryCache = await response.json() as SirayaRegistry;
        return this.registryCache;
      }
    }
    this.registryCache = buildRegistry(await this.listModels(), `${this.baseUrl}/models`);
    return this.registryCache;
  }

  async getModelCapabilities(modelId: string): Promise<SirayaModelCapability | undefined> {
    const registry = await this.getRegistry();
    return registry.models.find((model) => model.id === modelId);
  }

  async filterModels(options: FilterModelsOptions = {}): Promise<SirayaModelCapability[]> {
    return filterModels(await this.getRegistry(), options);
  }

  async recommendModel(options: RecommendModelOptions = {}): Promise<SirayaModelCapability> {
    const registry = await this.getRegistry();
    const model = recommendModel(registry, options);
    if (!model) throw new Error(`No SIRAYA model matched ${JSON.stringify(options)}`);
    return model;
  }

  async validateRequest(modelId: string, request: Record<string, unknown>): Promise<ValidationIssue[]> {
    const model = await this.getModelCapabilities(modelId);
    if (!model) return [{ level: "error", parameter: "model", message: `Unknown model: ${modelId}` }];
    return validateRequest(model, request);
  }

  async chatCompletions(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/chat/completions", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  async responses(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/responses", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  async generateImage(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/images/generations", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  async generateVideo(request: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.request("/videos/generations", {
      method: "POST",
      body: JSON.stringify(request)
    });
  }

  async callModel(options: CallModelOptions): Promise<CallModelResult> {
    const selected = options.model && options.model !== "auto"
      ? await this.getModelCapabilities(options.model)
      : await this.recommendModel({
        task: options.task ?? (options.tools?.length ? "agent" : "chat"),
        require: options.tools?.length ? { toolCalling: true } : undefined,
        apiFormat: "openai_chat"
      });
    if (!selected) throw new Error(`Unknown SIRAYA model: ${options.model}`);

    const model = typeof selected === "string" ? selected : selected.id;
    const toolsByName = new Map((options.tools ?? []).map((candidate) => [candidate.function.name, candidate]));
    const messages: ChatMessage[] = [...options.messages];
    const steps = [];
    const maxSteps = options.maxSteps ?? 8;
    let finalText = "";
    let usage: unknown;
    let raw: unknown;

    for (let step = 1; step <= maxSteps; step += 1) {
      const request = this.buildChatRequest(model, messages, options);
      const issues = await this.validateRequest(model, request);
      const errors = issues.filter((issue) => issue.level === "error");
      if (errors.length) throw new Error(errors.map((issue) => issue.message).join("; "));

      const response = await this.chatCompletions(request);
      raw = response;
      usage = response.usage;
      const choice = extractChoice(response);
      const assistantMessage = choice.message ?? {};
      finalText = extractText(assistantMessage.content);
      const toolCalls = extractToolCalls(assistantMessage.tool_calls);

      messages.push({
        role: "assistant",
        content: assistantMessage.content ?? "",
        ...(toolCalls.length ? { tool_calls: toolCalls } as unknown as ChatMessage : {})
      });

      const toolResults = await executeToolCalls(toolCalls, toolsByName);
      for (const result of toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: result.toolCallId,
          name: result.name,
          content: JSON.stringify(result.result)
        });
      }

      steps.push({ model, request, response, toolResults });
      const stopContext = { step, text: finalText, toolCallCount: toolCalls.length, usage };
      if (!toolCalls.length || (options.stopWhen ?? []).some((condition) => condition(stopContext))) break;
    }

    return {
      model,
      text: finalText,
      messages,
      steps,
      usage,
      raw,
      getText: () => finalText
    };
  }

  private buildChatRequest(model: string, messages: ChatMessage[], options: CallModelOptions): Record<string, unknown> {
    return {
      model,
      messages,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.maxCompletionTokens !== undefined ? { max_completion_tokens: options.maxCompletionTokens } : {}),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
      ...(options.tools?.length ? { tools: options.tools.map(stripExecutor), tool_choice: "auto" } : {}),
      ...(options.extraBody ? options.extraBody : {}),
      extra_body: {
        ...(options.provider ? { provider: options.provider } : {}),
        ...(options.extraBody?.extra_body && typeof options.extraBody.extra_body === "object" ? options.extraBody.extra_body : {})
      }
    };
  }

  private async request<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.apiKey) throw new Error("SIRAYA_API_KEY is required.");
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "authorization": `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SIRAYA request failed: ${response.status} ${text}`);
    }
    return await response.json() as T;
  }
}

function stripExecutor(tool: SirayaToolDefinition): SirayaToolDefinition {
  const { execute: _execute, ...definition } = tool;
  return definition;
}

async function executeToolCalls(
  toolCalls: SirayaToolCall[],
  toolsByName: Map<string, SirayaToolDefinition>
): Promise<Array<{ toolCallId: string; name: string; result: unknown }>> {
  const results = [];
  for (const call of toolCalls) {
    const candidate = toolsByName.get(call.function.name);
    if (!candidate?.execute) throw new Error(`No executor registered for tool: ${call.function.name}`);
    const input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    results.push({
      toolCallId: call.id,
      name: call.function.name,
      result: await candidate.execute(input)
    });
  }
  return results;
}

function extractChoice(response: Record<string, unknown>): { message?: { content?: unknown; tool_calls?: unknown } } {
  const choices = response.choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return {};
  return choices[0] as { message?: { content?: unknown; tool_calls?: unknown } };
}

function extractToolCalls(value: unknown): SirayaToolCall[] {
  return Array.isArray(value) ? value as SirayaToolCall[] : [];
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => typeof part === "object" && part && "text" in part ? String((part as { text: unknown }).text) : "")
    .join("");
}

function env(name: string): string | undefined {
  if (typeof process === "undefined") return undefined;
  return process.env?.[name];
}

function trimRight(value: string, suffix: string): string {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
