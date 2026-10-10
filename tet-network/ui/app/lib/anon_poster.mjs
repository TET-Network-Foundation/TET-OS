// Anonymous send — the poster's side, as a state machine with every node request in one place.
//
// The rule this module exists to keep: **nothing the poster sends to its node names the poster.**
// Not the wallet id, not its registry commitment, not its leaf index. The node sees a request for
// the whole registry, a content-addressed receipt, and an envelope signed by a one-day ephemeral
// key. `scripts/anon_poster_guard.mjs` records every request this module makes and checks that.
//
// Everything that needs the browser (WASM signing, Kyber, the prover helper) is injected, so the
// guard runs the real request sequence under plain Node.

import { plainNodeError } from "./node_error.mjs";
import {
  anonCommitment,
  anonRootAndPath,
  fromHex,
  tmailBucketIndex,
  tmailEphemeralSeed,
  toHex,
} from "./anon_tree.mjs";

/** What the UI shows when no native prover is reachable. Never "proving" forever. */
export const ANON_PROVER_MISSING = "anonymous send needs the native prover (see docs)";

/** Thrown by a `prove` implementation that cannot reach a prover at all. */
export class ProverUnavailableError extends Error {
  constructor(detail = "") {
    super(detail ? `${ANON_PROVER_MISSING}: ${detail}` : ANON_PROVER_MISSING);
    this.name = "ProverUnavailableError";
  }
}

/** The prover did not answer within the send's budget. */
export class ProverTimeoutError extends Error {
  /** @param {number} ms */
  constructor(ms) {
    super(`the native prover did not finish within ${ms / 1000} s`);
    this.name = "ProverTimeoutError";
  }
}

/** `ANONYMOUS_SENTINEL` in `tet-core/src/tmail/envelope.rs`. */
export const ANONYMOUS_SENTINEL = "anonymous";

/** Most pages of `/tmail/anon/leaves` fetched before giving up (4096 leaves per page). */
const MAX_LEAF_PAGES = 64;

/**
 * Longest a send waits for the prover before giving up. Proving takes ~33 s on a recent laptop;
 * five minutes covers a slow machine, and past it the user is told rather than left watching.
 */
export const ANON_PROVE_BUDGET_MS = 300_000;

/** Where the native prover listens unless configured otherwise (`cargo run -p tet-prover-host`). */
export const DEFAULT_PROVER_URL = "http://127.0.0.1:9945";

/**
 * A `prove` implementation that calls the native prover daemon on this machine
 * (`POST /prove_anon`). The member secret goes to that local process only.
 *
 * - nothing listening, or a refused connection → {@link ProverUnavailableError}
 * - a daemon built without its guest (HTTP 503) → {@link ProverUnavailableError}
 * - anything else that is not 200 → an ordinary error naming the status
 *
 * @param {{ url?: string, fetchImpl?: typeof fetch, budgetMs?: number }} [opts]
 * @returns {(params: AnonProveParams) => Promise<AnonProof>}
 */
export function makeHelperProver(opts = {}) {
  const url = (opts.url ?? DEFAULT_PROVER_URL).replace(/\/+$/, "");
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const budgetMs = opts.budgetMs ?? ANON_PROVE_BUDGET_MS;
  return async (params) => {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), budgetMs);
    let r;
    try {
      r = await fetchImpl(`${url}/prove_anon`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: ctl.signal,
      });
    } catch (e) {
      if (ctl.signal.aborted) throw new ProverTimeoutError(budgetMs);
      // fetch rejects with a TypeError when nothing answers at all.
      throw new ProverUnavailableError(`no prover at ${url}`);
    } finally {
      clearTimeout(timer);
    }
    const text = await r.text();
    if (r.status === 503) throw new ProverUnavailableError("the prover was built without its guest");
    if (r.status !== 200) throw new Error(`prover HTTP ${r.status}: ${text.slice(0, 200)}`);
    const j = JSON.parse(text);
    for (const k of ["receipt_b64", "journal_b64", "image_id_hex", "receipt_sha256_hex"]) {
      if (typeof j[k] !== "string" || !j[k]) throw new Error(`prover response is missing ${k}`);
    }
    return j;
  };
}

/**
 * Resolve `p`, or reject once `ms` have passed. The budget belongs to the send, not to whichever
 * `prove` was injected: a prover that never answers must still end the send.
 *
 * @template T @param {Promise<T>} p @param {number} ms @returns {Promise<T>}
 */
function withinBudget(p, ms) {
  let timer;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new ProverTimeoutError(ms)),
      ms,
    );
  });
  return Promise.race([p, expired]).finally(() => clearTimeout(timer));
}

/**
 * Which builder a send uses. Anonymous mode must never fall through to the named builder: that
 * signs the message with the user's own wallet, the exact opposite of what they chose.
 *
 * @param {{ anonymous: boolean }} ui
 * @returns {"anonymous" | "named"}
 */
export function sendPathFor(ui) {
  return ui.anonymous ? "anonymous" : "named";
}

/**
 * Download every leaf of one epoch's tree. The requests carry only `epoch` and `offset`.
 *
 * @param {(path: string, init?: object) => Promise<{ status: number, json: any }>} node
 */
