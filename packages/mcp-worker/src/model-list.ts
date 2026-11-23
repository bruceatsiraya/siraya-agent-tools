import { identifyModel, inferCapabilities, type SirayaModelCapability, type SirayaRegistry } from "@siraya/agent";

import type { CatalogPrice } from "./siraya-prices.js";

export const headers = [
  "No.", "Family", "Model", "Model ID (API Parameter)", "Discount Factor", "Category", "Input Modalities",
  "Output Modality", "Context Window", "Max Input", "Max Output", "RPM", "TPM",
  "TTFT (s)", "TPS"
];

export const discountColumn = headers.indexOf("Discount Factor");
export const referenceNotes = [
  "TTFT and TPS are short-window online benchmark statistics for reference only.",
  "RPM and TPM are for reference only and do not guarantee actual rate limits."
];
export type Cell = string | number | null;
type Source = "Infron" | "OpenRouter";

export const editableFields = ["rpm", "tpm", "ttft", "tps", "discount"] as const;
type EditableField = typeof editableFields[number];
type ManualValues = Partial<Record<EditableField, number | null>>;

interface Spec {
  model_id: string;
  rpm: number | null;
  tpm: number | null;
  discount: number | null;
  baseline: string | null;
}

export interface Benchmark {
  model_id: string;
  source: Source;
  ttft: number | null;
  tps: number | null;
  observed_at: string;
}

export function visibleModel(model: SirayaModelCapability): boolean {
  return model.lifecycle !== "dated"
    && !/(?:^|[^a-z0-9])(nsfw|spicy|uncensored)(?:$|[^a-z0-9])/i.test(model.id)
    && !/[-_]20\d{2}[-_]\d{2}[-_]\d{2}(?:$|[-_:])|[-_]20\d{6}$/.test(model.id)
    && model.raw.nsfw !== true;
}

const families: Record<string, string> = {
  claude: "Anthropic", gpt: "OpenAI", gemini: "Google", grok: "xAI", seed: "BytePlus",
  deepseek: "DeepSeek", glm: "GLM", qwen: "Qwen", kimi: "Kimi", minimax: "MiniMax"
};

export function modelCategory(model: SirayaModelCapability): string {
  const category = model.category;
  return category === 'unknown' ? 'Pending review' : category === "text" ? "LLM" : category[0].toUpperCase() + category.slice(1);
}

/** Correct display metadata on old quotes while preserving every quoted price. */
export function correctQuoteIdentity(cells: Cell[]): Cell[] {
  if(cells.length < headers.length || typeof cells[3] !== 'string' || !identifyModel(cells[3])) return cells;
  const model=inferCapabilities({id:cells[3]});
  const corrected=[...cells];corrected[1]=model.providerName;corrected[5]=modelCategory(model);return corrected;
}

export async function modelListRows(db: D1Database, registry: SirayaRegistry, prices: Record<string,CatalogPrice> = {}) {
  const [specs, measurements, overrides] = await Promise.all([
    db.prepare("SELECT model_id,rpm,tpm,discount,baseline FROM model_list_specs").all<Spec>(),
    db.prepare("SELECT * FROM model_list_benchmarks").all<Benchmark>(),
    db.prepare("SELECT model_id,values_json FROM model_list_overrides").all<{ model_id: string; values_json: string }>()
  ]);
  const byId = new Map(specs.results.map(spec => [spec.model_id, spec]));
  const manualById = new Map(overrides.results.map(row => [row.model_id, JSON.parse(row.values_json) as ManualValues]));
  const bySource = new Map(measurements.results.map(metric => [metric.model_id + "|" + metric.source, metric]));
  return registry.models.filter(visibleModel).map(model => {
    const spec = byId.get(model.id);
    const seed: Cell[] = spec?.baseline ? JSON.parse(spec.baseline) : [];
    const category = modelCategory(model);
    const raw = model.raw;
    const infron = bySource.get(model.id + "|Infron");
    const openRouter = bySource.get(model.id + "|OpenRouter");
    const ttft = infron?.ttft ?? openRouter?.ttft ?? seed[12] ?? null;
    const tps = infron?.tps ?? openRouter?.tps ?? seed[13] ?? null;
    const manual = manualById.get(model.id) ?? {};
    const limit = (field: "rpm" | "tpm" | "discount") => Object.hasOwn(manual, field) ? manual[field] ?? null : spec?.[field] ?? null;
    const automatic = { ttft: category === "LLM" ? ttft : null, tps: category === "LLM" ? tps : null };
    const compatible = category.toLowerCase() === model.category || category === "LLM";
    const output: Record<string, string> = { Video: "video", Image: "image", Audio: "audio", Embedding: "embedding", Rerank: "ranking" };
    const family = model.identityCheck ? model.providerName : identifyModel(model.id) ? inferCapabilities({...model.raw,id:model.id}).providerName : seed[1] ?? families[model.family] ?? "Unverified";
    const cells: Cell[] = [
      null, family, seed[2] ?? model.id, model.id, limit("discount"), category,
      compatible ? model.inputModalities.join(", ") || null : seed[5] ?? null,
      output[category] ?? (model.outputModalities.join(", ") || null),
      metricNumber(raw.context_window ?? raw.context_length) ?? seed[7] ?? null,
      metricNumber(raw.max_input_tokens) ?? seed[8] ?? null,
      metricNumber(raw.max_output_tokens ?? raw.max_completion_tokens) ?? seed[9] ?? null,
      limit("rpm"), limit("tpm"), manual.ttft ?? automatic.ttft,
      manual.tps ?? automatic.tps
    ];
    return { cells, modelFamily: model.family, category, infron, openRouter, manual, automatic, officialPrice: prices[model.id.toLowerCase()] };
  }).sort((a, b) => String(a.cells[1]).localeCompare(String(b.cells[1])) ||
    a.category.localeCompare(b.category) ||
    String(a.cells[3]).localeCompare(String(b.cells[3]), "en", { numeric: true }))
    .map((row, index) => { row.cells[0] = index + 1; return row; });
}

