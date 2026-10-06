// Writes tet-core/src/testdata/ui_answer_envelope_v1.json: a named answer built by the try page's
// own code (`questions.mjs` answerBody + `tmail.ts` buildTmailEnvelopeV1, as the questions window
// sends it), to the agent in agent_question_envelope_v1.json. The agent SDK must read it
// (`tet-agent-sdk/tests/questions.test.ts`), and tet-core must accept it as Tmail
// (`ui_answer_envelope_verifies_in_rust`).
//
//   node --experimental-strip-types scripts/make_answer_fixture.mjs

import { register } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";

register("./lib/ts_hooks.mjs", import.meta.url);

const testdata = new URL("../../../tet-core/src/testdata/", import.meta.url);
const qDoc = JSON.parse(readFileSync(new URL("agent_question_envelope_v1.json", testdata), "utf8"));
const manDoc = JSON.parse(readFileSync(new URL("agent_manifest_v1.json", testdata), "utf8"));
process.env.NEXT_PUBLIC_TET_CHAIN_ID = qDoc.chain.chain_id;
process.env.NEXT_PUBLIC_TET_GENESIS_HASH = qDoc.chain.genesis_hash;

const { activateTryWallet } = await import("../app/lib/try_session.ts");
const { deriveTmailKeysFromMnemonic } = await import("../app/lib/tmail_keys.ts");
const { buildTmailEnvelopeV1 } = await import("../app/lib/tmail.ts");
const { answerBody } = await import("../app/lib/questions.mjs");

const ANSWERER = "letter advice cage absurd amount doctor acoustic avoid letter advice cage above";
const answerer = await activateTryWallet(ANSWERER);
const agentKeys = await deriveTmailKeysFromMnemonic(manDoc.agent_mnemonic);
const answer = "Yes: 'data' as a plural is standard in formal writing.";
const envelope = await buildTmailEnvelopeV1({
  senderWalletId: answerer,
  receiverWalletId: qDoc.envelope.sender_wallet_id,
  plaintextUtf8: answerBody(qDoc.envelope.msg_id, answer),
  receiverX25519Pub: agentKeys.x25519_pub,
  receiverMlkemPub: agentKeys.mlkem_pub,
});

const doc = {
  _what: "A named answer built by the try page, to the agent of agent_question_envelope_v1.json.",
  _produced_by: "tet-network/ui/scripts/make_answer_fixture.mjs",
  _why: "The agent SDK must decrypt and parse the page's answers; tet-core must accept them as Tmail.",
  _mnemonics: "Standard BIP39 test vectors, public by design. No real funds.",
  chain: qDoc.chain,
  answerer_wallet_id: answerer,
  question_msg_id: qDoc.envelope.msg_id,
  answer,
  envelope,
};
writeFileSync(new URL("ui_answer_envelope_v1.json", testdata), JSON.stringify(doc, null, 2) + "\n");
console.log("wrote ui_answer_envelope_v1.json");
