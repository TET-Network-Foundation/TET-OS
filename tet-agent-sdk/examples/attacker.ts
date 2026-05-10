import { AgentClient, loadHybridWalletFromMnemonic, mldsa44SignDeterministic } from "../dist/index.js";
import "dotenv/config";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

/** Matches tet-core `ledger::STEVEMON` (6 decimals). */
const STEVEMON = 1_000_000;
/** Minimum worker bond: 1000 TET (Stevemon micro). */
const MIN_WORKER_BOND_MICRO = 1000 * STEVEMON;
/** Minimum spendable balance before stake + CAAC attack flow (2000 TET). */
const MIN_ATTACK_LIQUID_MICRO = 2000 * STEVEMON;

function challengeRoundsFromSeed(seed32: Buffer): bigint {
  const base = seed32.readBigUInt64LE(0);
  return 10_000n + (base % 50_000n);
}

/** Byte-for-byte aligned with `vision::caac::compute_challenge_digest`. */
function computeChallengeDigest(seedHex: string): string {
  const raw = Buffer.from(seedHex.trim(), "hex");
  if (raw.length !== 32) {
    throw new Error("seed must be 32 bytes (64 hex chars)");
  }
  const rounds = challengeRoundsFromSeed(raw);
  let state = Buffer.from(raw);
  for (let i = 0n; i < rounds; i++) {
    state = createHash("sha256").update(state).digest();
  }
  return state.toString("hex");
}

function workerBondStakeMessageBytes(
  walletIdHex64: string,
  amountMicro: bigint,
  nonce: bigint,
  mldsaPubkeyB64: string,
): Uint8Array {
  const w = walletIdHex64.trim().toLowerCase();
  const p = mldsaPubkeyB64.trim();
  const line = `tet worker bond stake v1|${w}|${amountMicro.toString()}|${nonce.toString()}|${p}`;
  return new TextEncoder().encode(line);
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ ok: boolean; status: number; text: string; json?: unknown }> {
  const r = await fetch(url, init);
  const text = await r.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { ok: r.ok, status: r.status, text, json };
}

