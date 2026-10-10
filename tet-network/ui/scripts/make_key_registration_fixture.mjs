// Writes tet-core/src/testdata/ui_key_registration_v2.json: a messaging-key registration built by
// the page's own code (`tmail_keys.ts` buildTmailKeyRegistrationV1, v2 PAE pre-image). tet-core
// must accept it byte for byte (`ui_signed_key_registration_v2_verifies_in_rust`).
//
//   node --experimental-strip-types scripts/make_key_registration_fixture.mjs

import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

register("./lib/ts_hooks.mjs", import.meta.url);

const testdata = new URL("../../../tet-core/src/testdata/", import.meta.url);
const qDoc = JSON.parse(readFileSync(new URL("agent_question_envelope_v1.json", testdata), "utf8"));
process.env.NEXT_PUBLIC_TET_CHAIN_ID = qDoc.chain.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = qDoc.chain.genesis_hash;

const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { deriveTmailKeysFromMnemonic, buildTmailKeyRegistrationV1 } = await import("../app/lib/tmail_keys.ts");

const WORDS = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
const wallet = await activateTryWallet(WORDS);
const keys = await deriveTmailKeysFromMnemonic(WORDS);
const registration = await buildTmailKeyRegistrationV1({ x25519_pub: keys.x25519_pub, mlkem_pub: keys.mlkem_pub, registeredAtMs: 1_760_000_000_000 });

const doc = {
  _what: "A messaging-key registration (v2, PAE) built by the try page.",
  _produced_by: "tet-network/ui/scripts/make_key_registration_fixture.mjs",
  _why: "tet-core must accept the page's registrations byte for byte; the page verifies the same bytes.",
  _mnemonics: "Standard BIP39 test vectors, public by design. No real funds.",
  chain: qDoc.chain,
  wallet_id: wallet,
  registration,
};
writeFileSync(new URL("ui_key_registration_v2.json", testdata), JSON.stringify(doc, null, 2) + "\n");
console.log("wrote ui_key_registration_v2.json");
