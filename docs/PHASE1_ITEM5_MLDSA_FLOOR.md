# Item 5 — the ML-DSA floor has no value that does what the row says

Open question from queue item 5 (minimum ML-DSA level). Written 2026-10-05 by the unattended
session on `phase1-item-5-mldsa-floor`. **Nothing is implemented.** The row cannot be built as
written, and choosing what to build instead is a cryptography decision. `QUEUE.md` says that is not
the session's to make.

## Decision (2026-10-05): D + A

- **D, binding first.** The wallet id commits to both public keys, e.g.
  `wallet_id = H("tet wallet v2" ‖ ed25519_pk ‖ mldsa44_pk)`. Every hybrid verifier, consensus
  (`verify_envelope_v1`) and node-local (`verify_hybrid`) alike, checks that the carried keys hash to
  the claimed wallet id. That turns the post-quantum half into an identity check, not just a
  signature check.
- **A, the level pinned at 44.** Accept exactly ML-DSA-44 (1312-byte public key), as the producer
  key (D4) and the agent keys already are. Not a floor: there is nothing below 44.
- **Cost, accepted:** every wallet id changes. Balances do not carry over anyway (Strategy C), but
  mnemonics now derive a different id, and every client (browser wallet, agent SDK, `tet-cli`,
  `tet-signer`) must derive it the same way.
- **Reproduced:** `mldsa_key_unrelated_to_the_wallet_is_refused` (TET-OS #31, `#[ignore]`, red by
  design) fails today with "accepted an ML-DSA key unrelated to wallet …". It is the test this item
  turns green. SECURITY.md states the limitation at class level; the `file:line` detail is kept
  privately.
- **Next:** a design doc (QUEUE item 5, autonomous **no**) covering the id derivation and its
  domain tag, the migration of every client, what `tet-signer` does (it signs at ML-DSA-65 today),
  and one guard per verifier path. The answers to the questions at the end of this document go
  there.

The rest of this document is the question as the unattended session put it.

## What the row and the spec say

`QUEUE.md` item 5:

> **Minimum ML-DSA level**: consensus verification refuses a key below the floor instead of
> inferring the level from its length

`PHASE_1_GENESIS_SPEC.md` §2 table, citing WP §7.1:

> Verification infers the level from pubkey length and accepts 44/65/87, so the effective security
> level is the signer's choice. Pinning a floor is a consensus rule

Neither gives the floor's value.

## What the code does

**The consensus check.** Every consensus tx goes through `rest::helpers::verify_envelope_v1`. That
covers the mempool via REST, gossip admission (`p2p::handle_tx_broadcast` → `tx_hash_for_env`) and
block validation. Its ML-DSA half calls `wallet::verify_mldsa_b64`, which reads the parameter set off
the public key's length (1312 / 1952 / 2592 bytes → 44 / 65 / 87) and accepts all three. I checked
this tonight with a throwaway probe test, not committed: a `Transfer` envelope signed by the
wallet's own mnemonic at each level passes `verify_envelope_v1`, as 44, as 65 and as 87.

**Surfaces already pinned to exactly 44** (they call `verify_mldsa44_b64`, not the inferring
verifier):

| Surface | Where | Guard |
|---|---|---|
| Block producer signature (D4) | `producer_key.rs:55` | item 1's guards |
| Agent manifests and payloads | `agent.rs:239` | `agent_manifest_signed_with_a_valid_65_owner_key_is_refused` |

**Surfaces that still infer** (`verify_mldsa_b64`, directly or through `quantum_shield::verify_hybrid`):
`verify_envelope_v1` (consensus); the hybrid REST headers (`rest/helpers.rs:150, :182`); `founder`,
`vision`, `wallet` and `ledger` handlers; gossip `ProofAnnounce` (`network.rs:86`); Files
(`files/mod.rs:182, :250`); Tmail keys, envelopes, burns and anonymous registration (`tmail/*.rs`).
Only `verify_envelope_v1` is a consensus rule. The rest are node-local admission checks, outside this
row unless the decision says otherwise.

**Who signs consensus envelopes, and at what level:**

| Signer | Level | Can it change? |
|---|---|---|
| Browser wallet (`wallet_client_bundled.js` → `tet-pqc-wasm`) | **44 only** | Only by rebuilding the wasm signer and the committed bundle, with new fixtures (`CLAUDE.md`, "A committed build artifact…") |
| `tet-agent-sdk` | **44 only** | `mldsa44SignDeterministic` |
| `tet-cli tx send` | `wallet::active_mldsa_mode()`: 44 by default, **65 or 87** with `TET_MLDSA_SECURITY_LEVEL` | Yes, per operator |
| `tet-signer` (macOS Keychain) | **65 always** (`bin/tet-signer.rs:139–166`) | Randomly seeded and device-bound, so moving it is local, but every existing install has a 65 key |

## Why the row cannot be built as written

