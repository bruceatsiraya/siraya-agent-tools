import { Siraya, stepCountIs, tool } from "@siraya/agent";

const siraya = new Siraya({ apiKey: process.env.SIRAYA_API_KEY });

const lookupCustomer = tool({
  name: "lookup_customer",
  description: "Look up a customer by ID.",
  inputSchema: {
    type: "object",
    properties: {
      customerId: { type: "string" }
    },
    required: ["customerId"],
    additionalProperties: false
  },
  execute: async ({ customerId }: { customerId: string }) => ({
    customerId,
    tier: "enterprise",
    region: "APAC"
  })
});

const result = await siraya.callModel({
  model: "auto",
  task: "agent",
  messages: [{ role: "user", content: "Check customer c_123 and summarize the account." }],
  tools: [lookupCustomer],
  provider: { require_parameters: true },
  stopWhen: [stepCountIs(5)]
});

console.log(result.getText());
