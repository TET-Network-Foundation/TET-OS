# Agent ID: plan

Status: **plan only, no code. After launch.**

Builds on two things, and replaces neither:
- [`docs/AGENT_IDENTITY.md`](../AGENT_IDENTITY.md): `AgentManifestV1`, which is in the code today;
- [`docs/plans/SIGN_IN_WITH_TET.md`](SIGN_IN_WITH_TET.md): keys derived per site from the words.

An **agent** here is an automated process (a bot, a script, an AI session) that acts with a TET key
on someone's behalf. The goal is that anyone can see **which owner stands behind an agent**, the
owner can **stop it and see what it did**, and an agent **can't be used to multiply one person**
into many: extra votes, extra grants, extra anonymous identities.

What this does not do, and must never claim: it doesn't prove whether a post was written by a person
or by AI. A manifest is the owner's statement about a key, not proof of who typed what. The page
says "declared automated by its owner", never "AI-detected".

## 1. The agent key: derived from the owner's key

- **Derivation**, like Sign in with TET's per-site keys:
  - `seed_agent = HKDF-SHA256(BIP39 seed, info = "tet-agent-v1|" + label + "|" + n)`;
  - `label` is a short name the owner picks (`"newsbot"`), and `n` is a counter (0, 1, …) used for
    rotation;
  - the Ed25519 key is `seed_agent` itself;
  - the ML-DSA-44 key is `HKDF(seed_agent, "tet:pqc:mldsa44-seed:v1")`, as for wallets.
- **What the agent holds:** only its own derived key, exported once as a key file. **Never the
  owner's passphrase (12 words).** A leaked agent key doesn't reveal the owner's key, because HKDF is
  one-way.
- **The same words re-create the same agent keys** on any device, so the owner can always rebuild
  an agent's key to revoke it or read its log, even after losing the file.
- **Nobody else can check the derivation**, because HKDF is one-way. The link between owner and
  agent that others can check is the manifest's signature (§2). Derivation is a convenience for the
  owner, not evidence.
- **Rotation:** `n + 1` gives a new key. The old key's manifest is revoked (§3) or simply expires.

## 2. The owner's manifest line that vouches for it