async function getLedgerBalanceMicro(baseUrl: string, walletId: string): Promise<number> {
  const u = new URL("/ledger/me", baseUrl);
  u.searchParams.set("wallet_id", walletId);
  const r = await fetchJson(u.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok || !r.json || typeof r.json !== "object") {
    throw new Error(`GET /ledger/me failed HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  }
  const m = (r.json as { balance_micro_tet?: number }).balance_micro_tet;
  if (typeof m !== "number" || !Number.isFinite(m) || m < 0) {
    throw new Error("GET /ledger/me missing balance_micro_tet");
  }
  return Math.floor(m);
}

async function getTotalBurnedMicro(baseUrl: string): Promise<number> {
  // `GET /network/stats` includes `total_burned_micro` (u64 in Stevemon micro).
  const u = new URL("/network/stats", baseUrl);
  const r = await fetchJson(u.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok || !r.json || typeof r.json !== "object") {
    throw new Error(`GET /network/stats failed HTTP ${r.status}: ${r.text.slice(0, 200)}`);
  }
  const m = (r.json as { total_burned_micro?: number }).total_burned_micro;
  if (typeof m !== "number" || !Number.isFinite(m) || m < 0) {
    throw new Error("GET /network/stats missing total_burned_micro");
  }
  return Math.floor(m);
}

async function ensureDevAttackFunding(walletId: string, baseUrl: string, apiKey: string): Promise<void> {
  const bal0Micro = await getLedgerBalanceMicro(baseUrl, walletId);
  if (bal0Micro >= MIN_ATTACK_LIQUID_MICRO) {
    return;
  }

  if (!apiKey.trim()) {
    throw new Error("TET_ADMIN_API_KEY is required to call POST /ledger/faucet in local testnet.");
  }
  const faucetUrl = new URL("/ledger/faucet", baseUrl).toString();
  const faucetRes = await fetchJson(faucetUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({ wallet_id: walletId, amount_tet: 2000 }),
  });
  if (!faucetRes.ok) {
    throw new Error(`POST /ledger/faucet failed HTTP ${faucetRes.status}: ${faucetRes.text.slice(0, 400)}`);
  }

  const bal1Micro = await getLedgerBalanceMicro(baseUrl, walletId);
  if (bal1Micro < MIN_ATTACK_LIQUID_MICRO) {
    throw new Error(`funding incomplete: balance_micro_tet=${bal1Micro} < ${MIN_ATTACK_LIQUID_MICRO}`);
  }
}

async function ensureWorkerBondLocked(
  baseUrl: string,
  walletId: string,
  keys: Awaited<ReturnType<typeof loadHybridWalletFromMnemonic>>,
): Promise<void> {
  if (process.env.TET_ATTACK_SKIP_BOND === "1") {
    console.log("[bond] TET_ATTACK_SKIP_BOND=1 — assuming worker bond already locked on ledger.");
    return;
  }

  const nonceUrl = new URL(`/wallet/nonce/${walletId}`, baseUrl).toString();
  const nRes = await fetchJson(nonceUrl);
  if (!nRes.ok || !nRes.json || typeof nRes.json !== "object") {
    throw new Error(`wallet/nonce failed HTTP ${nRes.status}: ${nRes.text.slice(0, 200)}`);
  }
  const nextNonce = (nRes.json as { next_nonce?: number }).next_nonce;
  if (typeof nextNonce !== "number" || !Number.isFinite(nextNonce) || nextNonce <= 0) {
    throw new Error("wallet/nonce: missing next_nonce");
  }
  const nonce = BigInt(nextNonce);

  const amountMicro = BigInt(MIN_WORKER_BOND_MICRO);
  const msg = workerBondStakeMessageBytes(walletId, amountMicro, nonce, keys.mldsa44PubkeyB64);
  const edSigU8 = keys.signEd25519(msg);
  const ed25519_sig_hex = Buffer.from(edSigU8).toString("hex");
  const mldsa_sig_b64 = await mldsa44SignDeterministic(keys.mldsa44KeypairB64, msg);

  const stakeUrl = new URL("/ledger/stake", baseUrl).toString();
  const body = {
    wallet_id: walletId,
    amount_tet: 1000,
    nonce: Number(nonce),
    ed25519_sig_hex,
    mldsa_pubkey_b64: keys.mldsa44PubkeyB64,
    mldsa_sig_b64,
  };
  const sRes = await fetchJson(stakeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!sRes.ok) {
    throw new Error(
      `POST /ledger/stake failed HTTP ${sRes.status}: ${sRes.text.slice(0, 400)}\n` +
        "Hint: fund this wallet (e.g. dev faucet / airdrop) and set tet-core TET_MLDSA_SECURITY_LEVEL=44 to match ML-DSA-44 from this SDK.",
    );
  }
  console.log("[bond] locked worker bond via POST /ledger/stake (1000 TET).");
}

async function main(): Promise<void> {
  const agent = await AgentClient.fromEnv();
  const baseUrl = agent.baseUrl.replace(/\/+$/, "");
  const mnemonic = (process.env.TET_MNEMONIC ?? process.env.TET_MNEMONIC_12 ?? "").trim();
  if (!mnemonic) {
    throw new Error("TET_MNEMONIC (or TET_MNEMONIC_12) is required");
  }
  const keys = await loadHybridWalletFromMnemonic(mnemonic);
  const walletId = keys.walletIdHex64.trim().toLowerCase();

  const adminKey = (process.env.TET_ADMIN_API_KEY ?? "").trim();
  await ensureDevAttackFunding(walletId, baseUrl, adminKey);
  const balBeforeStake = await getLedgerBalanceMicro(baseUrl, walletId);
  const burnedBefore = await getTotalBurnedMicro(baseUrl);

  await ensureWorkerBondLocked(baseUrl, walletId, keys);

  const chUrl = new URL("/v1/vision/caac/challenge", baseUrl).toString();
  const chRes = await fetchJson(chUrl);
  if (!chRes.ok || !chRes.json || typeof chRes.json !== "object") {
    throw new Error(`GET caac/challenge failed HTTP ${chRes.status}: ${chRes.text.slice(0, 200)}`);
  }
  const seed_hex = String((chRes.json as { seed_hex?: string }).seed_hex ?? "").trim();
  if (!/^[0-9a-fA-F]{64}$/.test(seed_hex)) {
    throw new Error("caac/challenge: invalid seed_hex");
  }

  const t0 = performance.now();
  const digest_hex = computeChallengeDigest(seed_hex);
  const client_latency_ms = Math.max(0, Math.round(performance.now() - t0));

  const completeUrl = new URL("/v1/vision/caac/complete", baseUrl).toString();
  const completeRes = await fetchJson(completeUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      wallet: walletId,
      seed_hex,
      digest_hex,
      client_latency_ms,
    }),
  });
  if (!completeRes.ok) {
    throw new Error(`POST caac/complete failed HTTP ${completeRes.status}: ${completeRes.text.slice(0, 400)}`);
  }

  console.log(
    "[1/2] 善良なAIを装い、CAACを通過して1000 TETの担保をロックした...",
  );

  const verifyUrl = new URL("/v1/vision/zk-court/verify-optimistic", baseUrl).toString();
  const verifyBody = {
    worker_id: walletId,
    commitment_b64: Buffer.from("attacker-dummy-commitment", "utf8").toString("base64"),
    proof_b64: Buffer.from("INVALID", "utf8").toString("base64"),
    proof: "INVALID",
  };
  const vRes = await fetchJson(verifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${(process.env.TET_ADMIN_API_KEY ?? "").trim()}`,
    },
    body: JSON.stringify(verifyBody),
  });
  console.log(`[zk-court] HTTP ${vRes.status} ${vRes.text}`);
  console.log("[2/2] 嘘の証明を送信し、ZK-Courtによる処刑（スラッシング）を誘発した！");

  const balAfter = await getLedgerBalanceMicro(baseUrl, walletId);
  const burnedAfter = await getTotalBurnedMicro(baseUrl);
  console.log(`[audit] balance_micro_tet before=${balBeforeStake} after=${balAfter}`);
  console.log(`[audit] total_burned_micro before=${burnedBefore} after=${burnedAfter}`);
}

