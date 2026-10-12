// Sign the file-fee (TxV1::FileFee) that stamps one log seal. Offline: no network code.
// Prints ONLY {wallet, file_id, tx_hash, env} on stdout: public keys and signatures. The words are
// read from the file and never printed, logged or written.
//
//   node stamp_sign.mjs <words file> <chain id> <genesis hash 0x…> <dir with tet_pqc_wasm.js + _bg.wasm> <seal file>
//
// file_id = the first 16 bytes of SHA-256(seal bytes) as a UUID (as a .sig.json stamp).
// Canonical tx and message as tet-network/ui/app/lib/files.ts and the node's verify_envelope_v1:
//   tet tx v1|chain_id=<id>|genesis_hash=<hash>|mldsa=<pk b64>|tx={"kind":"file_fee",…}
// tx_hash = "0x" + SHA-256 of that message (tet-core's tx hash).
import { createHash, createPrivateKey, createPublicKey, pbkdf2Sync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const FILE_FEE_MICRO = 1000;
const [wordsFile, chainId, genesisHash, wasmDir, sealFile] = process.argv.slice(2);
if (!wordsFile || !chainId || !/^0x[0-9a-f]{64}$/.test(genesisHash || "") || !wasmDir || !sealFile) {
  console.error("usage: node stamp_sign.mjs <words file> <chain id> <genesis hash> <wasm dir> <seal file>");
  process.exit(2);
}
const words = readFileSync(wordsFile, "utf8").split(/\s+/).filter(Boolean).join(" ");
if (words.split(" ").length !== 12) {
  console.error("the words file must hold exactly 12 words");
  process.exit(2);
}
const glue = await import(pathToFileURL(join(wasmDir, "tet_pqc_wasm.js")).href);
glue.initSync({ module: readFileSync(join(wasmDir, "tet_pqc_wasm_bg.wasm")) });
const pq = glue.mldsa44_keypair_from_mnemonic_b64(words);
const seed = pbkdf2Sync(Buffer.from(words.normalize("NFKD")), Buffer.from("mnemonic"), 2048, 64, "sha512");
const sk = createPrivateKey({
  key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed.subarray(0, 32)]),
  format: "der",
  type: "pkcs8",
});
const wallet = createPublicKey(sk).export({ format: "der", type: "spki" }).subarray(-32).toString("hex");

const h = createHash("sha256").update(readFileSync(sealFile)).digest("hex").slice(0, 32);
const fileId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
const tx = { kind: "file_fee", from_wallet: wallet, storage_wallet: wallet, file_id: fileId, fee_micro: FILE_FEE_MICRO };
const txCanonical = `{"kind":"file_fee","from_wallet":"${wallet}","storage_wallet":"${wallet}","file_id":"${fileId}","fee_micro":${FILE_FEE_MICRO}}`;
const msg = Buffer.from(`tet tx v1|chain_id=${chainId}|genesis_hash=${genesisHash}|mldsa=${pq.pubkey_b64.trim()}|tx=${txCanonical}`, "utf8");
const env = {
  v: 1,
  tx,
  sig: {
    ed25519_pubkey_hex: wallet,
    ed25519_sig_b64: sign(null, msg, sk).toString("base64"),
    mldsa_pubkey_b64: pq.pubkey_b64,
    mldsa_sig_b64: glue.mldsa44_sign_deterministic_b64(pq.keypair_b64, msg),
  },
  attestation: { platform: "", report_b64: "" },
};
const txHash = "0x" + createHash("sha256").update(msg).digest("hex");
process.stdout.write(JSON.stringify({ wallet, file_id: fileId, tx_hash: txHash, env }) + "\n");
