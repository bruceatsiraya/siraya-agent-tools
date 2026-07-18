import { Siraya } from "@siraya/agent";

const siraya = new Siraya({ apiKey: process.env.SIRAYA_API_KEY });

const model = await siraya.recommendModel({ task: "chat" });

const response = await siraya.chatCompletions({
  model: model.id,
  messages: [{ role: "user", content: "Say hello from SIRAYA Model Router." }]
});

console.log(response);
