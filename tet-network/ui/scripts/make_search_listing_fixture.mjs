// Writes tet-core/src/testdata/ui_search_listing_v1.json: a TetSearch listing signed by the page's
// own code (tetsearch.ts listingAuthMessageBytes), by a member key and a site key. tet-core must
// accept both signatures byte for byte (`ui_signed_search_listing_verifies_in_rust`).
//
//   node --experimental-strip-types scripts/make_search_listing_fixture.mjs
import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
register("./lib/ts_hooks.mjs", import.meta.url);
const testdata = new URL("../../../tet-core/src/testdata/", import.meta.url);
const qDoc = JSON.parse(readFileSync(new URL("agent_question_envelope_v1.json", testdata), "utf8"));
process.env.NEXT_PUBLIC_TET_CHAIN_ID = qDoc.chain.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = qDoc.chain.genesis_hash;
const { listingAuthMessageBytes, LISTING_KIND } = await import("../app/lib/tetsearch.ts");
const { mnemonicToTetEd25519Keypair, signTetEd25519 } = await import("../app/lib/ed25519_tet.ts");
const { mldsa44KeypairFromMnemonic, mldsa44SignDeterministic, pqcInit } = await import("../app/lib/pqc.ts");
const { u8ToStdBase64 } = await import("../app/lib/ai_infer_hybrid.ts");
await pqcInit();
const chain = { chainId: qDoc.chain.chain_id, genesisHash: qDoc.chain.genesis_hash };
const MEMBER = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
const SITE = "zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong";
const keys = async (w) => ({ ed: mnemonicToTetEd25519Keypair(w), pq: await mldsa44KeypairFromMnemonic(w) });
const m = await keys(MEMBER);
const s = await keys(SITE);
const base = { site_wallet_id: s.ed.walletIdHex.toLowerCase(), member_wallet_id: m.ed.walletIdHex.toLowerCase(), listed_at_ms: 1_760_000_000_000 };
const sign = async (k) => {
  const msg = listingAuthMessageBytes(chain, base, k.pq.pubkey_b64);
  return { ed25519_pubkey_hex: k.ed.walletIdHex.toLowerCase(), ed25519_sig_b64: u8ToStdBase64(await signTetEd25519(k.ed.secretKey, msg)), mldsa_pubkey_b64: k.pq.pubkey_b64, mldsa_sig_b64: await mldsa44SignDeterministic(k.pq.keypair_b64, msg) };
};
const listing = { v: 1, kind: LISTING_KIND, ...base, member_sig: await sign(m), site_sig: await sign(s) };
writeFileSync(new URL("ui_search_listing_v1.json", testdata), JSON.stringify({ _what: "A TetSearch listing signed by the try page's code (member key and site key).", _produced_by: "tet-network/ui/scripts/make_search_listing_fixture.mjs", chain: qDoc.chain, listing }, null, 2) + "\n");
console.log("wrote ui_search_listing_v1.json");
process.exit(0);
