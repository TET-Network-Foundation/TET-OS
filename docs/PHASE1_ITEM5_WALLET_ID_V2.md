# Item 5 design: the wallet id commits to both public keys

Design for QUEUE item 5 as decided on 2026-10-05: **D + A**
(see [`PHASE1_ITEM5_MLDSA_FLOOR.md`](./PHASE1_ITEM5_MLDSA_FLOOR.md)).
- **D:** the wallet id commits to both public keys, and every verifier checks it.
- **A:** ML-DSA is pinned at level 44.

Autonomous: **no**. This document is for the founder's decision; the nightly implements it after.
Written 2026-10-07 against `phase1` at `origin/phase1` and `main` at `235d775`.

## 0. The shape in one paragraph

Today a wallet id **is** the wallet's Ed25519 public key, and the ML-DSA key travels inside each
signature with nothing tying it to the wallet. The ledger even reads `sig.ed25519_pubkey_hex` *as*
the signer's wallet id (the tx index, an AI workload's `processed_by`). The fix makes the id a hash of both keys, and makes every place that today
treats the Ed25519 key as the id **derive** the id from the two keys the signature carries. Binding
then holds by construction: a signature whose ML-DSA key is not the wallet's derives a different
wallet id. That wallet has no balance, no registration and no ownership of anything, so nothing
signed with it can act as the real wallet.

## 1. The derivation

```
wallet_id_v2 = hex( SHA-256( PAE("tet wallet id v2", [ ed25519_pk, mldsa44_pk ]) ) )
```

- **PAE** is the convention already used for agent payloads and the V3 block id
  (`agent::pae`): `domain SP` then, for each field, `<decimal length> SP <bytes> SP`. Every field
  carries its length, so no choice of bytes can move a boundary.
- **Fields are raw bytes,** not hex or base64, so there is one encoding to agree on:
  - `ed25519_pk` is exactly 32 bytes;
  - `mldsa44_pk` is exactly **1312** bytes. **This is where A lives:** the derivation refuses any
    other length, so an ML-DSA-65 or -87 key has no wallet id at all.
- **The output keeps today's format:** 64 lowercase hex. Every storage key, REST path check
  (`is_wallet_id_64hex`), tx field and UI input keeps working unchanged. An old id and a new id
  look alike, which a new genesis accepts (§3).
- **One function per language,** each pinned to a shared golden vector
  (`tet-core/src/testdata/wallet_id_v2_vectors.json`, the BIP39 test vectors):

  | Where | Function |
  |---|---|
  | Rust (`tet-core`, used by `tet-cli`, `tet-signer`, `tet-worker`) | `wallet::wallet_id_v2(ed_pk, mldsa_pk) -> Result<String, WalletIdError>` |
  | Browser wallet (`tet-network/ui/app/lib/`) | `walletIdV2(edPk, mldsaPk)`, used by `ed25519_tet.ts`, `disposable_wallet.mjs`, `try_session.ts`, `pin_vault.ts` |
  | Agent SDK (`tet-agent-sdk/src/`) | `walletIdV2`, used by `wallet_from_mnemonic.ts` |
  | Wallet-client bundle (`tet-core/scripts/wallet_client_entry.mjs`) | the same; the reproducible-bundle hash is re-pinned |

- **The signer's identity is always derived:** `HybridSigV1::signer_wallet_id()` (and the same on
  `TmailHybridSig` and `FileHybridSig`) returns `wallet_id_v2(ed25519_pk, mldsa_pk)`.
  `ed25519_pubkey_hex` is only ever used as a verification key again, never as an id.

## 2. What breaks, and how each is re-derived

The mnemonic is unchanged. Both keys are re-derived from it exactly as today (Ed25519 from BIP39
`seed[0..32]`, ML-DSA-44 from `HKDF(seed, "tet:pqc:mldsa44-seed:v1")`). Only the id string changes.

