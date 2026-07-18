# SIRAYA Agent SDK

`@siraya/agent` is the TypeScript SDK layer for agentic apps that use SIRAYA Model Router.

It does four jobs:

1. Reads available models from `GET https://llm.siraya.ai/v1/models`.
2. Builds an inferred model capability registry.
3. Recommends a model for a task such as agent, reasoning, vision, image generation, or video generation.
4. Runs direct calls or a simple tool-calling loop through SIRAYA.

## Install

```bash
pnpm add @siraya/agent
```

Until the package is published, use this workspace package directly:

```bash
pnpm install
pnpm --filter @siraya/agent build
```

## Configure

```bash
SIRAYA_API_KEY=sk-...
SIRAYA_BASE_URL=https://llm.siraya.ai/v1
```

Or pass values in code:

```ts
import { Siraya } from "@siraya/agent";

const siraya = new Siraya({
  apiKey: process.env.SIRAYA_API_KEY,
  baseUrl: "https://llm.siraya.ai/v1"
});
```

For production agents, use the hosted daily registry so every deployment sees the same current model catalog:

```ts
const siraya = new Siraya({
  apiKey: process.env.SIRAYA_API_KEY,
  baseUrl: "https://llm.siraya.ai/v1",
  registryUrl: "https://siraya-mcp.bruceatsiraya.xyz/registry"
});
```

Keep `SIRAYA_API_KEY` in the agent's server-side secret manager. Never send it to a browser or mobile client.

## List Models

```ts
const models = await siraya.listModels();
console.log(models.map((model) => model.id));
```

## Build the Registry

```ts
const registry = await siraya.getRegistry();
console.log(registry.generatedAt);
console.log(registry.models[0]);
```

The registry currently combines live `/v1/models` output with SDK inference rules based on model IDs and providers. It is intentionally conservative: when a feature cannot be confirmed, it is marked as unsupported or added as a note.

## Recommend a Model

```ts
const model = await siraya.recommendModel({
  task: "agent",
  require: {
    toolCalling: true,
    reasoning: true
  },
  apiFormat: "openai_chat"
});

console.log(model.id);
```

Supported task values:

- `chat`
- `agent`
- `coding`
- `reasoning`
- `structured_output`
- `vision`
- `pdf`
- `image_generation`
- `video_generation`
- `embedding`
- `rerank`

## Validate a Request

```ts
const issues = await siraya.validateRequest("gpt-5.4-pro", {
  model: "gpt-5.4-pro",
  messages: [{ role: "user", content: "Return JSON." }],
  response_format: { type: "json_object" },
  temperature: 0.2
});

for (const issue of issues) {
  console.log(issue.level, issue.parameter, issue.message);
}
```

Validation follows SIRAYA documentation: unsupported parameters may be silently dropped by the router, so the SDK warns before the request is sent.

## Direct Chat Completion

```ts
const response = await siraya.chatCompletions({
  model: "deepseek-v4-flash",
  messages: [{ role: "user", content: "Hello from SIRAYA." }]
});

console.log(response);
```

## Agent Loop with Tools

```ts
import { Siraya, tool, stepCountIs } from "@siraya/agent";

const siraya = new Siraya({ apiKey: process.env.SIRAYA_API_KEY });

const getWeather = tool({
  name: "get_weather",
  description: "Get current weather for a city.",
  inputSchema: {
    type: "object",
    properties: {
      city: { type: "string" }
    },
    required: ["city"],
    additionalProperties: false
  },
  execute: async ({ city }: { city: string }) => ({
    city,
    condition: "sunny",
    temperatureC: 31
  })
});

const result = await siraya.callModel({
  model: "auto",
  task: "agent",
  messages: [{ role: "user", content: "What is the weather in Singapore?" }],
  tools: [getWeather],
  provider: {
    require_parameters: true
  },
  stopWhen: [stepCountIs(5)]
});

console.log(result.getText());
```

`model: "auto"` calls the registry and chooses a model matching the task and required features.

## Image and Video

```ts
await siraya.generateImage({
  model: "imagen-4.0-generate-001",
  prompt: "A clean product shot of a SIRAYA AI gateway dashboard"
});

await siraya.generateVideo({
  model: "veo-3.1-generate-001",
  prompt: "A cinematic product animation of model routing decisions",
  duration: 4
});
```

Video generation can take longer than text generation. Use generous HTTP timeouts in production.

## Relationship to OpenRouter Agent SDK

This SDK follows the same product category as OpenRouter's Agent SDK: it provides agent primitives above the raw client API. The SIRAYA version is focused on SIRAYA Model Router capabilities:

- live model discovery
- SIRAYA routing parameters
- SIRAYA parameter validation
- SIRAYA-compatible OpenAI and Responses calls
- optional model auto-selection

The current implementation is an MVP. The next step is to add durable conversation state, streaming callbacks, tool approval hooks, and cost-aware stop conditions.
