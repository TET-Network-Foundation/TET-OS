# TET one-time permits next to agent identity work at the IETF and NIST

**Status: idea / not reviewed.** A reading note, written 2026-11-16. Nothing here is proposed,
planned or decided, and no code goes with it. Every statement about another document is limited to
what was read (listed below); where something was not read, this note says so.

## What was read

| Source | What it is | How much was read |
|---|---|---|
| [draft-singla-agent-identity-protocol-02](https://www.ietf.org/archive/id/draft-singla-agent-identity-protocol-02.html), "Agent Identity Protocol (AIP)" | An individual Internet-Draft (author listed as Independent; not a working-group document), dated 14 May 2026, Standards Track intended. Work in progress, to be cited only as such. It expired on 15 November 2026; the Datatracker lists -03 (10 June 2026) as current. | Sections 3 to 9 in part, through a summarising reader, not line by line. **-03 was not read.** |
| [NIST IR 8547 (final)](https://csrc.nist.gov/pubs/ir/8547/final), "Transition to Post-Quantum Cryptography Standards" | NIST's report on moving from quantum-vulnerable public-key algorithms to post-quantum ones. Final version dated 27 October 2026 (draft 12 November 2024). | The publication page only. **The PDF's text could not be extracted here**, so no date or table from the report is quoted below. |
| [NIST AI Agent Standards Initiative](https://www.nist.gov/caisi/ai-agent-standards-initiative) | NIST's initiative on standards for AI agents, including identity and authorisation (already cited on the home page). | The page, earlier. No deliverable from it was read. |
| [OpenAI Delegated Payment Spec](https://developers.openai.com/commerce/specs/payment), part of the Agentic Commerce Protocol | The spec for handing a merchant's processor a token an agent may use once, within an "allowance". | Through the protocol's reference page ([agenticcommerce.dev](https://agenticcommerce.dev/docs/reference/payments)) and search excerpts; OpenAI's own page was not read whole. |

## The TET side, as built

A one-time permit is the machine notebook's (`tools/machine-notebook`, prototype, runs on your own
computer):

- **The permit:** canonical JSON `{kind: "tet_machine_permit_v1", permit_id, action, expires_seq}`,
  signed by the device's key with both TET halves, Ed25519 and ML-DSA-44.
- **A use:** the device signs a record in its own hash-linked log that cites the permit id.
- **The check:** `notebook.py verify` (and the browser's port) refuses a second citation, a citation
  after `expires_seq`, and a permit signed by another key, each with its own reason. Anyone holding the
  log can run it, offline, without asking the device or anyone else.
- **The limit:** once per log, not once in the world. A copied key could start a second log and use the
  same permit there. Making it "once in the world" needs a shared record keeper; that is an open idea
  ("Once in the world", /machines).

## Map

### Identity

| | TET | AIP -02 |
|---|---|---|
| Identifier | `tet-ed25519:<public key hex>`, plus an ML-DSA-44 key id; both halves sign | `did:aip:<namespace>:<agent-id>`, the agent-id the leftmost 128 bits of SHA-256 of the Ed25519 public key (§4.1, §4.2) |
| Algorithms | Ed25519 + ML-DSA-44, both required | Ed25519 / EdDSA only (`alg` MUST be `"EdDSA"`, §9.2); no post-quantum algorithm and no algorithm negotiation seen |
| Key rotation | None for notebook keys: a new key is a new log | `version` increments by one; the retiring key signs the new one (`previous_key_signature`, §5.2) |

**Similar:** both derive the identifier from the public key, so it is self-checking.
**Different:** AIP's identity is Ed25519 alone. In NIST IR 8547's framing, Ed25519 is one of the
quantum-vulnerable algorithms to move away from (its exact dates are not quoted here; see "What was
read"). TET signs with both halves today. AIP has rotation; the notebook does not.

### Delegation: who may act for whom

| | TET | AIP -02 |
|---|---|---|
| Who grants | The device's own key signs its permits (`notebook.py permit`). There is no separate owner key in the permit. | A principal (a W3C DID, not `did:aip`) delegates through a chain of Principal Tokens (§5.5): `delegated_by`, `delegation_depth`, `max_delegation_depth` (default 3), `scope`, `issued_at`, `expires_at` |
| Narrowing | Not applicable: one level only | A child cannot get wider scope than its parent (Rule D-1, §5.10); overlays only restrict (CO-1, §5.11) |
| What is granted | One `action` name | A `scope` array, plus manifest limits such as `max_requests_per_hour` and `max_daily_total` (§5.9) |

**Gap on the TET side, and the largest one:** a notebook permit does not say *who* allowed the action.
The device signs its own permits, so the log shows the device claimed one use of a permit it made; it
does not show an owner's consent. AIP's chain does name the principal. An owner-signed permit would
be a design change and is not proposed here.

### Once

| | TET | AIP -02 | Delegated Payment Spec |
|---|---|---|---|
| What is single-use | A permit, cited by at most one record in this log | A credential token, by `(iss, jti)` (§9.6.5) | A token whose `allowance.reason` is `one_time` (the only value listed) |
| Who refuses the second use | Anyone re-checking the log, afterwards | The relying party that keeps the replay cache; a cached result must not let a consumed `(iss, jti)` through again (§8.2.1) | The service holding the token (the merchant's processor) |
| Scope of "once" | Once per log | Once per relying party's cache | Once at that processor, for `checkout_session_id` and `merchant_id`, before `expires_at` |
| Expiry | `expires_seq`: a record number, not a clock | `exp`, short mandatory lifetimes (§8.2), 30 s clock skew on `iat` (§5.4) | `expires_at`, a timestamp |
| What is left to check later | The signed, hash-linked log, verifiable offline | Whatever the relying party logs; the Registry keeps a signed, append-only engagement `change_log` (§5.12), kept by the Registry, not the agent | Whatever the processor keeps |

**Similar:** all three make one use the default for the sensitive thing, and all three put an end on it.
**Different:** where "once" is enforced. In AIP and the payment spec, one party that sees every use
(the relying party, the processor) refuses the second one at the time. In TET's notebook, nobody refuses
in advance except the device's own `record`; the second use is *caught* by whoever reads the log, and
the evidence is in the holder's hands. That is the trade: TET's check needs no one online and leaves a
record anyone can re-run, but it cannot see a second log. The others see every use they handle, and
nothing outside them.

### Revocation and audience

- **AIP** has four revocation kinds (`full_revoke`, `scope_revoke`, `delegation_revoke`,
  `principal_revoke`, §5.7) checked against a registry or a cached revocation list; a token has an
  audience (`aud`) and can be bound to one HTTP request (DPoP, mandatory at its Tiers 2 and 3).
- **The payment spec** binds the token to one merchant and one checkout session.
- **TET's notebook** has neither: a permit cannot be withdrawn before `expires_seq`, and it names no
  audience. Both are gaps.

## Open questions

1. Should a TET permit carry an owner's signature as well as the device's, so the log shows consent and
   not only use? (AIP's Principal Token is the comparison.)
2. If "once" should hold beyond one log, who keeps the shared record: a node, the chain, or the party
   that receives the action (as in AIP and the payment spec)? This is "Once in the world" on /machines.
3. Could a TET permit be expressed as, or carried inside, an AIP credential (a `did:aip` agent with a
   `jti` that equals a notebook `permit_id`)? Nobody has tried.
4. AIP fixes Ed25519. If drafts like it move forward, is there a place for a post-quantum half, and would
   anyone want it before IR 8547's deadlines bite?
5. What does -03 change? Not read.
6. What will NIST's agent standards work actually specify? No deliverable has been read.

## What this note does not say

- That TET follows, implements or is compatible with any of these documents. It does none of these.
- That TET prevents fraud or impersonation. A signature shows which key signed; it does not show who
  holds the key or whether a request was honest.
- Anything about the Delegated Payment Spec beyond its token limits: this note is about "once" only.