export async function fetchAnonLeaves(node) {
  const first = await node("/tmail/anon/leaves");
  if (first.status !== 200 || !first.json?.ok) {
    throw new Error(`registry download failed (HTTP ${first.status})`);
  }
  const epoch = first.json.epoch;
  const leaves = first.json.leaves.map(fromHex);
  let next = first.json.next_offset;
  for (let pages = 1; next != null; pages++) {
    if (pages >= MAX_LEAF_PAGES) throw new Error("registry larger than the client will download");
    const page = await node(`/tmail/anon/leaves?epoch=${epoch}&offset=${next}`);
    if (page.status !== 200 || page.json?.epoch !== epoch) {
      throw new Error(`registry page failed (HTTP ${page.status})`);
    }
    for (const l of page.json.leaves) leaves.push(fromHex(l));
    next = page.json.next_offset;
  }
  if (leaves.length !== first.json.total) throw new Error("registry download incomplete");
  return {
    epoch,
    leaves,
    rootHex: first.json.merkle_root,
    nextEpochAtMs: first.json.next_epoch_at_ms,
  };
}

/**
 * @typedef {{ receipt_b64: string, journal_b64: string, image_id_hex: string, receipt_sha256_hex: string }} AnonProof
 * @typedef {{ secret_hex: string, index: number, siblings_hex: string[], ephemeral_hex: string,
 *             receiver_hex: string, bucket: number }} AnonProveParams
 * @typedef {{ ephemeralSeed: Uint8Array, ephemeralWalletId: string, receiverWalletId: string,
 *             plaintext: string, sentAtMs: number, proof: AnonProof }} AnonEnvelopeArgs
 * @typedef {{ state: "loading_set" } | { state: "not_in_set", nextEpochAtMs: number }
 *         | { state: "proving", startedAtMs: number } | { state: "depositing" } | { state: "sending" }
 *         | { state: "sent", msgId: string } | { state: "failed", reason: string }} AnonPostState
 */

/**
 * Run one anonymous send to a terminal state.
 *
 * @param {{
 *   node: (path: string, init?: { method?: string, body?: string }) => Promise<{ status: number, json: any, text?: string }>,
 *   prove: (params: AnonProveParams) => Promise<AnonProof>,
 *   ephemeralWalletId: (seed: Uint8Array) => Promise<string>,
 *   buildEnvelope: (args: AnonEnvelopeArgs) => Promise<{ msg_id: string }>,
 *   now: () => number,
 *   onState?: (s: AnonPostState) => void,
 *   proveBudgetMs?: number,
 * }} deps
 * @param {{ memberSecret: Uint8Array, receiverWalletId: string, plaintext: string }} input
 * @returns {Promise<AnonPostState>}
 */
export async function runAnonPost(deps, input) {
  /** @template {AnonPostState} S @param {S} s @returns {S} */
  const emit = (s) => {
    deps.onState?.(s);
    return s;
  };
  /** @param {string} reason */
  const fail = (reason) => emit({ state: "failed", reason });
  try {
    const receiver = input.receiverWalletId.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(receiver)) return fail("recipient wallet id must be 64 hex chars");

    emit({ state: "loading_set" });
    const set = await fetchAnonLeaves(deps.node);
    const mine = toHex(anonCommitment(input.memberSecret));
    const index = set.leaves.findIndex((l) => toHex(l) === mine);
    const { root, siblings } = anonRootAndPath(set.leaves, index);
    if (toHex(root) !== String(set.rootHex).toLowerCase()) {
      return fail("the downloaded registry does not reproduce this node's root");
    }
    if (index < 0 || !siblings) {
      return emit({ state: "not_in_set", nextEpochAtMs: set.nextEpochAtMs });
    }

    const sentAtMs = deps.now();
    const bucket = tmailBucketIndex(sentAtMs);
    const ephemeralSeed = tmailEphemeralSeed(input.memberSecret, fromHex(receiver), bucket);
    const ephemeral = (await deps.ephemeralWalletId(ephemeralSeed)).trim().toLowerCase();

    emit({ state: "proving", startedAtMs: sentAtMs });
    let proof;
    try {
      proof = await withinBudget(deps.prove({
        secret_hex: toHex(input.memberSecret),
        index,
        siblings_hex: siblings.map(toHex),
        ephemeral_hex: ephemeral,
        receiver_hex: receiver,
        bucket,
      }), deps.proveBudgetMs ?? ANON_PROVE_BUDGET_MS);
    } catch (e) {
      if (e instanceof ProverUnavailableError || e instanceof ProverTimeoutError) return fail(e.message);
      return fail(`prover: ${e instanceof Error ? e.message : String(e)}`);
    }

    emit({ state: "depositing" });
    const put = await deps.node("/tmail/anon/receipt", {
      method: "PUT",
      body: JSON.stringify({
        receipt_sha256_hex: proof.receipt_sha256_hex,
        receipt_b64: proof.receipt_b64,
      }),
    });
    if (put.status !== 200) return fail(`receipt deposit failed (HTTP ${put.status})`);

    emit({ state: "sending" });
    const env = await deps.buildEnvelope({
      ephemeralSeed,
      ephemeralWalletId: ephemeral,
      receiverWalletId: receiver,
      plaintext: input.plaintext,
      sentAtMs,
      proof,
    });
    const sent = await deps.node("/tmail/send", { method: "POST", body: JSON.stringify(env) });
    if (sent.status < 200 || sent.status >= 300) {
      return fail(plainNodeError(sent.text) || `send failed (HTTP ${sent.status})`);
    }
    return emit({ state: "sent", msgId: sent.json?.msg_id ?? env.msg_id });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}
