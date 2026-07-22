import type {
  SirayaCapabilityTag,
  SirayaModelCapability,
  SirayaModelLifecycle,
  SirayaModelTrait,
  SirayaQualityTier,
  SirayaSpeedTier,
  SirayaTaskTag
} from "./types.js";

export const CAPABILITY_TAXONOMY = {
  capabilityTags: {
    streaming: "Can return incremental streamed output.",
    tool_calling: "Can select and call tools or functions.",
    structured_output: "Can return schema-constrained or structured output.",
    reasoning: "Supports reasoning-oriented behavior or controls.",
    prompt_caching: "Supports explicit or implicit prompt caching.",
    image_input: "Accepts images as input.",
    pdf_input: "Accepts PDF or document input.",
    image_generation: "Generates images.",
    video_generation: "Generates videos.",
    speech_recognition: "Transcribes or recognizes speech.",
    text_output: "Returns text output.",
    embeddings: "Produces vector embeddings.",
    reranking: "Ranks retrieved documents or candidates."
  } satisfies Record<SirayaCapabilityTag, string>,
  taskTags: {
    chat: "General conversational generation.",
    agent: "Agentic workflows that use tools and structured responses.",
    coding: "Code generation, editing, or software engineering.",
    reasoning: "Complex reasoning, planning, mathematics, or analysis.",
    structured_output: "Extraction and schema-constrained generation.",
    vision: "Image understanding and visual analysis.",
    document_analysis: "PDF and document understanding.",
    image_generation: "Text-to-image or image generation workflows.",
    video_generation: "Text-to-video or image-to-video workflows.",
    speech_to_text: "Audio transcription and speech recognition.",
    semantic_search: "Embedding-based search and retrieval.",
    retrieval_ranking: "Reranking search or retrieval candidates."
  } satisfies Record<SirayaTaskTag, string>,
  traits: {
    fast: "Model name indicates a latency-optimized variant.",
    economy: "Model name indicates a cost- or resource-efficient variant.",
    premium: "Model name indicates a quality-oriented premium variant.",
    small: "Model name indicates a smaller-capacity variant.",
    multimodal: "Supports more than text-only interaction.",
    specialized: "Built for a dedicated non-general workload.",
    preview: "Preview or pre-release model.",
    dated_snapshot: "Version-pinned model snapshot.",
    content_policy_relaxed: "Alias indicates a relaxed or uncensored content-policy profile."
  } satisfies Record<SirayaModelTrait, string>
} as const;

type TaxonomyInput = Pick<SirayaModelCapability, "id" | "category" | "family" | "features">;

export function inferTaxonomy(model: TaxonomyInput): {
  inputModalities: string[];
  outputModalities: string[];
  capabilityTags: SirayaCapabilityTag[];
  taskTags: SirayaTaskTag[];
  traits: SirayaModelTrait[];
  lifecycle: SirayaModelLifecycle;
  qualityTier: SirayaQualityTier;
  speedTier: SirayaSpeedTier;
  taxonomyConfidence: "inferred";
} {
  const id = model.id.toLowerCase();
  const capabilityTags = inferCapabilityTags(model);
  const taskTags = inferTaskTags(model, capabilityTags);
  const inputModalities = inferInputModalities(model);
  const outputModalities = inferOutputModalities(model);
  const qualityTier = inferQualityTier(model.category, id);
  const speedTier = inferSpeedTier(model.category, id);
  const lifecycle = inferLifecycle(id);
  const traits = inferTraits(model, id, qualityTier, speedTier, lifecycle, inputModalities, outputModalities);
  return {
    inputModalities,
    outputModalities,
    capabilityTags,
    taskTags,
    traits,
    lifecycle,
    qualityTier,
    speedTier,
    taxonomyConfidence: "inferred"
  };
}

function inferCapabilityTags(model: TaxonomyInput): SirayaCapabilityTag[] {
  const tags: SirayaCapabilityTag[] = [];
  if (model.features.streaming) tags.push("streaming");
  if (model.features.toolCalling) tags.push("tool_calling");
  if (model.features.structuredOutputs) tags.push("structured_output");
  if (model.features.reasoning) tags.push("reasoning");
  if (model.features.promptCaching !== "none" && model.features.promptCaching !== "unknown") tags.push("prompt_caching");
  if (model.features.imageInput) tags.push("image_input");
  if (model.features.pdfInput) tags.push("pdf_input");
  if (model.features.imageGeneration) tags.push("image_generation");
  if (model.features.videoGeneration) tags.push("video_generation");
  if (model.category === "audio") tags.push("speech_recognition", "text_output");
  if (model.features.embeddings) tags.push("embeddings");
  if (model.features.reranking) tags.push("reranking");
  if (model.category === "text") tags.push("text_output");
  return unique(tags);
}

