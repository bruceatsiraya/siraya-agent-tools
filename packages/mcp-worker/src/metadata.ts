import {
  inferCapabilities,
  type SirayaModelCapability,
  type SirayaRegistry
} from "@siraya/agent";

export interface MetadataEnv {
  SIRAYA_API_KEY?: string;
  SIRAYA_ENRICHMENT_API_KEY?: string;
  SIRAYA_BASE_URL?: string;
  SIRAYA_ENRICHMENT_MODEL?: string;
  SIRAYA_METADATA: D1Database;
}

interface OverrideRow {
  model_id: string;
  patch_json: string;
  version: number;
  updated_at: string;
  updated_by: string;
}

interface ResearchRow {
  id: number;
  model_id: string;
  status: string;
  query: string;
  candidate_json: string | null;
  evidence_json: string | null;
  confidence: number | null;
  analysis_model: string | null;
  error: string | null;
  created_at: string;
  reviewed_at: string | null;
}

const DEFAULT_BASE_URL = "https://llm.siraya.ai/v1";
const EDITABLE_FIELDS = new Set([
  "provider", "providerName", "family", "category", "documentationUrl", "pricingUrl", "pricing",
  "capabilitySource", "apiFormats", "modalities", "inputModalities", "outputModalities", "capabilityTags",
  "taskTags", "traits", "lifecycle", "qualityTier", "speedTier", "taxonomyConfidence", "features",
  "supportedParameters", "notes"
]);
const ENUMS: Record<string, Set<string>> = {
  family: new Set(["gpt", "claude", "gemini", "deepseek", "grok", "qwen", "kimi", "glm", "minimax", "seed", "image", "video", "audio", "embedding", "rerank", "other"]),
  category: new Set(["text", "image", "video", "audio", "embedding", "rerank"]),
  capabilitySource: new Set(["declared", "inferred"]),
  lifecycle: new Set(["stable", "preview", "dated", "unknown"]),
  qualityTier: new Set(["economy", "standard", "premium", "specialized", "unknown"]),
  speedTier: new Set(["fast", "balanced", "quality", "unknown"]),
  taxonomyConfidence: new Set(["declared", "inferred"])
};
const ARRAY_ENUMS: Record<string, Set<string>> = {
  apiFormats: new Set(["openai_chat", "openai_responses", "anthropic_messages"]),
  capabilityTags: new Set(["streaming", "tool_calling", "structured_output", "reasoning", "prompt_caching", "image_input", "pdf_input", "image_generation", "video_generation", "speech_recognition", "text_output", "embeddings", "reranking"]),
  taskTags: new Set(["chat", "agent", "coding", "reasoning", "structured_output", "vision", "document_analysis", "image_generation", "video_generation", "speech_to_text", "semantic_search", "retrieval_ranking"]),
  traits: new Set(["fast", "economy", "premium", "small", "multimodal", "specialized", "preview", "dated_snapshot", "content_policy_relaxed"])
};
const STRING_ARRAY_FIELDS = new Set(["modalities", "inputModalities", "outputModalities", "supportedParameters", "notes"]);
const BOOLEAN_FEATURES = new Set(["streaming", "toolCalling", "structuredOutputs", "reasoning", "webSearch", "imageInput", "pdfInput", "imageGeneration", "videoGeneration", "embeddings", "reranking"]);

export async function applyStoredOverrides(registry: SirayaRegistry, db: D1Database): Promise<SirayaRegistry> {
  const rows = await db.prepare("SELECT model_id, patch_json FROM model_overrides").all<Pick<OverrideRow, "model_id" | "patch_json">>();
  const patches = new Map(rows.results.map(row => [row.model_id, parseRecord(row.patch_json)]));
  return {
    ...registry,
    models: registry.models.map(model => applyModelPatch(model, patches.get(model.id)))
  };
}

export async function adminModel(db: D1Database, registry: SirayaRegistry, modelId: string): Promise<Record<string, unknown>> {
  const model = findModel(registry, modelId);
  const override = await db.prepare("SELECT * FROM model_overrides WHERE model_id = ?").bind(modelId).first<OverrideRow>();
  const research = await db.prepare("SELECT * FROM model_research WHERE model_id = ? ORDER BY created_at DESC LIMIT 10")
    .bind(modelId).all<ResearchRow>();
  const history = await db.prepare("SELECT * FROM model_audit_log WHERE model_id = ? ORDER BY created_at DESC LIMIT 30")
    .bind(modelId).all<Record<string, unknown>>();
  return {
    model,
    inferred: inferCapabilities(model.raw),
    override: override ? { ...override, patch: parseRecord(override.patch_json) } : null,
    research: research.results.map(formatResearchRow),
    history: history.results
  };
}

