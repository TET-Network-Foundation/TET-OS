import "dotenv/config";
import { AgentClient } from "../dist/index.js";

const INTERVAL_MS = 10_000;
const MAX_STEVEMON = 100;

async function sleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const agent = await AgentClient.fromEnv();

  for (;;) {
    try {
      const prompt = `Generate a random complex mathematical problem and solve it. Timestamp: ${Date.now()}`;
      const r = await agent.requestInference(prompt, MAX_STEVEMON);
      if (r.ok) {
        const preview = r.responseText.length > 240 ? `${r.responseText.slice(0, 240)}…` : r.responseText;
        console.log(`[ignite] ok status=${r.status} len=${r.responseText.length} preview=${preview}`);
      } else {
        console.error(`[ignite] request failed status=${r.status} err=${r.error}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ignite] caught ${msg}`);
    }
    await sleep(INTERVAL_MS);
  }
}

main().catch((e) => {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[ignite] fatal ${msg}`);
  process.exit(1);
});