function inferTaskTags(model: TaxonomyInput, tags: SirayaCapabilityTag[]): SirayaTaskTag[] {
  if (model.category === "image") return ["image_generation"];
  if (model.category === "video") return ["video_generation"];
  if (model.category === "audio") return ["speech_to_text"];
  if (model.category === "embedding") return ["semantic_search"];
  if (model.category === "rerank") return ["retrieval_ranking"];

  const id = model.id.toLowerCase();
  const tasks: SirayaTaskTag[] = ["chat"];
  if (tags.includes("tool_calling")) tasks.push("agent");
  if (tags.includes("structured_output")) tasks.push("structured_output");
  if (tags.includes("reasoning")) tasks.push("reasoning");
  if (tags.includes("image_input")) tasks.push("vision");
  if (tags.includes("pdf_input")) tasks.push("document_analysis");
  if (isCodingModel(model.family, id)) tasks.push("coding");
  return unique(tasks);
}

function inferInputModalities(model: TaxonomyInput): string[] {
  if (model.category === "image" || model.category === "video") return ["text", "image"];
  if (model.category === "audio") return ["audio"];
  if (model.category === "embedding") return ["text"];
  if (model.category === "rerank") return ["text", "documents"];
  return unique(["text", ...(model.features.imageInput ? ["image"] : []), ...(model.features.pdfInput ? ["pdf"] : [])]);
}

function inferOutputModalities(model: TaxonomyInput): string[] {
  if (model.category === "image") return ["image"];
  if (model.category === "video") return ["video"];
  if (model.category === "embedding") return ["embedding"];
  if (model.category === "rerank") return ["ranking"];
  return ["text"];
}

function inferLifecycle(id: string): SirayaModelLifecycle {
  if (id.includes("preview") || id.includes("beta")) return "preview";
  if (/20\d{2}-\d{2}-\d{2}/.test(id)) return "dated";
  return "stable";
}

function inferQualityTier(category: SirayaModelCapability["category"], id: string): SirayaQualityTier {
  if (category !== "text") return "specialized";
  if (hasVariant(id, ["nano", "mini", "lite", "flash", "turbo", "haiku"])) return "economy";
  if (hasVariant(id, ["pro", "max", "opus", "terra", "sol"])) return "premium";
  return "standard";
}

function inferSpeedTier(category: SirayaModelCapability["category"], id: string): SirayaSpeedTier {
  if (category !== "text") return id.includes("fast") ? "fast" : "unknown";
  if (hasVariant(id, ["fast", "flash", "turbo", "lite", "mini", "nano", "haiku"])) return "fast";
  if (hasVariant(id, ["pro", "max", "opus", "terra", "sol"])) return "quality";
  return "balanced";
}

function inferTraits(
  model: TaxonomyInput,
  id: string,
  qualityTier: SirayaQualityTier,
  speedTier: SirayaSpeedTier,
  lifecycle: SirayaModelLifecycle,
  inputModalities: string[],
  outputModalities: string[]
): SirayaModelTrait[] {
  const traits: SirayaModelTrait[] = [];
  if (speedTier === "fast") traits.push("fast");
  if (qualityTier === "economy") traits.push("economy");
  if (qualityTier === "premium") traits.push("premium");
  if (hasVariant(id, ["nano", "mini", "lite", "haiku"])) traits.push("small");
  if (model.category !== "text") traits.push("specialized");
  if (inputModalities.some(value => ["image", "audio", "video", "pdf"].includes(value))
    || outputModalities.some(value => ["image", "audio", "video"].includes(value))) traits.push("multimodal");
  if (lifecycle === "preview") traits.push("preview");
  if (lifecycle === "dated") traits.push("dated_snapshot");
  if (/(nsfw|uncensored)/.test(id)) traits.push("content_policy_relaxed");
  return unique(traits);
}

function isCodingModel(family: SirayaModelCapability["family"], id: string): boolean {
  if (/(codex|coder|code)/.test(id)) return true;
  return ["gpt", "claude", "gemini", "deepseek", "grok", "qwen", "kimi", "glm", "minimax"].includes(family);
}

function hasVariant(id: string, variants: string[]): boolean {
  return variants.some(variant => new RegExp(`(?:^|[-_.])${variant}(?:$|[-_.])`).test(id));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