export async function saveModelOverride(
  db: D1Database,
  registry: SirayaRegistry,
  modelId: string,
  input: Record<string, unknown>
): Promise<{ patch: Record<string, unknown>; version: number; model: SirayaModelCapability }> {
  const model = findModel(registry, modelId);
  const current = await db.prepare("SELECT * FROM model_overrides WHERE model_id = ?").bind(modelId).first<OverrideRow>();
  const baseVersion = typeof input.baseVersion === "number" ? input.baseVersion : current?.version ?? 0;
  if (current && baseVersion !== current.version) throw new Error(`Override changed since it was opened. Current version is ${current.version}.`);
  const previousPatch = current ? parseRecord(current.patch_json) : {};
  const changes = sanitizePatch(asRecord(input.changes), true);
  const resetFields = Array.isArray(input.resetFields) ? input.resetFields.map(String) : [];
  const patch = { ...previousPatch, ...changes };
  resetFields.forEach(field => delete patch[field]);
  if (Object.keys(changes).some(field => isTaxonomyField(field))) {
    if (!("capabilitySource" in changes)) patch.capabilitySource = "declared";
    if (!("taxonomyConfidence" in changes)) patch.taxonomyConfidence = "declared";
  }
  const version = (current?.version ?? 0) + 1;
  const now = new Date().toISOString();
  await db.batch([
    db.prepare(`INSERT INTO model_overrides (model_id, patch_json, version, updated_at, updated_by)
      VALUES (?, ?, ?, ?, 'admin')
      ON CONFLICT(model_id) DO UPDATE SET patch_json = excluded.patch_json, version = excluded.version,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by`)
      .bind(modelId, JSON.stringify(patch), version, now),
    db.prepare(`INSERT INTO model_audit_log (model_id, action, before_json, after_json, created_at, actor)
      VALUES (?, 'override_saved', ?, ?, ?, 'admin')`)
      .bind(modelId, JSON.stringify(previousPatch), JSON.stringify(patch), now)
  ]);
  return { patch, version, model: applyModelPatch(model, patch) };
}

export async function deleteModelOverride(db: D1Database, registry: SirayaRegistry, modelId: string): Promise<void> {
  findModel(registry, modelId);
  const current = await db.prepare("SELECT patch_json FROM model_overrides WHERE model_id = ?")
    .bind(modelId).first<Pick<OverrideRow, "patch_json">>();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("DELETE FROM model_overrides WHERE model_id = ?").bind(modelId),
    db.prepare(`INSERT INTO model_audit_log (model_id, action, before_json, after_json, created_at, actor)
      VALUES (?, 'override_deleted', ?, '{}', ?, 'admin')`)
      .bind(modelId, current?.patch_json ?? "{}", now)
  ]);
}

export async function researchModel(
  env: MetadataEnv,
  registry: SirayaRegistry,
  modelId: string
): Promise<Record<string, unknown>> {
  const model = findModel(registry, modelId);
  const apiKey = env.SIRAYA_ENRICHMENT_API_KEY ?? env.SIRAYA_API_KEY;
  if (!apiKey) throw new Error("SIRAYA_ENRICHMENT_API_KEY is required for model research.");
  const baseUrl = trimRight(env.SIRAYA_BASE_URL ?? DEFAULT_BASE_URL, "/");
  const queries = buildResearchQueries(model.id);
  const query = queries.join(" | ");
  const now = new Date().toISOString();
  try {
    const search = await searchPublicWeb(queries);
    const sources = search.sources;
    const analysisModel = env.SIRAYA_ENRICHMENT_MODEL ?? "deepseek-v4-pro";
    const completionResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify({
        model: analysisModel,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: researchSystemPrompt() },
          { role: "user", content: JSON.stringify({ current: model, sources }) }
        ]
      })
    });
    if (!completionResponse.ok) throw new Error(`SIRAYA analysis failed: ${completionResponse.status} ${await completionResponse.text()}`);
    const completion = asRecord(await completionResponse.json());
    const content = extractCompletionText(completion);
    const analysis = parseRecord(stripJsonFence(content));
    const rawChanges = asRecord(analysis.changes);
    const candidate = sanitizePatch(rawChanges);
    const droppedFields = Object.keys(rawChanges).filter(field => !Object.prototype.hasOwnProperty.call(candidate, field));
    const retention = Object.keys(rawChanges).length ? Object.keys(candidate).length / Object.keys(rawChanges).length : 0;
    const confidence = clampConfidence(analysis.confidence) * retention;
    const evidence = Array.isArray(analysis.evidence) && analysis.evidence.length
      ? [...analysis.evidence]
      : sources.map(source => ({ field: "source", url: source.url, claim: source.title ?? "Public source" }));
    if (droppedFields.length) evidence.push({
      field: "_validation", claim: `Discarded schema-invalid fields: ${droppedFields.join(", ")}`
    });
    if (!Object.keys(candidate).length) {
      throw new Error("Public sources were found, but the SIRAYA analysis produced no schema-valid metadata fields.");
    }
    const insert = await env.SIRAYA_METADATA.prepare(`INSERT INTO model_research
      (model_id, status, query, candidate_json, evidence_json, confidence, analysis_model, created_at)
      VALUES (?, 'pending', ?, ?, ?, ?, ?, ?) RETURNING id`)
      .bind(modelId, query, JSON.stringify(candidate), JSON.stringify(evidence), confidence, analysisModel, now)
      .first<{ id: number }>();
    return { id: insert?.id, modelId, status: "pending", query, candidate, evidence, confidence, analysisModel, searchProvider: search.provider, createdAt: now };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.SIRAYA_METADATA.prepare(`INSERT INTO model_research
      (model_id, status, query, error, created_at) VALUES (?, 'error', ?, ?, ?)`)
      .bind(modelId, query, message, now).run();
    throw error;
  }
}