Reuse `AgentManifestV1` as it is (owner wallet, agent keys, `created_at_ms`, `expires_at_ms`,
`declared_automated`, `capabilities`, the owner's hybrid signature). Three additions, as v2:
- **`label`**, shown next to the agent everywhere: "newsbot · agent of TET:ab12…".
- **`capabilities` from a fixed list:** `post`, `dm`, `stamp`, `sign-in`. A verifier refuses an
  unknown capability rather than ignoring it.
- **`limits`**, optional: the owner's own lower caps per capability (§5). A node never allows more
  than its own maximum, whatever the manifest says.

Further rules:
- **Expiry:** at most 30 days, 7 by default. A manifest past expiry is refused, as today.
- **Where it travels:** inside each post an agent makes, as the questions board already does, so
  any reader verifies it offline. The demo node also keeps the current manifest per agent for the
  limits and the log (§5, §7).
- **The page shows** "agent of TET:ab12… (declared automated)" on every agent post, with the owner's
  ID card one tap away.

## 3. Revocation

v0 deliberately had only expiry, because a revocation service is either central or replicated
(AGENT_IDENTITY.md, anti-goals). This plan keeps expiry as the backstop and adds one narrow,
node-local mechanism:

- **A revocation record:** `{agent_id, revoked_at_ms}`, signed by the owner (hybrid) and sent to the
  node. The node stops accepting anything new from that agent at once: posts, stamps, sign-ins.
- **Gossiped like a message** to the other nodes, which do the same. Records are small and
  permanent, at one per agent.
- **The honest limit, stated on the page:** a node or an offline verifier that hasn't seen the
  record still accepts the manifest until it expires. So expiry stays short; a revoked agent is
  certainly dead at the latest when its manifest expires.
- **What it doesn't do:** what the agent signed before revocation stays signed and stays verifiable.
  Revocation stops the future; it doesn't rewrite the past. The owner can still ask the operator to
  hide posts (the existing takedown).

## 4. What an agent may do, and what it may not

| Action | Agent | Why |
|---|---|---|
| Named board posts | **yes** (capability `post`), always labelled | readers see who stands behind it |
| DMs | **yes** (`dm`), labelled in the recipient's inbox; recipients can refuse agents | — |
| Sign and stamp files | **yes** (`stamp`). On the demo, the sponsor's per-ID cap counts the agent's **owner** | an agent mustn't multiply sponsored stamps |
| Sign in with TET | **yes** (`sign-in`), as "agent of …"; a site may refuse agents | — |
| Votes in members-only polls | **no** | one vote per person; an agent would be a second vote |
| Anonymous posts in the open anonymity group | **no** (see §5) | it would be a second, unlinkable identity |
| Shelter: join, invite, vouch | **no** | Shelter is people vouched for in person |
| Listing in TetSearch | **no** | "Keys without a human vouch can't publish." An owner's manifest isn't a human vouch |
| Welcome grant, airdrop, thread grants | **no** | one per person; agent keys are free to make |
| Moderating, hiding | **no** | only the operator's own key |

A node enforces the "no" rows. The page shows them in plain words when an agent tries one.

## 5. Membership proofs for agents

An agent must not join the open anonymity group (匿名グループ) as if it were another member. That
would let one person post under many unlinkable daily IDs. If anonymous agent posts are wanted:

- **A separate agent group:** an agent registers its own commitment in an agents-only group, with
  its manifest. Its anonymous posts prove "an agent whose owner is a registered member", never "a
  member".
- **The page labels them** "anonymous agent", so they can't pass for a person's anonymous post.
- **The nullifier is bound to the owner's membership, not the agent's,** so all of one owner's
  agents share one daily anonymous agent ID per board, not one each. That is the crux: without it,
  ten agents give one owner ten anonymous voices.
- **The cost:** new proving-program work (an owner-bound nullifier), and an audit. Until that's
  built, agents post named only.

## 6. Rate limits per agent

- **Per agent:** the node's caps per capability (posts per board per day, DMs, stamps), lower than a
  person's by default, and lowered further by the manifest's own `limits`.
- **Per owner, across all their agents:** the caps that matter are summed over the owner's agents,
  so making more agents doesn't buy more.
- **The honest limit:** an owner wallet is free to make too, so per-owner caps only bound someone
  who uses one wallet. Higher limits should need a vouched owner (a Shelter member). Until then, the
  per-node totals for all agents are the real ceiling.
- **The invisible flood guard** applies as for people: paced, not refused.

## 7. An audit trail the owner can read

- **The node keeps a log per agent:** each action's kind, its time, the post's ID or file hash or
  sign-in origin, and the result (accepted, or refused and why). Kept 30 days.
- **Only the owner reads it,** with a request signed by the owner wallet, the same pattern as
  Shelter's members-only reads. The agent can't read or delete it. No IP addresses are logged.
- **The owner's view on /try:** "your agents" lists each agent, its manifest and expiry, its last
  actions, a revoke button, and a renew button (a new manifest with a new expiry).
- **The limit:** the log covers this node. An agent acting through other nodes appears in their logs,
  not this one. Everything it signed can still be found by its key in public data.

## Reuse

- **Sign in with TET:** the same HKDF scheme and domain-separated labels, the same signer UI for the
  owner to approve a manifest, and the same "where the user signs" rule.
- **AgentManifestV1:** its verification order (structure → signer binding → signature → expiry),
  the byte-identical Rust/TypeScript fixture and the offline verifier. v2 adds fields; v1 stays
  readable.
- **Shelter's signed reads,** for the audit log.

## Tests, when built (each with a negative control)

- **Derivation:** the same words, label and `n` give the same agent key, and another `n` gives
  another. Control: derive without the label → two agents collide.
- **The manifest:** an unknown capability is refused; past 30 days is refused; the owner's signature
  is required. Control: an agent's own signature in place of the owner's → refused.
- **Revocation:** after the record, a post is refused on this node and on a node that received it by
  gossip. Control: without the check → accepted.
- **The "no" rows:** each is refused with its plain message. Control: an agent key with a person's
  wallet path → accepted, proving the test can fail.
- **Per-owner caps:** two agents of one owner share the cap. Control: caps per agent only → doubled.
- **The audit log:** the owner reads it; the agent and anyone else get 403. Control: an unsigned
  read → 403.

## Open questions

1. **Revocation:** the node-local record with gossip (as proposed), expiry only (as v0), or wait
   for an anchored list? It's the one place this plan departs from v0's anti-goals.
2. **Anonymous agent posts:** are they wanted at all? If not, §5 shrinks to "agents post named
   only", and no proving work is needed.
3. **Default expiry:** 7 days, with a maximum of 30?
4. **Per-person caps:** should an agent's sponsored stamps and posts count against its owner's
   per-person caps, as proposed, or have their own smaller ones?
5. **Recipients refusing agents:** should a person be able to refuse DMs from all agents with one
   switch, and should that be the default?
6. **Where an agent's key file lives:** a plain file with a device password, the OS keychain, or the
   installable app (INSTALLABLE plan)?
7. **Who may run agents:** any wallet, or only vouched owners (Shelter members), at least on the
   demo?
