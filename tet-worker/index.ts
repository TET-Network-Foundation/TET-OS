/**
 * TET Worker (AI mining daemon) - MVP POC
 *
 * Loop (every ~15s):
 *  - AI phase: ask Ollama for a 1-sentence cyber quote
 *  - Chain phase: connect to local Substrate node
 *  - Work phase: sign & send a tiny transfer (Alice -> Bob)
 *
 * Requirements:
 *  - Local chain: ws://127.0.0.1:9944
 *  - Local Ollama: http://127.0.0.1:11434
 */

import { ApiPromise, WsProvider } from "@polkadot/api";
import { Keyring } from "@polkadot/keyring";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import crypto from "node:crypto";
import http from "node:http";

const WS_ENDPOINT = process.env.TET_WS_ENDPOINT ?? "ws://127.0.0.1:9944";
const OLLAMA_GENERATE = process.env.TET_OLLAMA_GENERATE ?? "http://127.0.0.1:11434/api/generate";
const OLLAMA_MODEL = process.env.TET_OLLAMA_MODEL ?? "llama3";
const WORKER_SEED = (process.env.TET_WORKER_SEED ?? "").trim();
const WORKER_CAPABILITY_HINT = Number(process.env.TET_WORKER_CAPABILITY_HINT ?? "1");
const METRICS_PORT = Number(process.env.TET_WORKER_METRICS_PORT ?? "9108");
const RUN_ONCE = (process.env.TET_WORKER_RUN_ONCE ?? "").trim() === "1";

const LOOP_MS = 15_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function ts() {
  return new Date().toISOString();
}

function banner(title: string) {
  const line = "-".repeat(Math.max(8, title.length));
  console.log(`\n[${ts()}] ${title}\n${line}`);
}

async function ollamaQuote(): Promise<string> {
  const payload = {
    model: OLLAMA_MODEL,
    prompt: "Give me a random 1-sentence cyber-quote. No preface, no quotes, one sentence only.",
    stream: false,
  };

  const r = await fetch(OLLAMA_GENERATE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ollama generate failed: ${r.status} ${text}`);

  // Ollama returns JSON like: { response: "...", ... }
  try {
    const j = JSON.parse(text) as { response?: unknown };
    const resp = (j?.response ?? "").toString().trim();
    return resp || "(empty ollama response)";
  } catch {
    return text.trim() || "(non-json ollama response)";
  }
}

let apiSingleton: ApiPromise | null = null;
async function getApi(): Promise<ApiPromise> {
  if (apiSingleton) return apiSingleton;
  const provider = new WsProvider(WS_ENDPOINT);
  const api = await ApiPromise.create({ provider: provider as any } as any);
  await api.isReady;

  apiSingleton = api;
  return api;
}

let keyringSingleton: Keyring | null = null;
function getKeyring(): Keyring {
  if (keyringSingleton) return keyringSingleton;
  const kr = new Keyring({ type: "sr25519" });
  keyringSingleton = kr;
  return kr;
}

const metrics = {
  txSuccess: 0,
  txFail: 0,
  ollamaFail: 0,
  loopCount: 0,
  lastLoopMs: 0,
  lastProofSubmissionLatencyMs: 0,
  lastTxInBlockHash: "",
};

function startMetricsServer() {
  const server = http.createServer((req, res) => {
    if (req.url !== "/metrics") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    const body = [
      "# HELP tet_worker_tx_success_total Total successful chain submissions",
      "# TYPE tet_worker_tx_success_total counter",
      `tet_worker_tx_success_total ${metrics.txSuccess}`,
      "# HELP tet_worker_tx_fail_total Total failed chain submissions",
      "# TYPE tet_worker_tx_fail_total counter",
      `tet_worker_tx_fail_total ${metrics.txFail}`,
      "# HELP tet_worker_ollama_fail_total Total failed ollama requests",
      "# TYPE tet_worker_ollama_fail_total counter",
      `tet_worker_ollama_fail_total ${metrics.ollamaFail}`,
      "# HELP tet_worker_loop_total Worker loop iterations",
      "# TYPE tet_worker_loop_total counter",
      `tet_worker_loop_total ${metrics.loopCount}`,
      "# HELP tet_worker_last_loop_duration_ms Last loop duration in ms",
      "# TYPE tet_worker_last_loop_duration_ms gauge",
      `tet_worker_last_loop_duration_ms ${metrics.lastLoopMs}`,
      "# HELP tet_worker_proof_submission_latency_ms Last proof submission+inBlock latency in ms",
      "# TYPE tet_worker_proof_submission_latency_ms gauge",
      `tet_worker_proof_submission_latency_ms ${metrics.lastProofSubmissionLatencyMs}`,
    ].join("\n");

    res.statusCode = 200;
    res.setHeader("content-type", "text/plain; version=0.0.4");
    res.end(`${body}\n`);
  });

  server.listen(METRICS_PORT, "0.0.0.0", () => {
    console.log(`[METRICS] listening on http://0.0.0.0:${METRICS_PORT}/metrics`);
  });
}

