import type {
  RecommendModelOptions,
  SirayaModel,
  SirayaModelCapability,
  SirayaRegistry,
  ValidationIssue
} from "./types.js";

const BASE_PARAMETERS = [
  "model",
  "messages",
  "temperature",
  "top_p",
  "max_tokens",
  "max_completion_tokens",
  "stop",
  "stream",
  "stream_options",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "response_format",
  "user"
];

const FAMILY_PARAMETERS: Record<SirayaModelCapability["family"], string[]> = {
  gpt: ["reasoning_effort", "web_search_options", "logprobs", "top_logprobs", "seed", "service_tier"],
  claude: ["thinking", "reasoning_effort", "cache_control", "top_k"],
  gemini: ["thinking", "reasoning_effort", "seed", "top_k"],
  deepseek: ["response_format"],
  grok: ["reasoning_effort"],
  qwen: ["top_k"],
  kimi: [],
  glm: [],
  minimax: [],
  seed: [],
  image: ["prompt", "n", "size", "quality", "response_format"],
  video: ["prompt", "duration", "seconds", "image_url"],
  audio: ["input", "file", "language", "response_format", "temperature"],
  embedding: ["input", "encoding_format", "dimensions"],
  rerank: ["query", "documents", "top_n"],
  other: []
};

export function inferCapabilities(model: SirayaModel): SirayaModelCapability {
  const id = model.id.toLowerCase();
  const provider = inferProvider(id, typeof model.owned_by === "string" ? model.owned_by : undefined);
  const providerInfo = PROVIDERS[provider] ?? PROVIDERS.other;
  const family = inferFamily(id);
  const category = inferCategory(family);
  const isImage = category === "image";
  const isVideo = category === "video";
  const isAudio = category === "audio";
  const isEmbedding = category === "embedding";
  const isRerank = category === "rerank";
  const textLike = category === "text";
  const claudeLike = family === "claude";
  const gptLike = family === "gpt";
  const geminiLike = family === "gemini";
  const grokLike = family === "grok";
  const visionText = textLike && (claudeLike || geminiLike || gptLike || grokLike);

  const supportedParameters = unique([
    ...BASE_PARAMETERS,
    ...(FAMILY_PARAMETERS[family] ?? []),
    ...(isImage ? FAMILY_PARAMETERS.image : []),
    ...(isVideo ? FAMILY_PARAMETERS.video : []),
    ...(isAudio ? FAMILY_PARAMETERS.audio : []),
    ...(isEmbedding ? FAMILY_PARAMETERS.embedding : []),
    ...(isRerank ? FAMILY_PARAMETERS.rerank : [])
  ]);

  return {
    id: model.id,
    provider,
    providerName: providerInfo.name,
    family,
    category,
    documentationUrl: providerInfo.documentationUrl,
    pricingUrl: providerInfo.pricingUrl,
    capabilitySource: "inferred",
    apiFormats: textLike
      ? ["openai_chat", "openai_responses", "anthropic_messages"]
      : ["openai_chat"],
    modalities: [
      ...(textLike ? ["text"] : []),
      ...(isImage ? ["image_output"] : []),
      ...(isVideo ? ["video_output"] : []),
      ...(isAudio ? ["audio_input", "text_output"] : []),
      ...(isEmbedding ? ["embedding"] : []),
      ...(isRerank ? ["rerank"] : []),
      ...(visionText ? ["image_input", "pdf_input"] : [])
    ],
    features: {
      streaming: textLike,
      toolCalling: textLike,
      structuredOutputs: textLike,
      reasoning: inferReasoning(family, id),
      promptCaching: claudeLike ? "explicit" : textLike ? "implicit" : "none",
      webSearch: false,
      imageInput: visionText,
      pdfInput: visionText && !grokLike,
      imageGeneration: isImage,
      videoGeneration: isVideo,
      embeddings: isEmbedding,
      reranking: isRerank
    },
    supportedParameters,
    notes: inferNotes(family, id),
    raw: model
  };
}

export function buildRegistry(models: SirayaModel[], source = "https://llm.siraya.ai/v1/models"): SirayaRegistry {
  return {
    object: "siraya.model_registry",
    generatedAt: new Date().toISOString(),
    source,
    models: models.map(inferCapabilities).sort((a, b) => a.id.localeCompare(b.id))
  };
}

