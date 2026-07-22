export { Siraya } from "./client.js";
export { buildRegistry, filterModels, inferCapabilities, recommendModel, validateRequest } from "./registry.js";
export { CAPABILITY_TAXONOMY } from "./taxonomy.js";
export { stepCountIs, hasToolCall, textIncludes } from "./stop-conditions.js";
export { tool } from "./tools.js";
export type {
  CallModelOptions,
  CallModelResult,
  ChatMessage,
  FilterModelsOptions,
  RecommendModelOptions,
  SirayaApiFormat,
  SirayaCapabilityTag,
  SirayaClientOptions,
  SirayaModel,
  SirayaModelCategory,
  SirayaModelCapability,
  SirayaModelLifecycle,
  SirayaModelTrait,
  SirayaPricingQuote,
  SirayaPublicSource,
  SirayaRegistry,
  SirayaQualityTier,
  SirayaSpeedTier,
  SirayaTask,
  SirayaTaskTag,
  SirayaToolDefinition,
  StopCondition,
  ValidationIssue
} from "./types.js";
