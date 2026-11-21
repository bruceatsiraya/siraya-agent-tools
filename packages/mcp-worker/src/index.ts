import {
  CAPABILITY_TAXONOMY,
  buildRegistry,
  filterModels,
  recommendModel,
  validateRequest,
  type FilterModelsOptions,
  type RecommendModelOptions,
  type SirayaModel,
  type SirayaModelCapability,
  type SirayaRegistry
} from "@siraya/agent";
import { modelListRows, visibleModel, saveListSpecs, importListSpecs, applyExportDiscounts } from "./model-list.js";
import { modelListPage, modelListScript } from "./model-list-page.js";
import { modelListImportScript } from "./model-list-import.js";
import { exportModelList } from "./model-list-xlsx.js";
import { updateListBenchmarks } from "./model-list-benchmarks.js";
import { renderDocs } from "./docs.js";
import { salesRoute } from "./sales.js";
import { correctModelIdentities } from "./model-corrections.js";
import { siteLanguageScript } from "./site-language.js";
import { renderModelCatalog } from "./catalog.js";
import { authenticateAdmin, canManageResearchSettings, login, logout, renderAdminPortal } from "./auth.js";
import { enrichPublicInfo } from "./public-info.js";
import {
  adminModel,
  applyStoredOverrides,
  deleteModelOverride,
  getResearchModel,
  lowConfidenceModels,
  researchModel,
  reviewResearch,
  saveModelOverride,
  saveResearchModel,
  type MetadataEnv
} from "./metadata.js";

interface Env extends MetadataEnv {
  SIRAYA_API_KEY?: string;
  SIRAYA_ENRICHMENT_API_KEY?: string;
  SIRAYA_BASE_URL?: string;
  SIRAYA_ENRICHMENT_MODEL?: string;
  ADMIN_TOKEN?: string;
  SIRAYA_REGISTRY: KVNamespace;
  SIRAYA_METADATA: D1Database;
}

