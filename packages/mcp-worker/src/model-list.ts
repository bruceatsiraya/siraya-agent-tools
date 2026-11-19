import type { SirayaModelCapability, SirayaRegistry } from "@siraya/agent";

export const headers = [
  "No.", "Family", "Model", "Model ID (API Parameter)", "Category", "Input Modalities",
  "Output Modality", "Context Window", "Max Input", "Max Output", "RPM", "TPM",
  "TTFT (s)", "TPS", "Discount Factor", "API Format"
];

export type Cell = string | number | null;
type Source = "Infron" | "OpenRouter";

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
  const id = model.id.toLowerCase();
  if (/kling|happyhorse|seedance|(?:^|-)veo|wan.*(?:i2v|t2v)|minimax.*h3/.test(id)) return "Video";
  if (/seedream|gpt-image|gemini.*image/.test(id)) return "Image";
  return model.category === "text" ? "LLM" : model.category[0].toUpperCase() + model.category.slice(1);
}

export async function modelListRows(db: D1Database, registry: SirayaRegistry, admin: boolean) {
  const [specs, measurements] = await Promise.all([
    db.prepare("SELECT model_id,rpm,tpm,discount,baseline FROM model_list_specs").all<Spec>(),
    db.prepare("SELECT * FROM model_list_benchmarks").all<Benchmark>()
  ]);
  const byId = new Map(specs.results.map(spec => [spec.model_id, spec]));
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
    const compatible = category.toLowerCase() === model.category || category === "LLM";
    const output: Record<string, string> = { Video: "video", Image: "image", Audio: "audio", Embedding: "embedding", Rerank: "ranking" };
    const family = seed[1] ?? (/kling/i.test(model.id) ? "Kling" : /happyhorse/i.test(model.id) ? "HappyHorse" :
      /^(wan|.*-wan)[\d.-]/i.test(model.id) ? "Wan" : /veo/i.test(model.id) ? "Google" : families[model.family] ?? "Other");
    const cells: Cell[] = [
      null, family, seed[2] ?? model.id, model.id, category,
      compatible ? model.inputModalities.join(", ") || null : seed[5] ?? null,
      output[category] ?? (model.outputModalities.join(", ") || null),
      metricNumber(raw.context_window ?? raw.context_length) ?? seed[7] ?? null,
      metricNumber(raw.max_input_tokens) ?? seed[8] ?? null,
      metricNumber(raw.max_output_tokens ?? raw.max_completion_tokens) ?? seed[9] ?? null,
      spec?.rpm ?? null, spec?.tpm ?? null, category === "LLM" ? ttft : null,
      category === "LLM" ? tps : null, admin ? spec?.discount ?? null : null,
      compatible ? model.apiFormats.join(", ") || null : seed[15] ?? null
    ];
    return { cells, infron, openRouter };
  }).sort((a, b) => String(a.cells[1]).localeCompare(String(b.cells[1])) ||
    String(a.cells[4]).localeCompare(String(b.cells[4])) ||
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

export async function saveListSpec(db: D1Database, id: string, body: Record<string, unknown>) {
  const { rpm, tpm, discount } = body;
  await db.prepare(`INSERT INTO model_list_specs (model_id,rpm,tpm,discount,edited) VALUES (?,?,?,?,1)
    ON CONFLICT(model_id) DO UPDATE SET rpm=excluded.rpm,tpm=excluded.tpm,discount=excluded.discount,edited=1`)
    .bind(id, nullableNumber(rpm, "RPM"), nullableNumber(tpm, "TPM"), nullableNumber(discount, "discount", true)).run();
}

export async function importListSpecs(db: D1Database, value: unknown) {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error("Expected 1–500 workbook rows.");
  const seen = new Set<string>();
  const statements = value.map((row: unknown) => {
    if (!Array.isArray(row) || row.length !== headers.length || row.some(cell =>
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
