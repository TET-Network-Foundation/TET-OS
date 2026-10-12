// Sign a welcome-airdrop claim (TxV1::InitialAirdrop) for the wallet whose 12 words are in a file.
// Offline: no network code. Prints ONLY the signed envelope (wallet ID, public keys, signatures)
// on stdout; the words are read from the file and never printed, logged or written anywhere.
//
//   node airdrop_claim_sign.mjs <words file> <chain id> <genesis hash 0x…> <dir with tet_pqc_wasm.js + _bg.wasm>
//
// Same canonical message as tet-network/ui/app/lib/transfer.ts (buildInitialAirdropEnvelope):
//   tet tx v1|chain_id=<id>|genesis_hash=<hash>|mldsa=<pk b64>|tx={"kind":"initial_airdrop","wallet_id":"<id>"}
// Ed25519 key = the first 32 bytes of the BIP39 seed (empty passphrase), as tet-core wallet.rs.
import { createPrivateKey, createPublicKey, pbkdf2Sync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [wordsFile, chainId, genesisHash, wasmDir] = process.argv.slice(2);
if (!wordsFile || !chainId || !/^0x[0-9a-f]{64}$/.test(genesisHash || "") || !wasmDir) {
  console.error("usage: node airdrop_claim_sign.mjs <words file> <chain id> <genesis hash 0x…64 hex> <wasm dir>");
  process.exit(2);
}
const words = readFileSync(wordsFile, "utf8").split(/\s+/).filter(Boolean).join(" ");
if (words.split(" ").length !== 12) {
  console.error("the file must hold exactly 12 words"); // the words themselves are never printed
  process.exit(2);
}

const glue = await import(pathToFileURL(join(wasmDir, "tet_pqc_wasm.js")).href);
glue.initSync({ module: readFileSync(join(wasmDir, "tet_pqc_wasm_bg.wasm")) });
const pq = glue.mldsa44_keypair_from_mnemonic_b64(words); // throws on an invalid mnemonic

const seed = pbkdf2Sync(Buffer.from(words.normalize("NFKD")), Buffer.from("mnemonic"), 2048, 64, "sha512");
const sk = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed.subarray(0, 32)]),
  format: "der",
  type: "pkcs8",
});
const walletId = createPublicKey(sk).export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

const txCanonical = `{"kind":"initial_airdrop","wallet_id":"${walletId}"}`;
const msg = Buffer.from(
  `tet tx v1|chain_id=${chainId}|genesis_hash=${genesisHash}|mldsa=${pq.pubkey_b64.trim()}|tx=${txCanonical}`,
  "utf8",
);
const env = {
  v: 1,
  tx: { kind: "initial_airdrop", wallet_id: walletId },
  sig: {
    ed25519_pubkey_hex: walletId,
    ed25519_sig_b64: sign(null, msg, sk).toString("base64"),
    mldsa_pubkey_b64: pq.pubkey_b64,
    mldsa_sig_b64: glue.mldsa44_sign_deterministic_b64(pq.keypair_b64, msg),
  },
  attestation: { platform: "", report_b64: "" },
};
process.stdout.write(JSON.stringify(env) + "\n");