function toHex32(bytes: Buffer): string {
  if (bytes.length !== 32) throw new Error(`expected 32 bytes, got ${bytes.length}`);
  return `0x${bytes.toString("hex")}`;
}

function randomH256(): string {
  return toHex32(crypto.randomBytes(32));
}

function sha256H256(s: string): string {
  return toHex32(crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest());
}

function sha256Bytes32(s: string): Uint8Array {
  const d = crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest();
  // Ensure stable length for `[u8;32]` SCALE encoding.
  if (d.length !== 32) throw new Error(`sha256 expected 32 bytes, got ${d.length}`);
  return new Uint8Array(d);
}

async function submitAiProof(quote: string): Promise<{ txHash: string; taskId: string; aiHash: string }> {
  const api = await getApi();
  const kr = getKeyring();

  const signer = kr.addFromUri(WORKER_SEED);

  const taskId = randomH256();
  const aiHashBytes = quote ? sha256Bytes32(quote) : new Uint8Array(crypto.randomBytes(32));
  const inputHashBytes = quote ? sha256Bytes32(`input::${quote}`) : new Uint8Array(crypto.randomBytes(32));
  const aiHash = toHex32(Buffer.from(aiHashBytes));

  // `worker_sig` is `BoundedVec<u8, 512>` in the pallet; pass raw bytes (not a hex string).
  const workerSigBytes = crypto.randomBytes(96);
  const now = Date.now();
  const workerPubkey = Array.from(signer.publicKey); // `[u8;32]`

  // Radar confirmed the exposed pallet name is `tetCompute`,
  // and the method name is `submitInferenceProof`.
  const tx = (api.tx as any).tetCompute.submitInferenceProof(
    taskId,
    Array.from(Buffer.from(OLLAMA_MODEL, "utf8")),
    Array.from(inputHashBytes),
    Array.from(aiHashBytes),
    now,
    now,
    workerPubkey,
    Array.from(workerSigBytes),
    WORKER_CAPABILITY_HINT,
  );

  return await new Promise((resolve, reject) => {
    let unsub: null | (() => void) = null;
    tx.signAndSend(signer, (result: { status: { isInBlock: boolean; asInBlock: { toHex: () => string } }; isError: boolean }) => {
      if (result.status.isInBlock) {
        const h = result.status.asInBlock.toHex();
        if (unsub) unsub();
        resolve({ txHash: h, taskId, aiHash });
        return;
      }
      if (result.isError) {
        if (unsub) unsub();
        reject(new Error("transaction error"));
      }
    })
      .then((u: () => void) => {
        unsub = u;
      })
      .catch((e: unknown) => {
        if (unsub) unsub();
        reject(e);
      });
  });
}

async function main() {
  if (!WORKER_SEED) {
    throw new Error("TET_WORKER_SEED is required. Refusing to boot with dev keys.");
  }

  startMetricsServer();
  banner("TET WORKER BOOT");
  console.log(`WS: ${WS_ENDPOINT}`);
  console.log(`Ollama: ${OLLAMA_GENERATE}`);
  console.log(`Model: ${OLLAMA_MODEL}`);
  console.log(`Loop: ${LOOP_MS}ms`);

  // Ensure sr25519/ed25519 crypto is ready for keyring.
  await cryptoWaitReady();

  // Warm-up connection (but do not crash if it fails).
  try {
    await getApi();
    console.log("[CHAIN] Connected");
  } catch (e) {
    console.error("[CHAIN] Connect failed (will retry in loop):", e);
  }

  for (;;) {
    const loopStart = Date.now();
    metrics.loopCount += 1;
    banner("AI PHASE");
    let quote = "";
    try {
      quote = await ollamaQuote();
      console.log(`[AI] "${quote}"`);
    } catch (e: unknown) {
      metrics.ollamaFail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[AI] Failed:", msg);
    }

    banner("WORK / CHAIN PHASE");
    try {
      const proofStart = Date.now();
      const { txHash, taskId, aiHash } = await submitAiProof(quote);
      metrics.lastProofSubmissionLatencyMs = Date.now() - proofStart;
      metrics.txSuccess += 1;
      metrics.lastTxInBlockHash = txHash;
      console.log(`[NEON] task_id=${taskId}`);
      console.log(`[NEON] ai_hash=${aiHash}`);
      console.log(`[NEON] quote="${quote || "(no quote)"}"`);
      console.log(`[TX] tetCompute.submitInferenceProof(proof) | inBlock=${txHash}`);
    } catch (e: unknown) {
      metrics.txFail += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.error("[TX] Failed:", msg);
    }

    if (RUN_ONCE) {
      console.log("[WORKER] RUN_ONCE enabled; exiting after first proof attempt.");
      return;
    }

    metrics.lastLoopMs = Date.now() - loopStart;
    console.log(`[SLEEP] ${LOOP_MS}ms`);
    await sleep(LOOP_MS);
  }
}

main().catch((e) => {
  console.error("[FATAL]", e);
  process.exitCode = 1;
});

