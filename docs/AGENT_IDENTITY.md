# Agent identity (v0)

Status: **Day 1 of 3, on branch `agent-identity`. Not merged, not shipped.** Day 1 is the
cryptography: the generic signer and the manifest. Day 2 is the SDK / CLI surface and the on-disk
format. Day 3 is the first real user.

An agent is an automated process — a bot, a script, a Claude Code session — that holds a TET key,
signs what it emits, and can be checked by anyone. The key is vouched for by a human wallet. No
consensus change, no chain write, nothing replicated.

> Idea #5 in `docs/FUTURE_IDEAS.md`. Design report: session of 2026-09-30.

## What it is

Two things, and nothing else in v0.

### 1. A generic signer

Everything else in this repository signs one purpose-built pre-image per operation —
`transfer_hybrid_auth_message_bytes`, `tmail_envelope_auth_message_bytes`,
`tmail_anon_registration_auth_message_bytes`. An agent needs to sign *arbitrary* bytes.

That is the dangerous part of this feature, and it is worth being blunt about why: a generic signer
with no domain separation is a **signing oracle**. Hand it a payload that happens to equal a
transfer pre-image and an agent key becomes a spending key. The whole encoding exists to make that
impossible.

```
tet agent payload v1 <len> <chain_id> <len> <genesis_hash> <len> <payload_type> <len> <payload>
```

with each field written as `<decimal length> SP <bytes> SP`. This is DSSE's PAE shape under a TET
domain tag. Two properties, both asserted by tests rather than by this document:

- **Domain separation.** The output always begins with `tet agent payload v1`. No other pre-image in
  the repository does, and that is checked against four of them.
- **Unambiguity.** No two distinct field lists encode to the same bytes, because every field carries
  its length. A `|`-joined format has neither property: `wallet.rs`'s builders escape nothing, so a
  field containing `|` is re-parseable as two fields.

The chain is bound in as two separate fields (`chain_id` and `genesis_hash`), each asserted
individually on the encoded bytes. They are redundant — the genesis hash is derived from the chain id
— so a signature-level test stays green if either one is dropped, and only a per-field assertion can
tell which is load-bearing. That is the same mistake `envelope_signed_against_a_different_genesis_hash_is_rejected`
was fixed for on 2026-09-28.

### 2. `AgentManifestV1`

The owner's statement that an agent key is theirs. Same shape as `TmailAnonRegistrationV1`,
deliberately: the signer is the subject, the chain is bound, and the ML-DSA public key is **inside**
the pre-image so it cannot be swapped after signing.

| Field | Notes |
|---|---|
| `v`, `kind` | discriminators; a v2 can never be read as a v1 |
| `agent_id` | human label, 1–128 bytes, bound in, carries no authority |
| `agent_ed25519_pubkey_hex` | 64 lowercase hex |
| `agent_mldsa44_pubkey_b64` | exactly 1312 bytes — ML-DSA-44, enforced |
| `owner_wallet_id` | 64 hex; must equal the signer |
| `created_at_ms`, `expires_at_ms` | expiry is the only revocation v0 has |
| `declared_automated` | a **declaration** by the owner, not a proof |
| `capabilities` | ≤ 32 entries, ≤ 64 bytes each |
| `hybrid_sig` | Ed25519 + ML-DSA-44, by the OWNER |

Verification order: structure → signer binding → signature → schedule and expiry. The signature comes
before expiry on purpose, so an `Expired` error is only ever reported for a manifest that genuinely
is the owner's; "expired" never doubles as "unverifiable".

`now_ms` is a **parameter**, not a clock read inside verification. Wall-clock time reached for inside
verification is what split two nodes at block 9828.

## Level pinning

Verification uses `wallet::verify_mldsa44_b64`. It does **not** use `wallet::verify_mldsa_b64`, and
it does **not** use `quantum_shield::verify_hybrid`, which calls the latter.

The inferring verifier reads the parameter set off the public key it is handed and accepts a
consistent ML-DSA-65 pair happily: green, and unusable by every wallet on the network, because every
real TET signature is level 44. A manifest that says ML-DSA-44 has to *enforce* ML-DSA-44 or the
claim is decorative. Both keys in a manifest — the agent's and the owner's — are size-checked before
any signature verification runs.

## Deterministic signing randomness — do not add entropy

ML-DSA here signs with

```
rnd = SHA256("tet:mldsa44-signing-rnd:v1" ‖ msg)
```

(`wallet::mldsa_signing_rnd`, mirrored in `wallet_client_entry.mjs` and `tet-pqc-wasm`).

This is deliberate and must stay:

- **FIPS 204 permits deterministic signing.** The value is public and message-derived; it is not a
  secret and it is not a nonce whose reuse leaks a key, which is the ECDSA intuition that makes
  people want to "fix" it.
- **The cross-language guards depend on it.** The browser bundle, `tet-pqc-wasm` and this crate must
  produce *identical signature bytes* for identical input. That is checkable only because there is no
  randomness — it is what `browser_wallet_hybrid_signatures_verify_on_the_node`,
  `wasm_signer_signatures_verify_on_the_node` and `agent_sdk_signatures_verify_on_the_node` compare,
  and how the ML-DSA-65/44 mismatch was caught.
