# Agent identity (v0)

Status: **Day 2 of 3, on branch `agent-identity`. Not merged, not shipped.** Day 1 was the
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

## The detached format (Day 2)

DSSE's *shape*, written next to the artefact as `<name>.sig.json`:

```json
{
  "payloadType": "text/plain",
  "payload": "aGVsbG8gYWdlbnQ=",
  "signatures": [
    { "keyid": "tet-ed25519:c5785e18…", "sig": "…64 bytes…" },
    { "keyid": "tet-mldsa44:7596fae5…", "sig": "…2420 bytes…" }
  ],
  "tet": {
    "v": 1,
    "pae": "tet agent payload v1",
    "agent_ed25519_pubkey_hex": "c5785e18…",
    "agent_mldsa44_pubkey_b64": "…1312 bytes…"
  }
}
```

DSSE has nowhere to put a 1312-byte public key and no notion of two signatures from one identity at
two security levels, so the `tet` block carries both. `keyid` for ML-DSA is `SHA-256` of the raw key,
because a 1312-byte key does not belong in an identifier, and the keyid is checked against the key the
envelope carries — an envelope whose keyid names something else is refused.

**`tet.pae` is not decoration.** The signed bytes are TET's PAE, not DSSE's, so a standard DSSE
verifier computes a different pre-image and rejects. That is the right outcome, and naming the
encoding makes the difference machine-visible instead of a trap. An envelope naming any other
encoding — `DSSEv1` included — is refused rather than verified against these rules.

**The envelope carries no chain identity, and one smuggled in is refused rather than ignored.** A
verifier that read `chain_id` out of the file it is checking would verify every file against whatever
chain that file names, which is not a check. `deny_unknown_fields` makes it a parse error, because the
distance between "ignored" and "read" is one future patch.

## The inline path

For messages and HTTP bodies rather than files, the same signature travels as headers:

```
x-tet-agent-payload-type: text/plain
x-tet-ed25519-pubkey-hex: …
x-tet-ed25519-sig-b64:    …
x-tet-mldsa-pubkey-b64:   …
x-tet-mldsa-sig-b64:      …
```

The four signature headers are the ones the AI-infer path already sends, from one shared builder so
the names cannot drift apart. The two paths sign **different** pre-images —
`tet ai infer hybrid v1` versus `tet agent payload v1` — so a signature made for one can never be
replayed as the other even though the headers look identical on the wire. `x-tet-agent-payload-type`
is required: without it the four signature headers are unverifiable, because `payload_type` is bound
into the pre-image.

## The CLI

```
tet-cli agent sign   --in <file> --payload-type <type> [--out <file>.sig.json]
tet-cli agent verify --sig <file>.sig.json [--payload <file>]
```

`sign` takes the mnemonic from `TET_MNEMONIC`; `--mnemonic` works and warns, because an argument is
visible in shell history and to every other process via `ps`. There is deliberately no way to ask for
a bare signature over raw bytes — that would be the signing oracle this design exists to prevent.

`verify` prints the chain it checked against *before* the verdict: a verification tool that does not
say which chain it used has not said what it checked. It exits non-zero on failure, and `--payload`
additionally requires the file on disk to be the bytes the envelope signed, which is the actual
question for a detached signature.

## Cross-language: byte-identical, not "both verify"

`tet-core/src/testdata/agent_payload_envelopes.json` is produced by `tet-agent-sdk` and asserted in
three places: the SDK rebuilds it, `tet-core` re-signs and compares **signature bytes**, and
`tet-cli` verifies it and reproduces the envelope byte for byte. Five payloads, including every byte
value 0x00–0xFF, an empty payload, and one that imitates both the length prefix and another
pre-image's delimiter.

Comparing bytes rather than "both verify" is possible only because the ML-DSA signing randomness is
`SHA256(label ‖ msg)`. It is also what makes the guard sharp: changing the encoding on either side —
dropping the length prefixes, the domain tag or the chain fields — turns 12–13 tests red immediately.

## Discovering the binding: `GET /chain`

```
GET /chain  ->  { "chain_id": "tet-local-dev", "genesis_hash": "0x1aebfb89…" }
```