export function recommendModel(registry: SirayaRegistry, options: RecommendModelOptions = {}): SirayaModelCapability | undefined {
  const candidates = registry.models
    .filter((model) => matchesTask(model, options.task))
    .filter((model) => !options.apiFormat || model.apiFormats.includes(options.apiFormat))
    .filter((model) => matchesRequiredFeatures(model, options.require))
    .filter((model) => !options.preferProvider?.length || options.preferProvider.includes(model.provider ?? ""))
    .filter((model) => !options.avoidProvider?.includes(model.provider ?? ""));

  return candidates.sort(scoreModel(options))[0];
}

export function validateRequest(model: SirayaModelCapability, request: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  for (const key of Object.keys(request)) {
    if (key === "extra_body") continue;
    if (!model.supportedParameters.includes(key)) {
      issues.push({
        level: "warning",
        parameter: key,
        message: `${key} is not known to take effect on ${model.id}; SIRAYA may silently drop unsupported parameters.`
      });
    }
  }

  if (request.tools && !model.features.toolCalling) {
    issues.push({ level: "error", parameter: "tools", message: `${model.id} is not marked as tool-call capable.` });
  }
  if (request.response_format && !model.features.structuredOutputs) {
    issues.push({ level: "error", parameter: "response_format", message: `${model.id} is not marked as structured-output capable.` });
  }
  if ((request.reasoning_effort || request.thinking) && !model.features.reasoning) {
    issues.push({ level: "warning", parameter: "reasoning", message: `${model.id} may ignore reasoning controls.` });
  }
  return issues;
}

function inferFamily(id: string): SirayaModelCapability["family"] {
  if (id.includes("seedance") || id.includes("veo") || id.includes("video")) return "video";
  if (id.includes("seedream") || id.includes("imagen") || id.includes("gpt-image") || id.includes("-image")) return "image";
  if (id.includes("asr") || id.includes("transcri") || id.includes("speech") || id.includes("tts") || id.includes("audio")) return "audio";
  if (id.includes("embed")) return "embedding";
  if (id.includes("rerank")) return "rerank";
  if (id.includes("gpt") || /(^|[-/])o[134]([-.]|$)/.test(id)) return "gpt";
  if (id.includes("claude")) return "claude";
  if (id.includes("gemini")) return "gemini";
  if (id.includes("deepseek")) return "deepseek";
  if (id.includes("grok")) return "grok";
  if (id.includes("qwen")) return "qwen";
  if (id.includes("kimi")) return "kimi";
  if (id.includes("glm")) return "glm";
  if (id.includes("minimax")) return "minimax";
  if (id.includes("seed")) return "seed";
  return "other";
}

function inferProvider(id: string, declaredProvider?: string): string {
  if (id.startsWith("siraya-") || id.startsWith("dola-")) return "siraya";
  if (id.includes("bytedance") || id.includes("seedance") || id.includes("seedream") || id.startsWith("seed-")) return "bytedance";
  if (id.includes("claude")) return "anthropic";
  if (id.includes("gemini") || id.includes("imagen") || id.includes("veo")) return "google";
  if (id.includes("deepseek")) return "deepseek";
  if (id.includes("grok")) return "xai";
  if (id.includes("qwen")) return "alibaba";
  if (id.includes("kimi")) return "moonshot";
  if (id.includes("glm")) return "zhipu";
  if (id.includes("minimax")) return "minimax";
  if (id.includes("gpt") || /(^|[-/])o[134]([-.]|$)/.test(id)) return "openai";
  const normalized = declaredProvider?.toLowerCase();
  return normalized && normalized !== "openai" ? normalized : "other";
}

function inferCategory(family: SirayaModelCapability["family"]): SirayaModelCapability["category"] {
  if (["image", "video", "audio", "embedding", "rerank"].includes(family)) {
    return family as SirayaModelCapability["category"];
  }
  return "text";
}

function inferReasoning(family: SirayaModelCapability["family"], id: string): boolean {
  if (id.includes("non-reasoning")) return false;
  if (family === "gpt") return id.includes("gpt-5") || /(^|[-/])o[134]([-.]|$)/.test(id);
  if (["claude", "gemini", "deepseek", "grok"].includes(family)) return true;
  if (family === "qwen") return id.includes("max") || id.includes("plus");
  if (family === "kimi") return id.includes("k2.5");
  if (family === "glm") return id.includes("5");
  return false;
}

