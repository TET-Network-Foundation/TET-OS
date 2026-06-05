# Phase 0 — File Sharing (TET Sovereign OS)

Status: **Step 1 (backend foundation)** — types, storage, REST, gossip announce.
Author: TET Core. Companion to `docs/SOVEREIGN_OS_PHASE0_SPEC.md` (§A.1 Tmail).

> Step roadmap: **Step 1** backend Rust foundation (this doc) · Step 2 UI ·
> Step 3 Rust↔TS interop test · Step 4 final integration (libp2p body req/resp + fee settlement).

---

## 1. Overview

File Sharing lets one wallet send an **end-to-end encrypted** file to another wallet over the
TET network, reusing the exact cryptographic stack already shipped and verified for Tmail Basic
E2EE (Step 3+4):

- **KEM / E2EE:** X25519 (DH) + ML-KEM-768 (Kyber768) → HKDF-SHA256 → ChaCha20-Poly1305 (AEAD).
- **Authentication:** hybrid signature Ed25519 + ML-DSA-44 over a canonical preimage.

Like Tmail, file content is **never written to the ledger**. The signed *envelope* (metadata only)
travels over libp2p gossip; the encrypted *body* lives in a node-local TTL store and is pulled on
demand. The node is a blind relay — it never sees plaintext filename, MIME type, or bytes.

Phase 0 scope is intentionally narrow: **≤ 5 MB**, **1 sender → 1 receiver**, single storage node.

---

## 2. Architecture

```
 sender (UI)                         storage node                      receiver (UI)
 -----------                         ------------                      -------------
 1. encrypt body+name+mime  ──upload──▶ files:<id>:blob (sled, 30d TTL)
    build + sign envelope               files:<id>:meta
                            ──announce─▶ gossip /tet/v1/files/announce ───────▶ peers buffer meta
                                        files:inbox:<receiver>:<id>            into their own store
                                                                       2. GET /files/inbox/<wallet>
                                                                       3. GET /files/fetch/<id> (blob)
                                                                       4. decrypt locally
```

Two planes, mirroring Tmail:

- **Announce plane (gossip):** `gossipsub` topic `/tet/v1/files/announce` carries the *envelope only*
  (small JSON). Every node verifies the hybrid signature on receipt and buffers the envelope +
  inbox index in its node-local store. Off-ledger; never re-broadcast on receipt.
- **Body plane (transfer):** the encrypted blob (≤ 5 MB).
  - **Phase 0 transport = REST** `GET /files/fetch/:file_id` (octet-stream). Trivially handles 5 MB.
  - **Reserved for Step 4 = libp2p request/response** protocol `/tet/v1/files/fetch`. The protocol
    id and message types are defined now (foundation), but wiring into the live block-plane swarm
    is deferred — see §9.

---

## 3. File Envelope (signed by sender)

`FileEnvelopeV1` (`tet-core/src/files/mod.rs`). JSON-friendly: all binary fields are base64; the
body digest is lowercase hex (same conventions as `TmailEnvelopeV1`).

| field                     | type            | notes |
|---------------------------|-----------------|-------|
| `v`                       | u32             | `1` |
| `kind`                    | string          | `"file_envelope_v1"` |
| `file_id`                 | UUID (string)   | v4, sender-generated |
| `sender_wallet_id`        | string (64 hex) | = Ed25519 pubkey hex |
| `receiver_wallet_id`      | string (64 hex) | |
| `file_size`              | u64             | encrypted blob length in bytes, `1..=5 MiB` |
| `file_sha256`            | string (64 hex) | SHA-256 of the **encrypted** blob (integrity) |
| `filename_encrypted_b64`  | string          | AEAD ciphertext of the UTF-8 filename |
| `mime_type_encrypted_b64` | string          | AEAD ciphertext of the MIME type |
| `storage_node`           | string          | libp2p PeerId (base58btc) holding the blob |
| `fee_micro`              | u64             | default `1000` µTET |
| `created_at_ms`          | u64             | unix epoch ms |
| `ttl_ms`                 | u64             | default 30 days (clamped) |
| `e2ee`                    | `FileE2eeBlock` | KEM material + per-field nonces |
| `hybrid_sig`              | `HybridSig`     | Ed25519 + ML-DSA-44 |