async function searchPublicWeb(queries: string[]): Promise<{ provider: string; sources: Record<string, unknown>[] }> {
  const bingSources = await collectSearchResults(queries, bingRssSearch);
  if (bingSources.length) return { provider: "bing_rss", sources: bingSources };
  const sources = await collectSearchResults(queries, duckDuckGoSearch);
  if (!sources.length) {
    throw new Error("Public search returned no results from Bing RSS or DuckDuckGo.");
  }
  return { provider: "duckduckgo", sources };
}

async function collectSearchResults(
  queries: string[],
  search: (query: string) => Promise<Record<string, unknown>[]>
): Promise<Record<string, unknown>[]> {
  const sources = new Map<string, Record<string, unknown>>();
  for (const query of queries) {
    const results = await search(query);
    for (const result of results) {
      const url = typeof result.url === "string" ? result.url : "";
      if (url && !sources.has(url)) sources.set(url, { ...result, query });
      if (sources.size >= 8) return [...sources.values()];
    }
  }
  return [...sources.values()];
}

function buildResearchQueries(modelId: string): string[] {
  const readable = modelId.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
  const modeMatch = modelId.match(/(?:^|[-_.])(t2v|i2v|v2v|s2v)$/i);
  const mode = modeMatch?.[1].toLowerCase();
  const modeLabel = mode === "t2v" ? "text to video"
    : mode === "i2v" ? "image to video"
    : mode === "v2v" ? "video to video"
    : mode === "s2v" ? "subject to video" : "";
  const family = modelId.replace(/[-_.](t2v|i2v|v2v|s2v)$/i, "").replace(/[._-]+/g, " ").trim();
  return [...new Set([
    `\"${modelId}\" AI model`,
    `\"${readable}\" AI model capabilities`,
    modeLabel ? `\"${family}\" ${modeLabel} video model` : `\"${family}\" AI model provider`,
    `${readable} model documentation pricing`
  ])];
}

async function bingRssSearch(query: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; SIRAYA-Model-Registry/1.0)" }
  });
  if (!response.ok) return [];
  const xml = await response.text();
  const matches = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>[\s\S]*?<link>([\s\S]*?)<\/link>[\s\S]*?<description>([\s\S]*?)<\/description>[\s\S]*?<\/item>/gi)].slice(0, 6);
  const results = await Promise.all(matches.map(async match => {
    const title = stripHtml(match[1]);
    const url = decodeHtml(match[2]).trim();
    const description = stripHtml(match[3]);
    if (!isPublicHttpUrl(url)) return null;
    const page = await fetchPublicPage(url);
    return { title, url, content: page || description, score: null };
  }));
  return results.filter(Boolean) as Record<string, unknown>[];
}

async function duckDuckGoSearch(query: string): Promise<Record<string, unknown>[]> {
  const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; SIRAYA-Model-Registry/1.0)" }
  });
  if (!response.ok) return [];
  const html = await response.text();
  const matches = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].slice(0, 6);
  const results = await Promise.all(matches.map(async match => {
    const url = decodeSearchUrl(decodeHtml(match[1]));
    const title = stripHtml(match[2]);
    if (!isPublicHttpUrl(url)) return null;
    const content = await fetchPublicPage(url);
    return { title, url, content, score: null };
  }));
  return results.filter(Boolean) as Record<string, unknown>[];
}

