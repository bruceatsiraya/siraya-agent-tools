import {
  buildRegistry,
  recommendModel,
  validateRequest,
  type RecommendModelOptions,
  type SirayaModel,
  type SirayaModelCapability,
  type SirayaRegistry
} from "@siraya/agent";
import { renderDocs } from "./docs.js";

interface Env {
  SIRAYA_API_KEY?: string;
  SIRAYA_BASE_URL?: string;
  ADMIN_TOKEN?: string;
  SIRAYA_REGISTRY: KVNamespace;
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const REGISTRY_KEY = "registry:latest";
const DEFAULT_BASE_URL = "https://llm.siraya.ai/v1";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (request.method === "GET") {
      const docs = renderDocs(url.pathname);
      if (docs) return docs;
    }
    if (url.pathname === "/health") return json({ ok: true, service: "siraya-mcp-worker" });
    if (url.pathname === "/registry" && request.method === "GET") return json(await getRegistry(env));
    if (url.pathname === "/models" && request.method === "GET") return json({ data: (await getRegistry(env)).models });
    if (url.pathname === "/refresh" && request.method === "POST") return refreshFromHttp(request, env);
    if (url.pathname === "/mcp" && request.method === "POST") return handleMcp(request, env);
    return json({ error: "not_found" }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshRegistry(env));
  }
};

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as JsonRpcRequest | JsonRpcRequest[];
  const agentApiKey = bearerToken(request);
  if (Array.isArray(body)) {
    const results = await Promise.all(body.map((item) => dispatchMcp(item, env, agentApiKey)));
    return json(results.filter(Boolean));
  }
  const result = await dispatchMcp(body, env, agentApiKey);
  return result ? json(result) : new Response(null, { status: 202 });
}

async function dispatchMcp(
  request: JsonRpcRequest,
  env: Env,
  agentApiKey?: string
): Promise<Record<string, unknown> | null> {
  try {
    if (request.method.startsWith("notifications/")) return null;
    if (request.method === "initialize") {
      return rpcResult(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "siraya-mcp-worker", version: "0.1.0" }
      });
    }
    if (request.method === "tools/list") return rpcResult(request.id, { tools: toolList() });
    if (request.method === "tools/call") {
      const name = String(request.params?.name ?? "");
      const args = asRecord(request.params?.arguments);
      const result = await callTool(name, args, env, agentApiKey);
      return rpcResult(request.id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
      });
    }
    return rpcError(request.id, -32601, `Unknown method: ${request.method}`);
  } catch (error) {
    return rpcError(request.id, -32000, error instanceof Error ? error.message : String(error));
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  env: Env,
  agentApiKey?: string
): Promise<unknown> {
  if (name === "siraya_list_models") {
    const refresh = Boolean(args.refresh);
    if (refresh) requireAgentApiKey(agentApiKey);
    const registry = await getRegistry(env, refresh, agentApiKey);
    return { generatedAt: registry.generatedAt, models: registry.models };
  }
  if (name === "siraya_get_model_capabilities") {
    const registry = await getRegistry(env, false, agentApiKey);
    const modelId = requiredString(args.model);
    const model = registry.models.find((candidate) => candidate.id === modelId);
    if (!model) throw new Error(`Unknown model: ${modelId}`);
    return model;
  }
  if (name === "siraya_recommend_model") {
    const registry = await getRegistry(env, false, agentApiKey);
    const model = recommendModel(registry, args as RecommendModelOptions);
    if (!model) throw new Error("No model matched the requested requirements.");
    return model;
  }
  if (name === "siraya_validate_request") {
    const registry = await getRegistry(env, false, agentApiKey);
    const modelId = requiredString(args.model);
    const request = asRecord(args.request);
    const model = findModel(registry, modelId);
    return { model: model.id, issues: validateRequest(model, request) };
  }
  if (name === "siraya_chat_completion") {
    return sirayaPost(env, "/chat/completions", asRecord(args.request), requireAgentApiKey(agentApiKey));
  }
  if (name === "siraya_responses") {
    return sirayaPost(env, "/responses", asRecord(args.request), requireAgentApiKey(agentApiKey));
  }
  if (name === "siraya_generate_image") {
    return sirayaPost(env, "/images/generations", asRecord(args.request), requireAgentApiKey(agentApiKey));
  }
  if (name === "siraya_generate_video") {
    return sirayaPost(env, "/videos/generations", asRecord(args.request), requireAgentApiKey(agentApiKey));
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function getRegistry(env: Env, refresh = false, fallbackApiKey?: string): Promise<SirayaRegistry> {
  if (!refresh) {
    const cached = await env.SIRAYA_REGISTRY.get<SirayaRegistry>(REGISTRY_KEY, "json");
    if (cached) return cached;
  }
  return refreshRegistry(env, fallbackApiKey);
}

async function refreshRegistry(env: Env, fallbackApiKey?: string): Promise<SirayaRegistry> {
  const apiKey = env.SIRAYA_API_KEY ?? fallbackApiKey;
  if (!apiKey) throw new Error("A SIRAYA API key is required to refresh the model registry.");
  const baseUrl = trimRight(env.SIRAYA_BASE_URL ?? DEFAULT_BASE_URL, "/");
  const response = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    throw new Error(`SIRAYA /models failed: ${response.status} ${await response.text()}`);
  }
  const payload = await response.json() as { data: SirayaModel[] };
  const registry = buildRegistry(payload.data, `${baseUrl}/models`);
  await env.SIRAYA_REGISTRY.put(REGISTRY_KEY, JSON.stringify(registry), {
    metadata: { generatedAt: registry.generatedAt }
  });
  return registry;
}

async function refreshFromHttp(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_TOKEN) return json({ error: "refresh_disabled" }, 503);
  if (!hasBearerToken(request, env.ADMIN_TOKEN)) return json({ error: "unauthorized" }, 401);
  return json(await refreshRegistry(env));
}