export async function runAttackForTest(opts: {
  baseUrl: string;
  mnemonic: string;
  adminApiKey: string;
}): Promise<{ walletId: string; balance_before_stake: number; balance_after_slash: number; burned_before: number; burned_after: number }> {
  const keys = await loadHybridWalletFromMnemonic(opts.mnemonic);
  const walletId = keys.walletIdHex64.trim().toLowerCase();
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  await ensureDevAttackFunding(walletId, baseUrl, opts.adminApiKey);
  const balBeforeStake = await getLedgerBalanceMicro(baseUrl, walletId);
  const burnedBefore = await getTotalBurnedMicro(baseUrl);
  await ensureWorkerBondLocked(baseUrl, walletId, keys);
  const chRes = await fetchJson(new URL("/v1/vision/caac/challenge", baseUrl).toString());
  if (!chRes.ok || !chRes.json || typeof chRes.json !== "object") {
    throw new Error(`GET caac/challenge failed HTTP ${chRes.status}: ${chRes.text.slice(0, 200)}`);
  }
  const seed_hex = String((chRes.json as { seed_hex?: string }).seed_hex ?? "").trim();
  const t0 = performance.now();
  const digest_hex = computeChallengeDigest(seed_hex);
  const client_latency_ms = Math.max(0, Math.round(performance.now() - t0));
  const completeRes = await fetchJson(new URL("/v1/vision/caac/complete", baseUrl).toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ wallet: walletId, seed_hex, digest_hex, client_latency_ms }),
  });
  if (!completeRes.ok) throw new Error(`POST caac/complete failed HTTP ${completeRes.status}: ${completeRes.text.slice(0, 400)}`);
  const verifyRes = await fetchJson(new URL("/v1/vision/zk-court/verify-optimistic", baseUrl).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${opts.adminApiKey.trim()}`,
    },
    body: JSON.stringify({
      worker_id: walletId,
      commitment_b64: Buffer.from("attacker-dummy-commitment", "utf8").toString("base64"),
      proof_b64: Buffer.from("INVALID", "utf8").toString("base64"),
    }),
  });
  if (!verifyRes.ok) throw new Error(`POST zk-court/verify-optimistic failed HTTP ${verifyRes.status}: ${verifyRes.text.slice(0, 400)}`);
  const balAfter = await getLedgerBalanceMicro(baseUrl, walletId);
  const burnedAfter = await getTotalBurnedMicro(baseUrl);
  return { walletId, balance_before_stake: balBeforeStake, balance_after_slash: balAfter, burned_before: burnedBefore, burned_after: burnedAfter };
}

// Run only when invoked as a script (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[attack] fatal: ${msg}`);
    process.exit(1);
  });
}