`FileE2eeBlock`: `{ v, scheme:"tet-file-hybrid-v1", client_ephemeral_pub_b64,
receiver_x25519_pub_b64, receiver_mlkem_pub_b64, mlkem_ciphertext_b64,
filename_nonce_b64, mime_nonce_b64, body_nonce_b64 }`.

A single hybrid KEM encapsulation yields one 32-byte key (HKDF info `"tet-file-v1"`); filename,
MIME, and body are encrypted under that key with **distinct** nonces.

### 3.1 Signature preimage (canonical, exact)

```
tet file envelope v1|chain_id={chain_id}|genesis_hash={genesis_hash}|file_id={file_id}
|sender={sender}|receiver={receiver}|size={file_size}|sha256={file_sha256}
|filename={filename_encrypted_b64}|mime={mime_type_encrypted_b64}
|storage_node={storage_node}|fee_micro={fee_micro}|created_at_ms={created_at_ms}|mldsa_pk={mldsa_pk}
```

(Single line, `|`-separated, no spaces around `|`.) `sender`/`receiver` are lowercased; `chain_id`
and `genesis_hash` come from `crate::genesis` and bind the message to this network — identical
discipline to `tmail_envelope_auth_message_bytes`. The KEM ephemeral material is **not** signed
(tampering only breaks decryption); the body is bound via `sha256` and `size`.

### 3.2 Verification (consensus-grade)

`verify_file_envelope_v1` checks, in order: version, kind, `file_size ∈ 1..=MAX`, `file_sha256`
well-formed (64 hex), `sender`/`receiver` well-formed (64 hex), signer `ed25519_pubkey_hex ==
sender`, then the hybrid signature over §3.1 via `crate::quantum_shield::verify_hybrid`.

---

## 4. Body storage (sled, 30-day TTL)

`FileStore` (`tet-core/src/files/storage.rs`) opens trees on the **ledger's** sled `Db` (so deleting
`TET_DB_DIR` clears them):

- `files_blob_v1` — key `file_id`, value = encrypted blob bytes.
- `files_meta_v1` — key `file_id`, value = `FileEnvelopeV1` JSON.
- `files_inbox_v1` — key `receiver(64 hex) ‖ created_at_ms(BE u64) ‖ file_id`, value = `file_id`.
  Fixed 64-byte receiver prefix → `scan_prefix`; BE timestamp → reverse-iterate newest-first.

TTL: `created_at_ms + min(ttl_ms or default, MAX)` where default = 30 d, MAX = 30 d. A background
reaper (`FileStore::prune_expired`, spawned in `main.rs`, interval `TET_FILES_PRUNE_INTERVAL_SEC`,
default 300 s) deletes expired blob + meta + inbox entries. Capacity guard
(`TET_FILES_MAX_ENTRIES`, default 10_000) prunes-then-rejects when full.

Tunables: `TET_FILES_DEFAULT_TTL_MS`, `TET_FILES_MAX_TTL_MS`, `TET_FILES_MAX_ENTRIES`,
`TET_FILES_PRUNE_INTERVAL_SEC`, `TET_FILES_MAX_BODY_BYTES` (default 5 MiB).

---

## 5. REST API

All sender-authenticated actions use hybrid signatures (no admin token), mirroring Tmail.