function requireAgentApiKey(apiKey?: string): string {
  if (!apiKey) throw new Error("This MCP tool requires the agent's SIRAYA_API_KEY as a Bearer token.");
  return apiKey;
}

function hasBearerToken(request: Request, expected?: string): boolean {
  if (!expected) return false;
  return bearerToken(request) === expected;
}

function bearerToken(request: Request): string | undefined {
  const value = request.headers.get("authorization");
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

async function sirayaPost(
  env: Env,
  path: string,
  request: Record<string, unknown>,
  apiKey: string
): Promise<unknown> {
  const baseUrl = trimRight(env.SIRAYA_BASE_URL ?? DEFAULT_BASE_URL, "/");
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(request)
  });
  const text = await response.text();
  const body = safeJson(text);
  if (!response.ok) throw new Error(`SIRAYA ${path} failed: ${response.status} ${text}`);
  return body;
}

function toolList(): Array<Record<string, unknown>> {
  return [
    {
      name: "siraya_list_models",
      description: "List SIRAYA Model Router models with inferred capabilities from the daily registry.",
      inputSchema: {
        type: "object",
        properties: { refresh: { type: "boolean", description: "Refresh from SIRAYA before returning." } },
        additionalProperties: false
      }
    },
    {
      name: "siraya_get_model_capabilities",
      description: "Get inferred capabilities, API formats, modalities, and notes for one SIRAYA model.",
      inputSchema: {
        type: "object",
        properties: { model: { type: "string" } },
        required: ["model"],
        additionalProperties: false
      }
    },
    {
      name: "siraya_recommend_model",
      description: "Recommend a SIRAYA model for a task and required feature set.",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string" },
          require: { type: "object" },
          preferProvider: { type: "array", items: { type: "string" } },
          avoidProvider: { type: "array", items: { type: "string" } },
          apiFormat: { type: "string" }
        },
        additionalProperties: false
      }
    },
    {
      name: "siraya_validate_request",
      description: "Check whether a request's parameters are expected to take effect for a selected model.",
      inputSchema: {
        type: "object",
        properties: {
          model: { type: "string" },
          request: { type: "object" }
        },
        required: ["model", "request"],
        additionalProperties: false
      }
    },
    rawCallTool("siraya_chat_completion", "Call SIRAYA /v1/chat/completions."),
    rawCallTool("siraya_responses", "Call SIRAYA /v1/responses."),
    rawCallTool("siraya_generate_image", "Call SIRAYA /v1/images/generations."),
    rawCallTool("siraya_generate_video", "Call SIRAYA /v1/videos/generations.")
  ];
}

function rawCallTool(name: string, description: string): Record<string, unknown> {
  return {
    name,
    description: `${description} Requires the agent's SIRAYA API key as a Bearer token.`,
    inputSchema: {
      type: "object",
      properties: { request: { type: "object" } },
      required: ["request"],
      additionalProperties: false
    }
  };
}

function findModel(registry: SirayaRegistry, modelId: string): SirayaModelCapability {
  const model = registry.models.find((candidate) => candidate.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  return model;
}

function rpcResult(id: JsonRpcRequest["id"], result: Record<string, unknown>): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, result };
}

function rpcError(id: JsonRpcRequest["id"], code: number, message: string): Record<string, unknown> {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function json(body: unknown, status = 200): Response {
  return cors(new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  }));
}

function cors(response: Response): Response {
  const next = new Response(response.body, response);
  next.headers.set("access-control-allow-origin", "*");
  next.headers.set("access-control-allow-methods", "GET,POST,OPTIONS");
  next.headers.set("access-control-allow-headers", "authorization,content-type");
  return next;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("A non-empty string is required.");
  return value;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function trimRight(value: string, suffix: string): string {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