| What | Why it breaks | Re-derivation step |
|---|---|---|
| **Every wallet id** | it was the Ed25519 key | `wallet_id_v2(ed_pk, mldsa44_pk)` from the same mnemonic |
| **Genesis allocations** | the founder and treasury ids are in the genesis payload and hash | compute both ids with `wallet_id_v2` from the ceremony mnemonics; the genesis hash changes (it is a new genesis anyway). The worker pool and protocol reserve are system constants, not keys: unchanged. **The validator set is unaffected:** producer keys are their own type (D4), already pinned at 44 |
| **Tmail key directory** | keyed by wallet id, registration signed by the wallet | every client re-registers its messaging keys under the new id (the X25519 and Kyber keys themselves are unchanged: they derive from the seed, not the id). The directory is node-local and starts empty on the new chain |
| **Anonymity registry** | registrations carry `wallet_id` and are signed by it | re-register. The commitment is unchanged (the member secret derives from the seed), so membership itself is the same; only the registering id changes. Anonymous envelopes: the ephemeral signer's id becomes `wallet_id_v2` of the ephemeral keys, and the membership proof commits to that 32-byte value. **The RISC Zero guest is unchanged** (it commits whatever 32 bytes it is given), so its image id does not move |
| **Tmail / Files envelopes, inboxes** | sender and receiver ids | clients send under the new id; old inbox rows are on the old chain |
| **Agent manifests** | `owner_wallet_id` is the owner's id, checked against the owner's signature | owners re-sign every manifest. The agent's own keys and keyids are unchanged |
| **Agent payload envelopes** (`.sig.json`) | not affected: they name each key by keyid (`tet-ed25519:`, `tet-mldsa44:`), not by wallet id | none. Fixtures that record an `agent_wallet_id` regenerate it |
| **Devlog pin** (`stevenexus.org/files/tet-verify/pin.json`) | it pins the two agent keys (unchanged) **and** a chain binding (`tet-local-dev` + its genesis hash) | the keys stay. If the dev chain's default founder id moves to a v2 id, the dev genesis hash changes: either re-sign the published entries under the new binding, or keep the old binding as the devlog's historical chain. **Decision for the founder** (§6) |
| **Interop fixtures** | they pin wallet ids and signatures | regenerate: `browser_wallet_hybrid_sigs.json`, `agent_sdk_hybrid_sigs.json`, `agent_payload_envelopes.json` (`agent_wallet_id`), `agent_manifest_v1.json`, `demo_sponsor_request_v1.json`, `agent_question_envelope_v1.json`, `ui_answer_envelope_v1.json`; the eight UI interop step scripts |
| **Stored ids in clients** | the browser's PIN vault stores `wallet_id_hex`; address books store ids | recompute on unlock; address books are re-entered (an old id points at the old chain) |
| **`tet-signer`** | signs at ML-DSA-65 today, which has no v2 id under A | move it to 44 (recommended), or document it as unable to sign as a wallet (§6) |

## 3. Migration at the ceremony

- **Nothing is carried over in place.** It is a new genesis, and Strategy C already resets testnet
  balances, so there is no dual-format period and no id translation table.
- **Users keep their phrase.** The same 12 words open the same keys; the client shows the new id.
  They lose nothing but the old id string.
- **Before the ceremony:**
  1. every client ships the v2 derivation, and the golden vector passes in all four languages;
  2. the founder and treasury ids are computed with v2 from the ceremony mnemonics and written into
     the genesis parameters;
  3. the public docs (`RUNNING_A_NODE.md`, the wallet help text) say the id changes and why.
- **After the ceremony,** an old id is a valid-looking string with no keys behind it on the new
  chain: nothing can sign as it.

## 4. Verification: every site

**The rule at every site:** the identity a signature acts as is `wallet_id_v2` of the two keys it
carries, after both signatures verify and the ML-DSA key is exactly 1312 bytes. Where a message
also *names* a wallet id (a tx's `from_wallet`, a registration's `wallet_id`, a manifest's
`owner_wallet_id`), the named id must equal the derived one. A mismatch is refused with one named
error, `WalletBindingMismatch { claimed, derived }`, so a guard can tell it apart from a bad
signature.

Grouped by function, from the list in the private record (line numbers there):

1. **Consensus transactions: `rest::helpers::verify_envelope_v1`.** One function, the gate for block
   apply (`consensus::tx_hash_for_env`) and for every REST submit path (ledger, wallet, founding,
   files fee, worker, enterprise, ai, b2b, network). It changes in one place:
   - pin the ML-DSA key at 1312 bytes and verify with `verify_mldsa44_b64` (it infers the level
     today);
   - expose the derived signer id.

   **The sender checks move from the Ed25519 key to the derived id:**
   - the REST "signer must equal `from_wallet`" checks (files fee, founding, enterprise, ledger,
     worker);
   - in the ledger, the places that read `sig.ed25519_pubkey_hex` as a wallet:
     - the tx index's `signer_wallet`, in both indexing paths;
     - the AI workload's `processed_by`, written in block apply;
     - the worker named in the zk-verify refusal log, which is a log line only.
2. **Node-local hybrid signatures: `quantum_shield::verify_hybrid`.** Its signature changes from
   `(wallet_id_as_ed_key, …)` to `(claimed_wallet_id, &sig, msg)`, and it checks the derived id.
   Callers:
   - Tmail envelopes (named senders, and the ephemeral signer of anonymous ones);
   - Tmail key registration;
   - anonymity registration;
   - burn revokes;
   - file envelopes and file delete requests;
   - the network layer's signed messages;
   - the hybrid request headers (`rest::helpers`, AI inference).
