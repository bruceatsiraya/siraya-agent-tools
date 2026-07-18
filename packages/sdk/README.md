# @siraya/agent

TypeScript Agent SDK for SIRAYA Model Router.

```ts
import { Siraya, tool, stepCountIs } from "@siraya/agent";

const siraya = new Siraya({ apiKey: process.env.SIRAYA_API_KEY });

const weather = tool({
  name: "get_weather",
  description: "Get current weather for a city.",
  inputSchema: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false
  },
  execute: async ({ city }: { city: string }) => ({ city, condition: "sunny" })
});

const result = await siraya.callModel({
  model: "auto",
  task: "agent",
  messages: [{ role: "user", content: "What is the weather in Singapore?" }],
  tools: [weather],
  stopWhen: [stepCountIs(5)]
});

console.log(result.getText());
```