- **It buys nothing to randomise.** The pre-image is already domain-separated and chain-bound, so
  there is no replay the randomness would prevent.

Adding entropy would break every interop fixture and the reproducibility of
`agent_sdk_hybrid_sigs.json`, and would remove the only mechanism that has actually caught a
parameter-set divergence in this codebase.

## What a manifest does not say

- **Not a proof of automation.** Nothing in a signature separates a model's output from a human
  typing into the same process holding the same key. Hence `declared_automated`, named as a
  declaration. C2PA has the same limit and is explicit about it.
- **Not a proof of authorship.** The key sits on the same machine as the agent. A signature proves
  *this key signed these bytes* — it detects tampering after the fact; it does not attest who or what
  wrote them.
- **Not revocable in v0.** Expiry only. See the anti-goals.

## Anti-goals for v0, and why

**No registry on chain.** Run it past the replicated-field rule: an agent registry is a permanent
public list of every bot a wallet operates, linkable to that wallet forever. It is also the only
version of this feature that needs consensus support, where a new `TxV1` variant without an
`apply_consensus_block_batch` arm does not drop the write — it makes every node reject the whole
block. A manifest that is a file, verified offline, needs none of that. Anchor a hash later if it is
ever wanted, and design it then.

**No revocation service.** A revocation list is either centralised — a server you must reach, so it
becomes both the availability bottleneck and a censorship point — or replicated, which is the
paragraph above. Short-lived manifests instead: expiry is the revocation you do not have to operate.

**No "proof of AI-ness".** See above. Claiming it would claim something the code does not do.

**No transparency log.** Sigstore's Rekor is the right answer to "was this signature ever valid at
time T", and it is a service to run, monitor and keep honest. Out of scope until something needs it.

## Format choice: DSSE shape, not C2PA

C2PA embeds its manifest in the asset (JUMBF boxes), signs it as `COSE_Sign1` with an X.509 chain
from a recognised CA, and its identity model is a CA-issued certificate. Sigstore wraps a statement
in a DSSE envelope and gets identity keylessly from short-lived X.509 bound to an OIDC token.

TET matches **DSSE's envelope shape** and adopts neither PKI. DSSE is signature-agnostic — `keyid`
and `sig` are opaque — so ML-DSA-44 drops in without inventing an envelope. C2PA would force X.509
plus COSE plus embedding, which puts a classical, quantum-breakable component in the identity layer
of a post-quantum chain. That is the objection that already removed ring signatures and Groth16 from
the spec, and it applies here for the same reason: the convenient option is the one that costs the
premise.

Worth revisiting C2PA as a *second*, image-specific manifest once there is a post-quantum COSE
algorithm identifier to name.

## Guards (Day 1)

All in `tet-core/src/tests.rs`. Each was run with its protection removed and confirmed to fail; the
results are in the commit body.

| Guard | What it pins |
|---|---|
| `agent_manifest_signed_by_the_owner_verifies` | the floor, plus both keys really being level 44 |
| `agent_payload_bytes_can_never_equal_another_tet_preimage` | domain separation, and the chain bound as two separate fields |
| `agent_payload_encoding_is_unambiguous` | the length prefixes, tested with fields containing the separator |
| `agent_payload_signature_does_not_transfer_between_payload_types` | `payload_type` is bound in |
| `agent_payload_signature_is_bound_to_the_chain` | a signature does not cross chains |
| `agent_manifest_naming_another_owner_is_refused_even_when_correctly_signed` | the binding, against a *correctly signed* forgery |
| `every_manifest_field_is_covered_by_the_signature` | nine fields, each mutated after signing |
| `agent_manifest_with_a_65_agent_key_is_refused` | level pin, agent key |
| `agent_manifest_signed_with_a_valid_65_owner_key_is_refused` | level pin, owner key — against a pair the inferring verifier accepts |
| `expired_agent_manifest_is_refused` | expiry, with the clock as a parameter |
| `agent_manifest_with_an_impossible_schedule_is_refused` | incoherent schedule ≠ merely expired |
| `agent_manifest_capability_bound_is_enforced_and_named` | the bound is enforced *and* observable in the refusal |
| `agent_manifest_naming_the_owners_own_key_as_the_agent_is_refused` | the degenerate case |
| `agent_manifest_version_and_kind_are_checked` | discriminators |
| `agent_manifest_preimage_is_typed_as_a_manifest` | a manifest cannot be replayed as content |

## Still to do

- **Day 2**: `tetSign` / `tetVerify` in `tet-agent-sdk`, `tet-cli agent sign|verify`, the detached
  `.sig.json` format, and the inline `x-tet-*` header path.
- **Day 3**: devlog signing in `~/site/tools/build.mjs`, the honest limit stated on the site, and a
  lazy-loaded browser verifier.
- Not before the flip, and not merged to `main` until all three are done.