function nullableNumber(value: unknown, name: string, isDiscount = false): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 ||
      (isDiscount ? value > 1 : !Number.isSafeInteger(value))) {
    throw new Error("Invalid " + name);
  }
  return value;
}

export function applyExportDiscounts(rows: Awaited<ReturnType<typeof modelListRows>>, payload: unknown): Cell[][] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid discounts.");
  const discounts = payload as Record<string, unknown>;
  return rows.map(({ cells }) => {
    const id = String(cells[3]);
    if (!Object.hasOwn(discounts, id)) return cells;
    const copy = [...cells];
    copy[discountColumn] = nullableNumber(discounts[id], "discount", true);
    return copy;
  });
}

export async function saveListSpecs(db: D1Database, registry: SirayaRegistry, edits: unknown) {
  if (!Array.isArray(edits) || !edits.length || edits.length > registry.models.length) {
    throw new Error("Invalid number of model edits.");
  }
  const allowed = new Set(registry.models.filter(visibleModel).map(model => model.id));
  const seen = new Set<string>();
  const statements = edits.map(edit => {
    const { id, values } = edit ?? {};
    if (typeof id !== "string" || !allowed.has(id) || seen.has(id) ||
        !values || typeof values !== "object" || Array.isArray(values)) {
      throw new Error("Invalid or duplicate model edit.");
    }
    seen.add(id);
    const fields = editableFields.filter(field => Object.hasOwn(values, field));
    if (!fields.length || fields.length !== Object.keys(values).length) throw new Error("Invalid model fields.");

    const patch: ManualValues = {};
    for (const field of fields) {
      const value = values[field];
      if (field === "ttft" || field === "tps") {
        if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0)) {
          throw new Error("Invalid " + field);
        }
        patch[field] = value;
      } else {
        patch[field] = nullableNumber(value, field, field === "discount");
      }
    }
    const updates = fields.map(field => `'$.${field}', json_extract(excluded.values_json, '$.${field}')`).join(", ");
    return db.prepare(`INSERT INTO model_list_overrides (model_id,values_json) VALUES (?,?)
      ON CONFLICT(model_id) DO UPDATE SET values_json=json_set(model_list_overrides.values_json, ${updates})`)
      .bind(id, JSON.stringify(patch));
  });
  await db.batch(statements);
  return statements.length;
}

export async function importListSpecs(db: D1Database, value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error("Expected 1–500 workbook rows.");
  const seen = new Set<string>();
  const statements = value.map((row: unknown) => {
    if (!Array.isArray(row) || (row.length !== headers.length && row.length !== headers.length + 1) || row.some(cell =>
      cell !== null && typeof cell !== "number" && (typeof cell !== "string" || cell.length > 512))) {
      throw new Error("Invalid workbook row.");
    }
    const id = row[3];
    if (typeof id !== "string" || !id.trim() || seen.has(id)) throw new Error("Invalid or duplicate model ID.");
    seen.add(id);
    return db.prepare(`INSERT INTO model_list_specs (model_id,rpm,tpm,discount,baseline) VALUES (?,?,?,?,?)
      ON CONFLICT(model_id) DO UPDATE SET baseline=excluded.baseline,
      rpm=CASE WHEN edited=0 THEN excluded.rpm ELSE rpm END,
      tpm=CASE WHEN edited=0 THEN excluded.tpm ELSE tpm END,
      discount=CASE WHEN edited=0 THEN excluded.discount ELSE discount END`)
      .bind(id, nullableNumber(row[10], "RPM"), nullableNumber(row[11], "TPM"),
        nullableNumber(row[14], "discount", true), JSON.stringify(row));
  });
  await db.batch(statements);
  return statements.length;
}

export function metricNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}
