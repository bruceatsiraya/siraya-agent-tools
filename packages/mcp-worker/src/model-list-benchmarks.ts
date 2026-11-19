import type { SirayaRegistry } from "@siraya/agent";
import { metricNumber, modelCategory, visibleModel } from "./model-list.js";

type RecordValue = Record<string, unknown>;
type Catalog = Map<string, string>;

function record(value: unknown): RecordValue {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalized(id: string): string {
  return (id.split("/").at(-1) ?? id).toLowerCase()
    .replace(/^(?:fw|dola|bytedance|siraya)-/, "")
    .replace(/^grok-4[-.]20(?=-|$)/, "grok-4.2")
    .replace(/[^a-z0-9]/g, "");
}

function catalog(entries: [string, string][]): Catalog {
  const result = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [name, id] of entries) {
    const key = normalized(name);
    if (!key) continue;
    if (result.has(key) && result.get(key) !== id) ambiguous.add(key);
    result.set(key, id);
  }
  for (const key of ambiguous) result.delete(key);
  return result;
}

async function get(url: string): Promise<RecordValue> {
  const response = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(new URL(url).hostname + " HTTP " + response.status);
  return record(await response.json());
}

const INFRON = "https://infron.ai/api";
const OPENROUTER = "https://openrouter.ai/api/v1";

async function infronCatalog(): Promise<Catalog> {
  const entries: [string, string][] = [];
  for (let page = 1; page <= 30; page++) {
    const payload = await get(INFRON + "/market/all/models?page=" + page + "&page_size=100");
    const data = record(payload.data);
    const models = [payload.data, data.models, data.items, data.list, payload.models, payload.items].find(Array.isArray);
    if (!models) throw new Error("Unexpected Infron catalog response.");
    for (const value of models) {
      const row = record(value);
      if (typeof row.model_id_str === "string" && (typeof row.model_internal_id === "number" ||
          typeof row.model_internal_id === "string") && String(row.category_type).toUpperCase() === "LLM") {
        entries.push([row.model_id_str, String(row.model_internal_id)]);
      }
    }
    if (models.length < 100) {
      if (!entries.length) throw new Error("Infron catalog returned no LLM entries.");
      return catalog(entries);
    }
  }
  throw new Error("Infron catalog exceeded 30 pages.");
}

async function openRouterCatalog(): Promise<Catalog> {
  const payload = await get(OPENROUTER + "/models");
  if (!Array.isArray(payload.data)) throw new Error("Unexpected OpenRouter catalog response.");
  return catalog(payload.data.flatMap(value => {
    const id = record(value).id;
    return typeof id === "string" && id.split("/").length === 2 ? [[id, id]] : [];
  }));
}

function median(values: unknown[], divisor = 1): number | null {
  const samples = values.map(metricNumber).filter((value): value is number => value !== null).sort((a, b) => a - b);
  if (!samples.length) return null;
  return (samples[Math.floor((samples.length - 1) / 2)] + samples[Math.floor(samples.length / 2)]) / (2 * divisor);
}

function metricSamples(value: unknown, name: string): unknown[] {
  if (Array.isArray(value)) return value.flatMap(child => metricSamples(child, name));
  const node = record(value);
  const field = node[name];
  if (Array.isArray(field)) return field.map(sample => typeof sample === "number" ? sample : record(sample).value);
  if (typeof field === "number") return [field];
  return Object.values(node).flatMap(child => metricSamples(child, name));
}

const sources = [
  { name: "Infron", load: infronCatalog, async sample(id: string) {
    const payload = await get(INFRON + "/models/" + encodeURIComponent(id) + "/service-tiers/standard/performance?timeRange=30d");
    const metrics = payload.metrics ?? record(payload.data).metrics;
    if (!metrics) throw new Error("Unexpected Infron performance response.");
    return [median(metricSamples(metrics, "latency"), 1000), median(metricSamples(metrics, "throughput"))];
  }},
  { name: "OpenRouter", load: openRouterCatalog, async sample(id: string) {
    const data = record((await get(OPENROUTER + "/models/" + id.split("/").map(encodeURIComponent).join("/") + "/endpoints")).data);
    if (!Array.isArray(data.endpoints)) throw new Error("Unexpected OpenRouter endpoints response.");
    const endpoints = array(data.endpoints).map(record);
    return [
      median(endpoints.map(endpoint => record(endpoint.latency_last_30m).p50)),
      median(endpoints.map(endpoint => record(endpoint.throughput_last_30m).p50))
    ];
  }}
];

export async function updateListBenchmarks(db: D1Database, registry: SirayaRegistry) {
  const models = registry.models.filter(model => visibleModel(model) && modelCategory(model) === "LLM");
  const observedAt = new Date().toISOString();
  let failures = 0;
  for (const source of sources) {
    let ids: Catalog;
    try {
      ids = await source.load();
    } catch (error) {
      console.error(source.name, error);
      failures++;
      continue;
    }
    const matched = models.flatMap(model => {
      const id = ids.get(normalized(model.id));
      return id ? [{ modelId: model.id, id }] : [];
    });
    for (let offset = 0; offset < matched.length; offset += 5) {
      const results = await Promise.allSettled(matched.slice(offset, offset + 5).map(async ({ modelId, id }) => {
        const [ttft, tps] = await source.sample(id);
        if (ttft === null && tps === null) return;
        await db.prepare(`INSERT INTO model_list_benchmarks VALUES (?,?,?,?,?)
          ON CONFLICT(model_id,source) DO UPDATE SET ttft=excluded.ttft,tps=excluded.tps,observed_at=excluded.observed_at
          WHERE excluded.observed_at >= model_list_benchmarks.observed_at`)
          .bind(modelId, source.name, ttft, tps, observedAt).run();
      }));
      for (const result of results) if (result.status === "rejected") {
        console.error(source.name, result.reason);
        failures++;
      }
    }
  }
  if (failures) throw new Error("One or more model benchmark requests failed.");
}
