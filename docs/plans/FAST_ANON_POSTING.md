# Fast anonymous posting — design (no code until reviewed)

Goal: anonymous posting on a board as fast as 2ch. Today every anonymous post needs its own
zero-knowledge proof (~30 s on a laptop) and a member gets one anonymous post per board per UTC day.

## The idea in one paragraph

One proof per (board, UTC day). The proof the guest already makes binds a member's **daily
posting key** to that day's nullifier for that board: its journal (TAM1) carries the Merkle root,
the nullifier, an **ephemeral public key**, the receiver (the board) and the day bucket. The first
anonymous post of the day carries that proof, as now; the node, having verified it, records
"this posting key may post anonymously on this board today". Every later post that day is signed
with the posting key only — no proof — so it's instant. The posting key is derived from the member
secret, the board and the day (`tmailEphemeralSeed`, already in the page), so it never has to be
stored: a reload, another tab or another device re-derives the same key.

## What readers see (linkability)

All of a member's anonymous posts on one board on one UTC day carry the **same daily ID**
(ID:xxxx, from the nullifier) — exactly as today's single daily post does. Posts on another board,
or on another day, have a different, unlinkable ID. The page says so next to the ID: "the same ID
on the same board on the same day is the same person; tomorrow, or on another board, it isn't."

## Node rules

1. **Registration = a verified proof.** A posting key is registered for (board, day) only by an
   anonymous post whose proof verifies (the #78 rules: checked before storing, never relayed or
   kept if it fails). The registration is `(receiver, bucket, nullifier) → posting key`, taken from
   the verified journal.
2. **One key per member, board and day.** The nullifier is unique per (member, board, day), so a
   second registration with the same nullifier is refused (replay), and a different proof can't
   register a second key for the same member that day.
3. **Fast posts.** An anonymous post *without* a proof is accepted only if it's signed by a key
   registered for **that board** (the envelope's receiver) and **that day** (the bucket of its
   `sent_at_ms`, which must be today ±0). Unregistered key, another board, another day: refused,
   never stored.
4. **Flood control per daily ID** instead of one post a day: at most one post per
   `TET_ANON_POST_INTERVAL_S` seconds (proposed 10) and `TET_ANON_POSTS_PER_DAY` per key (proposed
   200), on top of the per-IP limits. Refused posts are not stored.
5. **Gossip.** The registering post (with its receipt hash) is gossiped as today; other nodes verify
   it (pulling the receipt) and record the key. Fast posts are gossiped too; a node that hasn't
   verified the registration yet holds them as pending and serves them only once the key is
   registered there (#78: nothing unverified is served or counted). A registration that fails
   (definitely) drops the pending posts with it.
6. **Retention.** Fast posts count as verified anonymous posts for the per-board cap (verified-first
   ordering stays).

## UX

- When a member opens a board, the page derives today's posting key; if the board shows no
  registration for it yet, it **starts the day's proof in the background** right away.
- A post appears immediately as "checking…" and flips to verified when the node accepts it (or
  shows the refusal, e.g. "posting too fast — wait 6 s").
- Cmd/Ctrl+Enter posts.
- The first post of the day waits for the proof if it isn't ready; every later post is instant.

## Threat model

**What changes.** Anonymous posting goes from one proof per post to one proof per board per day;
posts after the first are authenticated by a signature from a key the proof vouched for.

**What doesn't.** Who can post anonymously (members of the anonymity set), what a post reveals
(not which member), and linkability within a board-day (already one daily ID).

**If a posting key leaks** (a compromised tab, a shared screenshot of a debug console): the
attacker can post as that daily ID **on that board until 00:00 UTC**, rate-limited, and nothing
else — not on other boards, not on other days (keys are per board and day, registrations are per
board and day), and it doesn't reveal the member (the key is derived from the member secret one-way,
and the proof is zero-knowledge). The member can't revoke it before midnight in this design; an
explicit "revoke today's key" post signed by the key is possible later.

**If the member secret leaks**: as today — the attacker can post as that member everywhere. No
change.

**Spam.** Bounded by membership (registration needs a proof against the anonymity set), by one key
per member per board per day, and by the flood control per key. A member can post up to the daily
cap per board — the operator-hide and moderation rules apply as for any post.

**Node view differences.** A fast post for a key another node hasn't registered yet is pending
there, never served until the registration verifies; a registration failing only on "root not
recognised" is forgotten without a tombstone (#78), and its posts with it.

## Tests (each with a negative control)

- An unregistered posting key's post is refused and not stored (control: accept any signed post).
- A key registered for board A posting on board B is refused (control: ignore the receiver).
- A key registered yesterday posting today is refused (control: ignore the bucket).
- A replayed proof (same nullifier) can't register a second key (control: no nullifier check).
- Flood control: the second post inside the interval is refused; the 201st of the day is refused
  (controls: no interval; no cap).
- Gossip: a fast post that arrives before its registration is pending and not served; served once
  the registration verifies; dropped if it fails (control: serve pending posts).
- The posting key re-derives identically after a reload (page guard, parity with the guest's
  `tmailEphemeralSeed`).
- Real-prover e2e: first post proves, the next ten are instant, a post on another board with the
  same key is refused.

## Open for review

1. Flood interval (10 s?) and daily cap (200?).
2. Should the first post wait for the proof, or go out named if the member doesn't want to wait?
3. "Revoke today's key" now or later?

## Security review before building (2026-10-10)

The design was reviewed before any code. Five changes are required; with them it keeps the
properties of today's anonymous posting. They are folded into the implementation and its tests.

1. **Bounded pending posts** (rule 5 as written allowed a flood). A node holds a gossiped fast post
   as pending **only** if it already holds a registering post, not yet verified, for that exact
   posting key, board and day. Otherwise the post is dropped. Pending posts are capped (proposed:
   50 per key, 5,000 per node) and expire after 10 minutes if the registration hasn't verified.
   A REST-submitted fast post with no registered key is refused, as in rule 3.
2. **No fast path for polls.** Poll wallets (receivers with a registered poll root) never accept
   fast posts: one proof, one ballot. Without this, a registered key could vote many times.
3. **A per-daily-ID share of the board's anonymous retention.** The board keeps its newest 100
   anonymous posts. One daily ID may hold at most 20 of them, and its own oldest go first, so one
   member can't push everyone else off a board.
4. **Invisible flood guard** (founder, 2026-10-09: no visible per-minute limit). Per posting key,
   the node allows a burst of 5, then one post every 3 s, and at most 200 a day. The page paces
   posts silently, as named posts do. A refusal is a last resort, worded as a retry ("try again
   in a moment"), never as a limit.
5. **Unambiguous paths.**
   - A fast post carries no proof. A post that carries a proof is judged only by the proof, and
     never falls back to the fast path.
   - Registrations are stored with their day and dropped after it.
   - Registrations survive a node restart (sled).

Unchanged: who can post anonymously, what a post reveals, and the one-daily-ID-per-board-per-day
linkability, which the page states next to the ID.