async function fetchPublicPage(url: string): Promise<string> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; SIRAYA-Model-Registry/1.0)" }
    });
    if (!response.ok) return "";
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html") && !contentType.includes("text/plain")) return "";
    return stripHtml((await response.text()).slice(0, 120000)).slice(0, 12000);
  } catch {
    return "";
  }
}

function decodeSearchUrl(value: string): string {
  try {
    const url = new URL(value, "https://duckduckgo.com");
    const target = url.searchParams.get("uddg");
    return target ? decodeURIComponent(target) : url.href;
  } catch {
    return "";
  }
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1"
      && !host.endsWith(".local") && !/^10\./.test(host) && !/^192\.168\./.test(host)
      && !/^172\.(1[6-9]|2\d|3[01])\./.test(host);
  } catch {
    return false;
  }
}

function stripHtml(value: string): string {
  return decodeHtml(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&").replace(/&quot;/g, "\"").replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

export async function reviewResearch(
  db: D1Database,
  registry: SirayaRegistry,
  researchId: number,
  approve: boolean
): Promise<Record<string, unknown>> {
  const row = await db.prepare("SELECT * FROM model_research WHERE id = ?").bind(researchId).first<ResearchRow>();
  if (!row) throw new Error(`Unknown research result: ${researchId}`);
  if (row.status !== "pending") throw new Error(`Research result is already ${row.status}.`);
  if (approve) {
    const candidate = parseRecord(row.candidate_json ?? "{}");
    if (!Object.keys(candidate).length) throw new Error("An empty research candidate cannot be approved. Run research again or reject it.");
    const current = await db.prepare("SELECT * FROM model_overrides WHERE model_id = ?").bind(row.model_id).first<OverrideRow>();
    await saveModelOverride(db, registry, row.model_id, {
      baseVersion: current?.version ?? 0,
      changes: candidate
    });
  }
  const status = approve ? "approved" : "rejected";
  await db.prepare("UPDATE model_research SET status = ?, reviewed_at = ? WHERE id = ?")
    .bind(status, new Date().toISOString(), researchId).run();
  return { ...formatResearchRow(row), status };
}

export async function lowConfidenceModels(db: D1Database, registry: SirayaRegistry, limit = 5): Promise<SirayaModelCapability[]> {
  const recent = await db.prepare("SELECT DISTINCT model_id FROM model_research WHERE created_at > ?")
    .bind(new Date(Date.now() - 7 * 86400000).toISOString()).all<{ model_id: string }>();
  const skipped = new Set(recent.results.map(row => row.model_id));
  return registry.models.filter(model => !skipped.has(model.id) && (
    model.provider === "other" || model.family === "other" || model.taxonomyConfidence === "inferred"
  )).slice(0, limit);
}

function applyModelPatch(model: SirayaModelCapability, patch?: Record<string, unknown>): SirayaModelCapability {
  if (!patch) return model;
  return {
    ...model,
    ...patch,
    features: patch.features ? { ...model.features, ...asRecord(patch.features) } : model.features,
    raw: model.raw
  } as SirayaModelCapability;
}

function sanitizePatch(value: Record<string, unknown>, strict = false): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [field, fieldValue] of Object.entries(value)) {
    if (!EDITABLE_FIELDS.has(field)) continue;
    const normalized = normalizeField(field, fieldValue);
    if (normalized.valid) patch[field] = normalized.value;
    else if (strict) throw new Error(`${field}: ${normalized.error}`);
  }
  return patch;
}

function normalizeField(field: string, value: unknown): { valid: boolean; value?: unknown; error?: string } {
  if (field in ENUMS) {
    return typeof value === "string" && ENUMS[field].has(value)
      ? { valid: true, value }
      : { valid: false, error: `must be one of ${[...ENUMS[field]].join(", ")}` };
  }
  if (field in ARRAY_ENUMS) {
    if (!Array.isArray(value)) return { valid: false, error: "must be an array" };
    const invalid = value.filter(item => typeof item !== "string" || !ARRAY_ENUMS[field].has(item));
    if (invalid.length) return { valid: false, error: `contains unsupported values: ${invalid.join(", ")}` };
    return { valid: true, value: [...new Set(value)] };
  }
  if (STRING_ARRAY_FIELDS.has(field)) {
    return Array.isArray(value) && value.every(item => typeof item === "string")
      ? { valid: true, value: [...new Set(value)] }
      : { valid: false, error: "must be an array of strings" };
  }
  if (field === "features") return normalizeFeatures(value);
  if (field === "pricing") return normalizePricing(value);
  if (["provider", "providerName", "documentationUrl", "pricingUrl"].includes(field)) {
    return typeof value === "string" ? { valid: true, value } : { valid: false, error: "must be a string" };
  }
  return { valid: true, value };
}