| method + path                | body                                  | success | notes |
|------------------------------|---------------------------------------|---------|-------|
| `POST /files/upload`         | multipart: `envelope` (JSON) + `body` | `202 {file_id, storage_node}` | verify env → check `sha256(body)==file_sha256` & `size` → store blob+meta+inbox → gossip announce |
| `POST /files/announce`       | `FileEnvelopeV1` JSON                 | `202 {file_id}` | verify → store meta+inbox → gossip (no blob) |
| `GET /files/inbox/:wallet`   | —                                     | `200 {count, files:[envelope…]}` | non-expired, newest-first, server-filtered to wallet |
| `GET /files/fetch/:file_id`  | —                                     | `200 octet-stream` | encrypted blob bytes, or `404` |
| `DELETE /files/item/:file_id`| `FileDeleteRequestV1` JSON            | `200 {ok}` | sender-only; hybrid-signed delete preimage |

> Path note: delete uses `/files/item/:file_id` (not `/files/:file_id`) so the `:file_id` param does
> not collide with the static `upload`/`announce` routes under `/files/` — the axum/matchit
> static-vs-param sibling limitation (same constraint Tmail hit with `/tmail/keys/:wallet_id`).

`/files/upload` carries a `DefaultBodyLimit` of 8 MiB (5 MiB body + overhead). `DELETE` preimage:
`tet file delete v1|chain_id=..|genesis_hash=..|file_id=..|sender=..|created_at_ms=..|mldsa_pk=..`,
signer must equal the stored envelope's `sender_wallet_id`.

---

## 6. libp2p protocol

- **Gossip (wired):** topic `/tet/v1/files/announce`, payload `NetworkEvent::FileAnnounce { envelope }`.
  Subscribed alongside blocks/txs/tmail; peer-scored identically. On receipt: verify → store
  meta+inbox. Never re-broadcast.
- **Request/response (defined, Step-4 wiring):** protocol `/tet/v1/files/fetch`,
  `FileFetchRequest { file_id }` → `FileFetchResponse { found, file_id, blob_b64, file_sha256 }`,
  max body `MAX_FILE_BODY_BYTES = 5 MiB`. See §9 for why wiring is deferred.

---

## 7. Economic model

Per-file fee: **`FILE_FEE_MICRO = 1000` µTET**, bound into the envelope signature (so it cannot be
altered in flight). Split **25 : 50 : 25**:

| share | recipient            | rationale |
|-------|----------------------|-----------|
| 25 %  | protocol treasury    | network upkeep |
| 50 %  | storage node         | pays for hosting bytes for the TTL window |
| 25 %  | burned               | deflationary sink |

Phase 0: the fee is **declared and signed** but settlement (debit/credit/burn on the ledger) is
**deferred to Step 4** so this step does not touch treasury/consensus core. Constants
(`FILE_FEE_MICRO`, `FEE_SPLIT_TREASURY_BPS`, `FEE_SPLIT_STORAGE_BPS`, `FEE_SPLIT_BURN_BPS`) live in
`files/mod.rs` for the Step-4 wiring.

---

## 8. Phase 0 limitations

- Max file size **5 MiB** (`MAX_FILE_BODY_BYTES`).
- **1:1 only** — single receiver per envelope; no groups/broadcast.
- Single `storage_node` per file; no replication/erasure coding.
- Body transport over **REST**; libp2p req/resp deferred (§9).
- Fee **declared, not settled** (§7).
- No resumable/chunked upload; whole-file in one request.

---

## 9. Future expansion path

- **Step 4 — libp2p body transfer.** `request_response::json::Behaviour` uses a codec capped near
  1 MiB, too small for 5 MiB blobs. Wiring `/tet/v1/files/fetch` needs a **size-configurable codec**
  (custom `Codec` with `set_response_size_maximum`). Deferred to keep the consensus-critical
  block-plane swarm stable in the foundation step; the protocol id + message types are reserved now.
- **Fee settlement** on the ledger (§7), with storage-node receipts.
- **Chunking + replication** for files > 5 MiB and multi-node durability.
- **Group / multi-receiver** envelopes (per-receiver KEM wrap).
- **Burn-after-read / time-lock** flags, reusing the Tmail flag machinery.
```