interface JsonRpcRequest {
  jsonrpc?: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

const REGISTRY_KEY = "registry:latest:v9";
const DEFAULT_BASE_URL = "https://llm.siraya.ai/v1";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    if (url.pathname === "/site-language.js" && request.method === "GET") {
      return new Response(siteLanguageScript, { headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" } });
    }
    if (url.pathname === "/sales" || url.pathname.startsWith("/sales/") || url.pathname.startsWith("/quote/")) {
      try {
        return await salesRoute(request, env, async () => {
          const { registry } = await getListRegistry(env);
          return modelListRows(env.SIRAYA_METADATA, registry);
        });
      } catch (error) {
        console.error("Sales quote unavailable", error);
        return new Response("報價服務暫時無法使用，請稍後重試。", { status: 503, headers: { "cache-control": "no-store" } });
      }
    }
    if (url.pathname === "/admin/auth/login" && request.method === "POST") return login(request, env);
    if (url.pathname === "/admin/auth/logout" && request.method === "POST") return logout(request, env);
    if (url.pathname === "/admin/auth/me" && request.method === "GET") {
      const identity = await authenticateAdmin(request, env);
      return identity ? json({ authenticated: true, user: identity }) : json({ authenticated: false }, 401);
    }
    if ((url.pathname === "/admin" || url.pathname === "/admin/") && request.method === "GET") {
      const identity = await authenticateAdmin(request, env);
      const analysisModel = canManageResearchSettings(identity) ? await getResearchModel(env) : undefined;
      return renderAdminPortal(identity, analysisModel);
    }
    if (url.pathname === "/model-list.js" && request.method === "GET") {
      return new Response(modelListScript + modelListImportScript, {
        headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" }
      });
    }
    if ((["/model-list", "/model-list.xlsx"].includes(url.pathname) && request.method === "GET") ||
        (url.pathname === "/model-list.xlsx" && request.method === "POST")) {
      return serveModelList(request, env, url);
    }
    if (url.pathname === "/models" && request.method === "GET" && wantsHtml(request, url)) {
      const wantsAdmin = url.searchParams.get("manage") === "1";
      const identity = wantsAdmin ? await authenticateAdmin(request, env) : null;
      if (wantsAdmin && !identity) return Response.redirect(`${url.origin}/admin`, 302);
      return renderModelCatalog(await getRegistry(env), { adminMode: Boolean(identity) });
    }
    if (request.method === "GET") {
      const docs = renderDocs(url.pathname);
      if (docs) return docs;
    }
    if (url.pathname === "/health") return json({ ok: true, service: "siraya-mcp-worker" });
    if (url.pathname === "/registry" && request.method === "GET") return json(await getRegistry(env));
    if (url.pathname === "/models" && request.method === "GET") return json(await getRegistry(env));
    if (url.pathname === "/api/models" && request.method === "GET") return json({ data: (await getRegistry(env)).models });
    if (url.pathname === "/refresh" && request.method === "POST") return refreshFromHttp(request, env);
    if (url.pathname.startsWith("/admin/") && ["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
      return handleAdmin(request, env, url);
    }
    if (url.pathname === "/stream/chat/completions" && request.method === "POST") {
      return proxySirayaSse(request, env, "/chat/completions");
    }
    if (url.pathname === "/stream/responses" && request.method === "POST") {
      return proxySirayaSse(request, env, "/responses");
    }
    if (url.pathname === "/mcp" && request.method === "POST") return handleMcp(request, env);
    return json({ error: "not_found" }, 404);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === "0 1 * * MON") {
      ctx.waitUntil(getListRegistry(env).then(({ registry }) => updateListBenchmarks(env.SIRAYA_METADATA, registry)));
    } else {
      ctx.waitUntil(refreshAndResearch(env));
    }
  }
};

async function getListRegistry(env: Env) {
  try {
    return { registry: await applyStoredOverrides(await fetchBaseRegistry(env), env.SIRAYA_METADATA), live: true };
  } catch (error) {
    console.error("Live Model List refresh failed", error instanceof Error ? error.name : "unknown");
    const cached = await env.SIRAYA_REGISTRY.get<SirayaRegistry>(REGISTRY_KEY, "json");
    if (!cached) throw new Error("No SIRAYA model catalog available.");
    return { registry: correctModelIdentities(cached), live: false };
  }
}

async function serveModelList(request: Request, env: Env, url: URL): Promise<Response> {
  const admin = url.searchParams.get("manage") === "1";
  const exporting = url.pathname.endsWith(".xlsx");
  try {
    const identity = !exporting || admin ? await authenticateAdmin(request, env) : null;
    if (admin && !identity) return Response.redirect(new URL("/admin", url).href, 302);
    if (request.method === "POST" && !isSameOrigin(request, url)) return json({ error: "invalid_origin" }, 403);
    const { registry, live } = await getListRegistry(env);
    const rows = await modelListRows(env.SIRAYA_METADATA, registry);
    if (!exporting) return modelListPage(rows, registry.generatedAt, live, admin, Boolean(identity));
    if (request.method === "GET") return exportModelList(rows.map(row => row.cells));
    let cells;
    try {
      cells = applyExportDiscounts(rows, asRecord(await request.json()).discounts);
    } catch {
      return json({ error: "invalid_discounts" }, 400);
    }
    return exportModelList(cells);
  } catch (error) {
    console.error("Model List unavailable", error);
    return new Response("Model List is temporarily unavailable.", { status: 503 });
  }
}

function wantsHtml(request: Request, url: URL): boolean {
  if (url.searchParams.get("format") === "json") return false;
  return request.headers.get("accept")?.includes("text/html") ?? false;
}

async function handleMcp(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as JsonRpcRequest | JsonRpcRequest[];
  const agentApiKey = bearerToken(request);
  if (!Array.isArray(body) && isStreamingToolCall(body)) {
    if (!agentApiKey) return json(rpcError(body.id, -32001, "SIRAYA_API_KEY is required."), 401);
    return streamMcpToolCall(body, env, agentApiKey);
  }
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
    const models = filterModels(registry, args as FilterModelsOptions);
    return { generatedAt: registry.generatedAt, count: models.length, models };
  }
  if (name === "siraya_list_capability_taxonomy") {
    const registry = await getRegistry(env, false, agentApiKey);
    return {
      taxonomy: CAPABILITY_TAXONOMY,
      counts: taxonomyCounts(registry)
    };
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
  if (name === "siraya_chat_completion_stream") {
    return sirayaPost(env, "/chat/completions", { ...asRecord(args.request), stream: false }, requireAgentApiKey(agentApiKey));
  }
  if (name === "siraya_responses_stream") {
    return sirayaPost(env, "/responses", { ...asRecord(args.request), stream: false }, requireAgentApiKey(agentApiKey));
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
    if (cached) return correctModelIdentities(cached);
  }
  return refreshRegistry(env, fallbackApiKey);
}

async function fetchBaseRegistry(env: Env, fallbackApiKey?: string): Promise<SirayaRegistry> {
  const apiKey = env.SIRAYA_API_KEY ?? fallbackApiKey;
  if (!apiKey) throw new Error("A SIRAYA API key is required to refresh the model registry.");
  const baseUrl = trimRight(env.SIRAYA_BASE_URL ?? DEFAULT_BASE_URL, "/");
  const response = await fetch(`${baseUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) {
    throw new Error(`SIRAYA /models failed: ${response.status}`);
  }
  const payload = await response.json() as { data: SirayaModel[] };
  if (!Array.isArray(payload.data)) throw new Error("Invalid SIRAYA catalog.");
  return buildRegistry(payload.data, `${baseUrl}/models`);
}

async function refreshRegistry(env: Env, fallbackApiKey?: string): Promise<SirayaRegistry> {
  const inferred = await enrichPublicInfo(await fetchBaseRegistry(env, fallbackApiKey));
  const registry = await applyStoredOverrides(inferred, env.SIRAYA_METADATA);
  console.info('Model identity scan completed', registry.identitySummary);
  await env.SIRAYA_REGISTRY.put(REGISTRY_KEY, JSON.stringify(registry), {
    metadata: { generatedAt: registry.generatedAt }
  });
  return registry;
}

async function refreshAndResearch(env: Env): Promise<void> {
  const registry = await refreshRegistry(env);
  const candidates = await lowConfidenceModels(env.SIRAYA_METADATA, registry, 5);
  for (const model of candidates) {
    try {
      await researchModel(env, registry, model.id);
    } catch {
      // A failed enrichment must not fail the daily registry refresh.
    }
  }
}

async function handleAdmin(request: Request, env: Env, url: URL): Promise<Response> {
  const identity = await authenticateAdmin(request, env);
  if (!identity) return json({ error: "unauthorized" }, 401);
  if (identity.method === "session" && !isSameOrigin(request, url)) return json({ error: "invalid_origin" }, 403);
  try {
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (url.pathname === "/admin/settings/research-model" && request.method === "PATCH") {
      if (!canManageResearchSettings(identity)) return json({ error: "research_settings_access_required" }, 403);
      const { model } = asRecord(await request.json());
      if (model !== null) {
        if (typeof model !== "string" || !model.trim() || model.length > 256) {
          return json({ error: "invalid_model", message: "Enter a valid SIRAYA model ID." }, 400);
        }
        const registry = await getRegistry(env);
        if (!registry.models.some(candidate => candidate.id === model.trim() &&
            candidate.category === "text" && candidate.apiFormats.includes("openai_chat"))) {
          return json({ error: "unsupported_model", message: "Choose a text model that supports OpenAI Chat from the SIRAYA model catalog." }, 400);
        }
      }
      await saveResearchModel(env.SIRAYA_METADATA, model === null ? null : model.trim());
      return json({ model: await getResearchModel(env) });
    }
    if (identity.pricing_role === "sales" && request.method !== "GET" && ["model-list","models","research"].includes(parts[1])) return json({error:"product_required"},403);
    if (parts[1] === "model-list" && parts.length === 3) {
      if (parts[2] === "save" && request.method === "POST") {
        const { registry } = await getListRegistry(env);
        const body = asRecord(await request.json());
        return json({ count: await saveListSpecs(env.SIRAYA_METADATA, registry, body.rows) });
      }
      if (parts[2] === "import" && request.method === "POST") {
        const body = asRecord(await request.json());
        return json({ count: await importListSpecs(env.SIRAYA_METADATA, body.rows) });
      }
      if (request.method === "PATCH") {
        const { registry } = await getListRegistry(env);
        if (!registry.models.some(model => model.id === parts[2] && visibleModel(model))) {
          return json({ error: "not_found" }, 404);
        }
        await saveListSpecs(env.SIRAYA_METADATA, registry, [{ id: parts[2], values: asRecord(await request.json()) }]);
        return json({ ok: true });
      }
    }
    const registry = await getRegistry(env);
    if (parts[1] === "models" && parts[2]) {
      const modelId = parts[2];
      if (parts[3] === "research" && request.method === "POST") {
        return json(await researchModel(env, registry, modelId));
      }
      if (request.method === "GET") return json(await adminModel(env.SIRAYA_METADATA, registry, modelId));
      if (request.method === "PATCH") {
        const result = await saveModelOverride(env.SIRAYA_METADATA, registry, modelId, asRecord(await request.json()));
        await rebuildEffectiveRegistry(env);
        return json(result);
      }
      if (request.method === "DELETE") {
        await deleteModelOverride(env.SIRAYA_METADATA, registry, modelId);
        await rebuildEffectiveRegistry(env);
        return json({ ok: true, modelId });
      }
    }
    if (parts[1] === "research" && parts[2] && parts[3] && request.method === "POST") {
      const researchId = Number(parts[2]);
      if (!Number.isInteger(researchId)) return json({ error: "invalid_research_id" }, 400);
      const approve = parts[3] === "approve";
      if (!approve && parts[3] !== "reject") return json({ error: "not_found" }, 404);
      const result = await reviewResearch(env.SIRAYA_METADATA, registry, researchId, approve);
      if (approve) await rebuildEffectiveRegistry(env);
      return json(result);
    }
    return json({ error: "not_found" }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("Unknown model") ? 404 : message.includes("changed since") ? 409 : 400;
    return json({ error: "admin_request_failed", message }, status);
  }
}

async function rebuildEffectiveRegistry(env: Env): Promise<SirayaRegistry> {
  const current = await env.SIRAYA_REGISTRY.get<SirayaRegistry>(REGISTRY_KEY, "json");
  if (!current) return refreshRegistry(env);
  const pricingById = new Map(current.models.map(model => [model.id, {
    pricing: model.pricing,
    pricingUrl: model.pricingUrl,
    documentationUrl: model.documentationUrl
  }]));
  const baseline = buildRegistry(current.models.map(model => model.raw), current.source);
  baseline.publicSources = current.publicSources;
  baseline.models = baseline.models.map(model => ({ ...model, ...pricingById.get(model.id) }));
  const effective = await applyStoredOverrides(baseline, env.SIRAYA_METADATA);
  await env.SIRAYA_REGISTRY.put(REGISTRY_KEY, JSON.stringify(effective), {
    metadata: { generatedAt: effective.generatedAt }
  });
  return effective;
}

async function refreshFromHttp(request: Request, env: Env): Promise<Response> {
  const identity = await authenticateAdmin(request, env);
  if (!identity) return json({ error: "unauthorized" }, 401);
  if (identity.method === "session" && !isSameOrigin(request, new URL(request.url))) {
    return json({ error: "invalid_origin" }, 403);
  }
  return json(await refreshRegistry(env));
}

function isSameOrigin(request: Request, url: URL): boolean {
  const origin = request.headers.get("origin");
  return origin === url.origin;
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

async function proxySirayaSse(request: Request, env: Env, path: string): Promise<Response> {
  const apiKey = bearerToken(request);
  if (!apiKey) return json({ error: "unauthorized", message: "SIRAYA_API_KEY is required." }, 401);
  const body = { ...asRecord(await request.json()), stream: true };
  const upstream = await fetch(`${trimRight(env.SIRAYA_BASE_URL ?? DEFAULT_BASE_URL, "/")}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!upstream.ok || !upstream.body) {
    const message = await upstream.text();
    return json({ error: "siraya_stream_failed", status: upstream.status, message }, upstream.status);
  }
  return cors(new Response(upstream.body, {
    status: upstream.status,
    headers: sseHeaders()
  }));
}

function isStreamingToolCall(request: JsonRpcRequest): boolean {
  if (request.method !== "tools/call") return false;
  const name = String(request.params?.name ?? "");
  return name === "siraya_chat_completion_stream" || name === "siraya_responses_stream";
}

async function streamMcpToolCall(request: JsonRpcRequest, env: Env, apiKey: string): Promise<Response> {
  const name = String(request.params?.name ?? "");
  const args = asRecord(request.params?.arguments);
  const modelRequest = { ...asRecord(args.request), stream: true };
  const path = name === "siraya_responses_stream" ? "/responses" : "/chat/completions";
  const upstream = await fetch(`${trimRight(env.SIRAYA_BASE_URL ?? DEFAULT_BASE_URL, "/")}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "text/event-stream",
      "content-type": "application/json"
    },
    body: JSON.stringify(modelRequest)
  });

  if (!upstream.ok || !upstream.body) {
    const message = await upstream.text();
    return json(rpcError(request.id, -32000, `SIRAYA ${path} failed: ${upstream.status} ${message}`));
  }

  const progressToken = asRecord(request.params?._meta).progressToken;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let buffer = "";
  let text = "";
  let sequence = 0;
  let completed = false;

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (completed) return;
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          flushSseBuffer();
          finish();
          return;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        drainSseFrames();
      } catch (error) {
        controller.enqueue(encodeSse(rpcError(
          request.id,
          -32000,
          error instanceof Error ? error.message : String(error)
        )));
        completed = true;
        controller.close();
      }

      function drainSseFrames(): void {
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        frames.forEach(processFrame);
      }

      function flushSseBuffer(): void {
        buffer += decoder.decode();
        if (buffer.trim()) processFrame(buffer);
        buffer = "";
      }

      function processFrame(frame: string): void {
        if (completed) return;
        const payload = frame
          .split(/\r?\n/)
          .filter(line => line.startsWith("data:"))
          .map(line => line.slice(5).trimStart())
          .join("\n");
        if (!payload) return;
        if (payload === "[DONE]") {
          finish();
          return;
        }
        const event = safeJson(payload);
        const delta = extractStreamText(event);
        if (!delta) return;
        text += delta;
        sequence += 1;
        if (typeof progressToken === "string" || typeof progressToken === "number") {
          controller.enqueue(encodeSse({
            jsonrpc: "2.0",
            method: "notifications/progress",
            params: { progressToken, progress: sequence, message: delta }
          }));
        }
      }

      function finish(): void {
        if (completed) return;
        completed = true;
        controller.enqueue(encodeSse(rpcResult(request.id, {
          content: [{ type: "text", text }],
          structuredContent: { text, streamed: true, events: sequence },
          isError: false
        })));
        controller.close();
      }
    },
    async cancel(reason) {
      completed = true;
      await reader.cancel(reason);
    }
  });

  return cors(new Response(stream, { headers: sseHeaders() }));
}

function extractStreamText(value: unknown): string {
  const event = asRecord(value);
  if (typeof event.delta === "string") return event.delta;
  if (typeof event.output_text === "string") return event.output_text;
  const choices = event.choices;
  if (!Array.isArray(choices)) return "";
  return choices
    .map(choice => {
      const delta = asRecord(asRecord(choice).delta);
      if (typeof delta.content === "string") return delta.content;
      if (!Array.isArray(delta.content)) return "";
      return delta.content
        .map(part => typeof asRecord(part).text === "string" ? String(asRecord(part).text) : "")
        .join("");
    })
    .join("");
}

function encodeSse(message: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

function sseHeaders(): Headers {
  return new Headers({
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    "x-accel-buffering": "no"
  });
}

function toolList(): Array<Record<string, unknown>> {
  return [
    {
      name: "siraya_list_models",
      description: "List SIRAYA Model Router models with normalized capability, task, trait, modality, lifecycle, quality, and speed labels.",
      inputSchema: {
        type: "object",
        properties: {
          refresh: { type: "boolean", description: "Refresh from SIRAYA before returning." },
          provider: stringOrStringArraySchema("Filter by normalized provider ID."),
          category: stringOrStringArraySchema("Filter by model category."),
          capabilityTags: stringArraySchema("Require every capability tag."),
          taskTags: stringArraySchema("Require every task tag."),
          traits: stringArraySchema("Require every model trait."),
          lifecycle: { type: "string", description: "Filter by lifecycle: stable, preview, dated, or unknown." }
        },
        additionalProperties: false
      }
    },
    {
      name: "siraya_list_capability_taxonomy",
      description: "List the normalized capability, task, and trait labels exposed by SIRAYA, including current model counts for each label.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false }
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
          requireTags: stringArraySchema("Require every capability tag."),
          requireTasks: stringArraySchema("Require every task tag."),
          preferTraits: stringArraySchema("Prefer models carrying these traits."),
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
    rawCallTool("siraya_chat_completion_stream", "Stream SIRAYA /v1/chat/completions token deltas through MCP progress notifications."),
    rawCallTool("siraya_responses_stream", "Stream SIRAYA /v1/responses token deltas through MCP progress notifications."),
    rawCallTool("siraya_generate_image", "Call SIRAYA /v1/images/generations."),
    rawCallTool("siraya_generate_video", "Call SIRAYA /v1/videos/generations.")
  ];
}

function taxonomyCounts(registry: SirayaRegistry): Record<string, Record<string, number>> {
  const count = (values: string[]): Record<string, number> => values.reduce<Record<string, number>>((result, value) => {
    result[value] = (result[value] ?? 0) + 1;
    return result;
  }, {});
  return {
    capabilityTags: count(registry.models.flatMap(model => model.capabilityTags)),
    taskTags: count(registry.models.flatMap(model => model.taskTags)),
    traits: count(registry.models.flatMap(model => model.traits)),
    categories: count(registry.models.map(model => model.category)),
    providers: count(registry.models.map(model => model.provider ?? "other"))
  };
}

function stringArraySchema(description: string): Record<string, unknown> {
  return { type: "array", items: { type: "string" }, description };
}

function stringOrStringArraySchema(description: string): Record<string, unknown> {
  return { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description };
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
  next.headers.set("access-control-allow-methods", "GET,POST,PATCH,DELETE,OPTIONS");
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