3. **Request bodies verified field by field:**
   - the founder routes (2);
   - ledger requests (2);
   - vision (2);
   - wallet (1).

   Each carries `mldsa_pubkey_b64` next to a wallet id. Each moves to one shared helper that does
   the full check, rather than seven copies.
4. **Agent manifests (`agent::verify_agent_manifest_v1`):** the owner binding becomes
   `owner_wallet_id == wallet_id_v2(owner's two keys)`. The agent's own keys are pinned by keyid and
   need no change.
5. **Not wallet identities (unchanged):**
   - **block producer keys** (`producer_key`, D4) are their own type, already pinned at 44;
   - **agent payload signatures** name their keys by keyid.
6. **Ed25519-only signatures: a decision, not a mechanical change** (§6):
   - the founder route in `rest/handlers/system.rs`;
   - replication (`replication.rs`);
   - worker proofs (`tet_worker`, `bin/tet-worker.rs`).

   A v2 id cannot be checked against an Ed25519 key alone, so each of these must either become
   hybrid or be identified by its key rather than by a wallet id.

## 5. Guards

Per `CLAUDE.md`, each guard has a negative control that is run and recorded.

| Guard | What it proves | Negative control |
|---|---|---|
| `mldsa_key_unrelated_to_the_wallet_is_refused` (exists, red by design, #31) | **turns green**: the `#[ignore]` is removed | keep the v1 derivation → red again |
| `wallet_id_v2_matches_the_golden_vector` (Rust) and the same vector in the UI, SDK and bundle checks | four implementations, one id | derive from the Ed25519 key alone → FAILED in all four |
| `wallet_id_v2_moves_with_either_key` | one changed byte in either key changes the id; swapping is impossible (fixed lengths) | hash only the Ed25519 key → FAILED |
| `mldsa65_key_has_no_wallet_id` and `mldsa65_signature_is_refused_at_every_site` | A: a level-65 key is refused with `MldsaLevel`, not a generic error | accept any level → FAILED |
| one guard **per site group** in §4 (1–4): a valid Ed25519 signature plus an **unrelated, valid ML-DSA-44** key and signature is refused with `WalletBindingMismatch` | the binding holds at that site, not only in a shared helper | skip the derived-id check **at that site only** → that guard FAILED, the others green |
| each guard's control case: the wallet's own two keys pass at the same site | the refusal is the binding, not a malformed message | none: this is the companion |
| `ledger_records_the_signer_from_both_keys` | the tx index and `processed_by` record the **derived** id | read `ed25519_pubkey_hex` as the id again → FAILED |

Done when every guard is in CI's by-name list, the red test is green, and the private record
`MLDSA_KEY_BINDING.md` is deleted. SECURITY.md's class-level line then changes from "rests on
Ed25519 alone" to the new guarantee.

## 6. Decisions for the founder

1. **Ed25519-only signers** (§4.6): make them hybrid (recommended for anything that acts as a
   wallet: the founder route), or identify them by key (workers and replication sign as machines,
   not wallets)?
2. **`tet-signer`:** move it to ML-DSA-44 (recommended), or document that it cannot sign as a
   wallet?
3. **The devlog's chain binding:** re-sign the published entries under the new dev genesis, or keep
   the old binding as the devlog's historical chain (recommended: keep, and note it beside the pin)?
4. **A version marker in the id** (for example a `w2` prefix)? Recommended **no**: the new genesis
   is the boundary, and keeping 64 hex leaves every format and check unchanged.

## 7. Size

Mostly mechanical: one derivation per language, then the same check at ~40 call sites.

| Part | Lines (approx.) | Days |
|---|---|---|
| Derivation and golden vector, four languages | +250 | ½ |
| Consensus path (`verify_envelope_v1`, the derived signer, sender checks, the ledger's signer reads) | +150 / −60 | ½–1 |
| `verify_hybrid` and its 8 caller groups; the 7 direct request sites behind one helper; manifests | +200 / −120 | 1 |
| Guards (≈ 12, with controls) | +600 | 1–1½ |
| Clients: browser wallet (16 builders write `ed25519_pubkey_hex` as the id), SDK, `tet-cli`, bundle re-pin, `tet-signer` to 44 | +350 / −100 | 1 |
| Fixtures and the eight interop scripts regenerated; docs, SECURITY.md | +200 | ½ |
| **Total** | **≈ 1,750 added, ≈ 300 removed** | **4½–5½ days** |

**Suggested PRs**, each with its guards:
1. the derivation and vectors (no behaviour change yet);
2. the consensus path;
3. the node-local paths;
4. the direct request sites and the §6.1 decision;
5. clients and fixtures;
6. the red test going green, SECURITY.md, and the private record deleted.

**Depends on** `main` being merged into `phase1` first: the red test (#31) and the latest
verification sites are on `main`.
