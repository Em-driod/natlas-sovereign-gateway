/**
 * Drop-in: the official OpenAI SDK, pointed at the gateway. One line changes: baseURL.
 *   npx tsx examples/openai-node.ts
 */
import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.GATEWAY_URL ?? "http://127.0.0.1:8080/v1", // <- the only change
  apiKey: process.env.GATEWAY_KEY ?? "sk-natlas-demo-key",
});

const prompt = "My customer NIN is 12345678901, explain loan policy in Pidgin.";

// Standard call.
const res = await client.chat.completions.create({
  model: "n-atlas-8b",
  temperature: 0.2,
  messages: [{ role: "user", content: prompt }],
});
console.log("Answer:", res.choices[0]?.message.content);
console.log("Gateway:", (res as unknown as { natlas: unknown }).natlas);

// Streaming works too, with PII re-hydrated on the fly.
const stream = await client.chat.completions.create({
  model: "n-atlas-8b",
  stream: true,
  messages: [{ role: "user", content: "Customer phone is 08031234567. Translate 'your loan is approved' to Hausa." }],
});
process.stdout.write("\nStreamed: ");
for await (const chunk of stream) process.stdout.write(chunk.choices[0]?.delta?.content ?? "");
console.log();
