// Writes tet-core/src/testdata/ui_grant_claim_v1.json: a welcome-grant claim signed by the page's own
// code (grants.ts grantClaimAuthMessageBytes + the one-time key from tmail.ts). tet-core must accept
// its signature byte for byte (`ui_signed_grant_claim_verifies_in_rust`).
//
//   node --experimental-strip-types scripts/make_grant_claim_fixture.mjs

import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

register("./lib/ts_hooks.mjs", import.meta.url);
const testdata = new URL("../../../tet-core/src/testdata/", import.meta.url);
const qDoc = JSON.parse(readFileSync(new URL("agent_question_envelope_v1.json", testdata), "utf8"));
process.env.NEXT_PUBLIC_TET_CHAIN_ID = qDoc.chain.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = qDoc.chain.genesis_hash;
const { grantClaimAuthMessageBytes, WELCOME_RECEIVER } = await import("../app/lib/grants.ts");
const { ephemeralKeysFromSeed } = await import("../app/lib/tmail.ts");
const { signTetEd25519 } = await import("../app/lib/ed25519_tet.ts");
const { mldsa44SignDeterministic } = await import("../app/lib/pqc.ts");
const { u8ToStdBase64 } = await import("../app/lib/ai_infer_hybrid.ts");
const { tmailEphemeralSeed, fromHex } = await import("../app/lib/anon_tree.mjs");

const eph = await ephemeralKeysFromSeed(tmailEphemeralSeed(new Uint8Array(32).fill(0x42), fromHex(WELCOME_RECEIVER), 0));
const claim = { v: 1, kind: "tet_grant_claim_v1", grant: "welcome", payout_wallet: "ab".repeat(32), receipt_sha256_hex: "cd".repeat(32), journal_b64: "", image_id_hex: "00".repeat(32), claimed_at_ms: 1_760_000_000_000 };
const msg = grantClaimAuthMessageBytes({ chainId: qDoc.chain.chain_id, genesisHash: qDoc.chain.genesis_hash, grant: "welcome", payout: claim.payout_wallet, receiptSha256: claim.receipt_sha256_hex, claimedAtMs: claim.claimed_at_ms, mldsaPubB64: eph.mldsaPubB64 });
claim.hybrid_sig = { ed25519_pubkey_hex: eph.walletId, ed25519_sig_b64: u8ToStdBase64(await signTetEd25519(eph.secretKey, msg)), mldsa_pubkey_b64: eph.mldsaPubB64, mldsa_sig_b64: await mldsa44SignDeterministic(eph.mldsaKeypairB64, msg) };
writeFileSync(new URL("ui_grant_claim_v1.json", testdata), JSON.stringify({ _what: "A welcome-grant claim signed by the try page's code.", _produced_by: "tet-network/ui/scripts/make_grant_claim_fixture.mjs", chain: qDoc.chain, welcome_receiver: WELCOME_RECEIVER, claim }, null, 2) + "\n");
console.log("wrote ui_grant_claim_v1.json");
process.exit(0);