function normalizeFeatures(value: unknown): { valid: boolean; value?: unknown; error?: string } {
  const source = asRecord(value);
  if (!Object.keys(source).length) return { valid: false, error: "must be a feature object" };
  const features: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (BOOLEAN_FEATURES.has(key)) {
      if (typeof item !== "boolean") return { valid: false, error: `${key} must be boolean` };
      features[key] = item;
    } else if (key === "promptCaching") {
      if (typeof item === "boolean") features[key] = item ? "implicit" : "none";
      else if (["implicit", "explicit", "none", "unknown"].includes(String(item))) features[key] = item;
      else return { valid: false, error: "promptCaching has an unsupported value" };
    }
  }
  return { valid: true, value: features };
}

function normalizePricing(value: unknown): { valid: boolean; value?: unknown; error?: string } {
  const source = asRecord(value);
  if (!Object.keys(source).length) return { valid: false, error: "must be a pricing object" };
  if (source.currency !== "USD" && source.currency !== "CNY") return { valid: false, error: "currency must be USD or CNY" };
  if (typeof source.unit !== "string" || !source.unit) return { valid: false, error: "unit is required" };
  for (const field of ["input", "cachedInput", "output"]) {
    if (source[field] !== undefined && typeof source[field] !== "number") return { valid: false, error: `${field} must be numeric` };
  }
  return { valid: true, value: source };
}

function isTaxonomyField(field: string): boolean {
  return !["documentationUrl", "pricingUrl", "pricing", "notes", "supportedParameters"].includes(field);
}

function findModel(registry: SirayaRegistry, modelId: string): SirayaModelCapability {
  const model = registry.models.find(candidate => candidate.id === modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  return model;
}

function formatResearchRow(row: ResearchRow): Record<string, unknown> {
  const candidate = parseRecord(row.candidate_json ?? "{}");
  const emptyPending = row.status === "pending" && !Object.keys(candidate).length;
  return {
    id: row.id, modelId: row.model_id, status: emptyPending ? "error" : row.status, query: row.query,
    candidate, evidence: parseJson(row.evidence_json ?? "[]"),
    confidence: row.confidence, analysisModel: row.analysis_model,
    error: emptyPending ? "No schema-valid candidate fields were produced. Run research again." : row.error,
    createdAt: row.created_at, reviewedAt: row.reviewed_at
  };
}

function researchSystemPrompt(): string {
  return `You classify AI models from public evidence. Return JSON only with keys changes, confidence, evidence.
Allowed family: gpt, claude, gemini, deepseek, grok, qwen, kimi, glm, minimax, seed, image, video, audio, embedding, rerank, other.
Allowed category: text, image, video, audio, embedding, rerank.
Allowed apiFormats: openai_chat, openai_responses, anthropic_messages.
Allowed capabilityTags: ${[...ARRAY_ENUMS.capabilityTags].join(", ")}.
Allowed taskTags: ${[...ARRAY_ENUMS.taskTags].join(", ")}.
Allowed traits: ${[...ARRAY_ENUMS.traits].join(", ")}.
pricing must be an object with currency USD or CNY, unit, numeric input/cachedInput/output, sourceUrl, observedAt; omit it when exact comparable pricing is unavailable.
features uses boolean flags plus promptCaching as implicit, explicit, none, or unknown.
Never invent enum values or unsupported capabilities. Omit uncertain fields. Use official vendor sources first.
evidence is an array of {field,url,claim}. confidence is 0 to 1.`;
}

function extractCompletionText(response: Record<string, unknown>): string {
  const choices = Array.isArray(response.choices) ? response.choices : [];
  const message = asRecord(asRecord(choices[0]).message);
  if (typeof message.content === "string") return message.content;
  throw new Error("SIRAYA analysis returned no text content.");
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

function clampConfidence(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function authHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

function parseRecord(value: string): Record<string, unknown> {
  const parsed = parseJson(value);
  return asRecord(parsed);
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return {}; }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function trimRight(value: string, suffix: string): string {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length) : value;
}
