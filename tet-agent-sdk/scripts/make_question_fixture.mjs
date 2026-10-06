// Writes tet-core/src/testdata/agent_question_envelope_v1.json: a question built by the SDK's
// `buildNamedTmailEnvelope` (the code `postQuestion` sends), carrying the UI-signed manifest from
// agent_manifest_v1.json, addressed to a "questions board" whose keys come from a public BIP39 test
// vector. Two checks read it:
//
// - tet-core verifies it as a Tmail envelope (`sdk_question_envelope_verifies_in_rust`);
// - the try page decrypts, classifies it and resolves its owner (`scripts/try_questions_guard.mjs`).
//
//   npm run build && node scripts/make_question_fixture.mjs
//
// The encryption is randomised, so a re-run produces different ciphertext; both checks hold for any run.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadHybridWalletFromMnemonic } from "../dist/wallet_from_mnemonic.js";
import { buildNamedTmailEnvelope, deriveTmailKeys, QUESTION_KIND } from "../dist/questions.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const testdata = join(repoRoot, "tet-core", "src", "testdata");
const manDoc = JSON.parse(readFileSync(join(testdata, "agent_manifest_v1.json"), "utf8"));
const chain = { chainId: manDoc.chain.chain_id, genesisHash: manDoc.chain.genesis_hash };

const BOARD = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
const agent = await loadHybridWalletFromMnemonic(manDoc.agent_mnemonic);
const board = await loadHybridWalletFromMnemonic(BOARD);
const boardKeys = await deriveTmailKeys(BOARD);

const question = "Is this sentence grammatical: 'The data are clear'?";
const envelope = await buildNamedTmailEnvelope({
  wallet: agent,
  chain,
  receiverWalletId: board.walletIdHex64,
  receiverX25519Pub: boardKeys.x25519_pub,
  receiverMlkemPub: boardKeys.mlkem_pub,
  plaintext: JSON.stringify({ v: 1, kind: QUESTION_KIND, question, asked_at_ms: 1_790_000_000_000, manifest: manDoc.manifest }),
  msgId: "3b0e6f0c-7b9a-4a54-9a51-2a1c0f4e8d21",
  sentAtMs: 1_790_000_000_000,
});

const doc = {
  _what: "A question to a questions board, built by tet-agent-sdk (src/questions.ts), with the UI-signed manifest inside.",
  _produced_by: "tet-agent-sdk/scripts/make_question_fixture.mjs",
  _why: "tet-core must accept the SDK's Tmail envelope; the try page must decrypt it and show the manifest's owner.",
  _mnemonics: "Standard BIP39 test vectors, public by design. No real funds.",
  chain: manDoc.chain,
  board_mnemonic: BOARD,
  question,
  envelope,
};
writeFileSync(join(testdata, "agent_question_envelope_v1.json"), JSON.stringify(doc, null, 2) + "\n");
console.log("wrote agent_question_envelope_v1.json");