Read-only, unauthenticated, exactly two fields. Both are public — `chain_id` is in the README and
`genesis_hash` is derived from public genesis parameters and appears inside every signature pre-image
on the network — and a node that would not say which chain it is on is not usable as a node.

It exists because an agent **cannot derive** the genesis hash: `tet-core` computes it from its
treasury configuration, and reimplementing that in TypeScript would be a second source of truth for a
value that silently decides whether a signature is valid anywhere. So the SDK fetches it and refuses
to guess.

The format is `0x` + 64 lowercase hex, and **the prefix is part of the signed string**. A client that
normalised it away would produce signatures no node accepts. The SDK asserts the exact value it was
served (lower-cased only, matching `expected_genesis_hash_from_env`) and rejects a malformed answer
rather than defaulting: a binding made of empty strings signs happily and verifies nowhere. A bare
64-hex value is also accepted, because `TET_GENESIS_HASH` is taken verbatim when an operator sets it.

**Discovery, not authority.** An agent that asks a hostile node and signs against the answer produces
signatures bound to a chain nobody recognises — useless rather than replayable, because a real verifier
recomputes the binding locally. For anything that matters, pin the values and use `GET /chain` to
notice that your pin disagrees with the node in front of you.

The end-to-end check is `tet-cli/scripts/agent_chain_discovery.sh`: a real node derives a hash, the
SDK discovers it **with `TET_CHAIN_ID` and `TET_GENESIS_HASH` unset** — the signing step refuses to run
if either is present, so "it worked" cannot mean "it was told" — signs, and `tet-core`'s verifier
accepts it. It then starts a second node with a different treasury and requires a different hash,
because a route returning a constant would pass everything else.

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

## Guards (Day 2)

Rust, in `tet-core/src/tests.rs`:

| Guard | What it pins |
|---|---|
| `sdk_agent_payload_signatures_are_byte_identical_in_rust` | the SDK and the node produce the *same bytes*, not merely both verify |
| `sdk_agent_envelopes_verify_in_rust` | the SDK's envelopes verify here, and Rust rebuilds them identically |
| `agent_envelope_from_another_chain_is_refused` | the chain binding survives the envelope |
| `agent_envelope_structure_is_checked_field_by_field` | version, `pae`, payload type, signature count and set, both keyids, payload, payload type |
| `agent_envelope_carrying_a_chain_id_is_refused_not_ignored` | a smuggled chain identity is a parse error |
| `chain_route_reports_the_binding_every_signature_uses` | `GET /chain` is public, exactly two fields, `0x`+64hex, and *derived* rather than constant |

TypeScript, in `tet-agent-sdk/tests/agent_sign.test.ts` (27 assertions): fixture byte equality for
every case, envelope rebuild equality, tampered payload, swapped `payload_type`, **`chain_id` and
`genesis_hash` separately**, each signature half individually wrong, keyid mismatch, unknown `pae`,
duplicated signature set, the separator-containing ambiguity cases, `chainBindingFromEnv` refusing to
guess, and the inline headers.

TypeScript also covers `GET /chain` validation: the exact value including the `0x` prefix, the bare
64-hex form, lower-casing, six malformed answers, a non-200, a non-JSON body, and a discovered binding
signing and verifying round-trip while failing under a different one.

Shell, in `tet-cli/scripts/agent_cli_interop.sh`: five cases through the real binary, both signing
directions, and `verify` exiting non-zero for another chain and for a payload that is not what was
signed. In `tet-cli/scripts/agent_chain_discovery.sh`: a live node, discovery with the environment
unset, `tet-core` verifying, refusal on another chain, and the served hash proven derived.

## Still to do

- **Day 3**: devlog signing in `~/site/tools/build.mjs`, the honest limit stated on the site, and a
  lazy-loaded browser verifier.
- `tet-agent-sdk/tests/slashing_audit.test.ts` is skipped: `examples/attacker.ts` posts to
  `POST /ledger/faucet`, removed in the September clean-up. Reviving it means porting the example to
  the hybrid-signed `POST /ledger/initial_airdrop/claim`.
- Not before the flip, and not merged to `main` until all three days are done.
