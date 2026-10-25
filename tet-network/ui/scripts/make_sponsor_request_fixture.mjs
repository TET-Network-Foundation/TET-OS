// Writes tet-core/src/testdata/demo_sponsor_request_v1.json: a file-fee sponsorship request signed
// by the try page's own code (`app/lib/files_fee.ts`), which tet-core must accept
// (`ui_signed_sponsor_request_verifies_in_rust`): the pre-image byte for byte, then both signatures.
//
//   node --experimental-strip-types scripts/make_sponsor_request_fixture.mjs
//
// Deterministic: a BIP39 test-vector wallet, a fixed file id and time, and ML-DSA signing randomness
// derived from the message, so re-running it reproduces the committed file.

import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

register("./lib/ts_hooks.mjs", import.meta.url);

const envelopes = JSON.parse(readFileSync(new URL("../../../tet-core/src/testdata/agent_payload_envelopes.json", import.meta.url), "utf8"));
process.env.NEXT_PUBLIC_TET_CHAIN_ID = envelopes.chain.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = envelopes.chain.genesis_hash;

const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { buildSponsorFeeRequestV1, sponsorRequestAuthMessageBytes } = await import("../app/lib/files_fee.ts");

const WORDS = "legal winner thank year wave sausage worth useful legal winner thank yellow";
await activateTryWallet(WORDS);
const request = await buildSponsorFeeRequestV1({
  fileId: "6f1c2e8a-4b7d-4c3e-9a1f-2d5e8b7c0a91",
  requestedAtMs: 1_790_000_000_000,
});
const preimage = new TextDecoder().decode(
  sponsorRequestAuthMessageBytes({
    chainId: envelopes.chain.chain_id,
    genesisHash: envelopes.chain.genesis_hash,
    fileId: request.file_id,
    senderWalletId: request.sender_wallet_id,
    requestedAtMs: request.requested_at_ms,
    mldsaPubkeyB64: request.hybrid_sig.mldsa_pubkey_b64,
  }),
);

const doc = {
  _what: "A demo file-fee sponsorship request signed by the try page (tet-network/ui/app/lib/files_fee.ts).",
  _produced_by: "tet-network/ui/scripts/make_sponsor_request_fixture.mjs",
  _why: "tet-core rebuilds the pre-image from the fields and must get these bytes, then verify both signatures.",
  _mnemonics: "Standard BIP39 test vector, public by design. No real funds.",
  chain: envelopes.chain,
  preimage_utf8: preimage,
  request,
};
const out = new URL("../../../tet-core/src/testdata/demo_sponsor_request_v1.json", import.meta.url);
writeFileSync(out, JSON.stringify(doc, null, 2) + "\n");
console.log(`wrote ${out.pathname}`);