const PROVIDERS: Record<string, { name: string; documentationUrl: string; pricingUrl?: string }> = {
  openai: { name: "OpenAI", documentationUrl: "https://platform.openai.com/docs/models", pricingUrl: "https://openai.com/api/pricing/" },
  anthropic: { name: "Anthropic", documentationUrl: "https://docs.anthropic.com/en/docs/about-claude/models/overview", pricingUrl: "https://docs.anthropic.com/en/docs/about-claude/pricing" },
  google: { name: "Google", documentationUrl: "https://ai.google.dev/gemini-api/docs/models", pricingUrl: "https://ai.google.dev/gemini-api/docs/pricing" },
  deepseek: { name: "DeepSeek", documentationUrl: "https://api-docs.deepseek.com/quick_start/pricing", pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing" },
  xai: { name: "xAI", documentationUrl: "https://docs.x.ai/developers/models", pricingUrl: "https://docs.x.ai/developers/pricing" },
  alibaba: { name: "Alibaba Cloud", documentationUrl: "https://www.alibabacloud.com/help/en/model-studio/getting-started/models", pricingUrl: "https://help.aliyun.com/en/model-studio/model-pricing" },
  moonshot: { name: "Moonshot AI", documentationUrl: "https://platform.moonshot.ai/docs/intro" },
  zhipu: { name: "Z.ai", documentationUrl: "https://docs.z.ai/guides/overview/models" },
  minimax: { name: "MiniMax", documentationUrl: "https://platform.minimax.io/docs/guides/models-intro" },
  bytedance: { name: "ByteDance Seed", documentationUrl: "https://seed.bytedance.com/en/" },
  siraya: { name: "SIRAYA", documentationUrl: "https://docs.siraya.ai/docs/" },
  other: { name: "Other", documentationUrl: "https://docs.siraya.ai/docs/" }
};

function inferNotes(family: SirayaModelCapability["family"], id: string): string[] {
  const notes: string[] = [];
  if (family === "gpt") notes.push("GPT-5 family parameters are sanitized; max_tokens is normalized to max_completion_tokens.");
  if (family === "claude") notes.push("Claude thinking is normalized by SIRAYA; cache_control supports explicit prompt caching.");
  if (family === "gemini") notes.push("top_k should be sent through extra_body when needed.");
  if (family === "video") notes.push("Video generation is long-running; use generous HTTP timeouts.");
  if (id.includes("deepseek")) notes.push("Some DeepSeek structured output flows may require json_object instead of strict json_schema.");
  return notes;
}

function matchesTask(model: SirayaModelCapability, task?: RecommendModelOptions["task"]): boolean {
  if (!task || task === "chat") return model.modalities.includes("text");
  if (task === "agent") return model.features.toolCalling && model.features.streaming;
  if (task === "coding") return model.modalities.includes("text");
  if (task === "reasoning") return model.features.reasoning;
  if (task === "structured_output") return model.features.structuredOutputs;
  if (task === "vision") return model.features.imageInput;
  if (task === "pdf") return model.features.pdfInput;
  if (task === "image_generation") return model.features.imageGeneration;
  if (task === "video_generation") return model.features.videoGeneration;
  if (task === "embedding") return model.features.embeddings;
  if (task === "rerank") return model.features.reranking;
  return true;
}

function matchesRequiredFeatures(
  model: SirayaModelCapability,
  required?: RecommendModelOptions["require"]
): boolean {
  if (!required) return true;
  return Object.entries(required).every(([key, value]) => value === undefined || model.features[key as keyof typeof model.features] === value);
}

function scoreModel(options: RecommendModelOptions): (a: SirayaModelCapability, b: SirayaModelCapability) => number {
  return (a, b) => {
    const aScore = preferenceScore(a, options);
    const bScore = preferenceScore(b, options);
    return bScore - aScore || a.id.localeCompare(b.id);
  };
}

function preferenceScore(model: SirayaModelCapability, options: RecommendModelOptions): number {
  let score = 0;
  if (options.preferProvider?.includes(model.provider ?? "")) score += 20;
  if (model.family === "claude" && ["agent", "coding"].includes(options.task ?? "")) score += 8;
  if (model.family === "gpt" && ["reasoning", "structured_output"].includes(options.task ?? "")) score += 8;
  if (model.family === "gemini" && ["vision", "pdf"].includes(options.task ?? "")) score += 8;
  if (model.features.reasoning) score += 3;
  if (model.features.toolCalling) score += 3;
  if (model.features.structuredOutputs) score += 2;
  return score;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