1. **Nothing sits below 44.** FIPS 204 defines only 44, 65 and 87, and the inferring verifier
   already refuses every other length. With a floor of 44, "refuses a key below the floor" refuses
   nothing. Its guard could not have a negative control: removing the check changes no outcome. A
   guard like that is exactly what `CLAUDE.md` forbids merging. The only way to make it fail would
   be a floor that tests can configure to 65. That is a test-only override standing in for the real
   path, which is what D3 rules out.
2. **Every floor above 44 breaks every user.** The browser wallet and the agent SDK sign 44 only, and
   so does D4's producer key. That one is checked separately, but a 65 floor for txs alongside a 44
   floor for blocks would be hard to defend.
3. **"Instead of inferring the level from its length" cannot be literal.** The envelope carries raw
   FIPS 204 bytes with no level tag, so length is the only signal a verifier has. The weakness is not
   that the verifier infers. It is that it accepts *a range*, so the signer picks the level.

## A precondition the row does not mention: the ML-DSA key is not bound to the wallet

A wallet id is its Ed25519 public key. The ML-DSA public key travels **inside the envelope**
(`HybridSigV1.mldsa_pubkey_b64`) and is checked only against the signature beside it. No rule ties it
to the wallet: no registry, no derivation, no first-use pin. The probe shows it. A `Transfer` whose
Ed25519 half is the wallet's own, with an ML-DSA-44 key from an **unrelated mnemonic**, passes
`verify_envelope_v1`.

So for wallet authorization, the ML-DSA half proves only that *someone* holds *some* ML-DSA key. An
adversary who can forge Ed25519 (the quantum case the hybrid exists for) signs the ML-DSA half with
a key of their own, at whatever level the floor allows. **No floor raises post-quantum security
for consensus txs until the ML-DSA key is bound to the wallet.** The level question is downstream
of the binding question.

Binding is an identity and cryptography decision too, and it is out of this row. The shapes it could
take, for whoever writes that item:

- **Address from both keys:** wallet id = H(ed25519_pk ‖ mldsa_pk). Strong, but it changes every
  address format and every place that treats the wallet id as an Ed25519 key (`verify_ed25519` takes
  the id as the key today).
- **Pin on first use:** the first applied tx from a wallet records its ML-DSA public key in
  replicated state, and later txs must match it. A public key in replicated state passes the design
  principle. A wallet's first tx stays Ed25519-only in effect, and key rotation needs its own tx.
- **Commit at genesis or airdrop:** only for wallets that exist at the ceremony. It does not cover new
  wallets.

## Options for the level itself

| | Rule at `verify_envelope_v1` | What breaks | What it buys |
|---|---|---|---|
| **A** | **Pin exactly 44** (`verify_mldsa44_b64`), as producer and agent already do | `tet-signer` (65) and any `tet-cli` run with `TET_MLDSA_SECURITY_LEVEL=65/87` stop producing valid txs. `tet-signer` would move to a 44 key | One parameter set network-wide, so the signer no longer chooses. Testable: a valid 65 pair is refused, and the control (switch back to the inferring verifier) fails |
| **B** | Floor 44, accept ≥ 44 (genesis constant or genesis parameter) | Nothing | Nothing today. The guard can't be non-vacuous (point 1). It writes down the intent for a later raise, which needs a new genesis anyway because the floor would be in the hash |
| **C** | Floor 65 | Browser wallet, agent SDK and every user's ML-DSA key (new HKDF info string → new key; wallet ids survive only because nothing binds the ML-DSA key, see above). Committed bundle and wasm rebuild, interop fixtures, `tet-agent-sdk`. pk 1312 → 1952 B and sig 2420 → 3309 B on every tx | NIST level 3 instead of 2, once binding exists |
| **D** | Defer the level and do binding first | Nothing yet | Puts the work where the security is (see above) |

## Recommendation

**D, then A.** Make the binding item the prerequisite and record it in `QUEUE.md`. When item 5 is
built, pin **exactly ML-DSA-44** at `verify_envelope_v1` (option A). That matches D4 and the agent
precedent, keeps the browser wallet working, and gives a guard whose negative control can fail. Move
`tet-signer` to a 44 key in the same PR, or say plainly that it cannot sign consensus txs. Call the
rule a *pin*, not a *floor*, in the row and the spec, since it refuses higher levels too.

If a level above 44 is wanted for the ceremony, it is option C. That is a wallet-wide key migration
on the scale of item 9 (ML-KEM), and should be scheduled as one rather than slipped into a
consensus-rule item.

## Questions for the reviewer

1. Pin exactly 44 (A), floor 44 (B), floor 65 (C), or binding first (D)?
2. Should binding the ML-DSA key to the wallet become its own queue item before item 5? Which shape?
3. If A: should `tet-signer` move to 44, or be documented as unable to sign consensus txs?
4. Should the node-local REST and gossip checks listed above be pinned in the same change, or stay
   out of this row?
