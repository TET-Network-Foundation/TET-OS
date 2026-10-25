# Members-only anonymous poll — plan (not built)

FUTURE_IDEAS #21. Replaces queue items (k) and (n): one design covers both.

## What it is

A poll only listed members can vote in. One vote per nullifier, results public, voters unlinkable.

- **Proves:** each counted vote came from a member of the list, and no member voted twice.
- **Doesn't prove:** who voted what (nobody, operator included, can link a ballot to a key). The
  node still sees each voter's IP address; for that, Tor or your own node.

## How it maps onto what exists

- An anonymous post today carries a zero-knowledge proof that its sender's commitment is a leaf in
  **the node's** member tree, and a **nullifier** that is one per (member, receiver, UTC day).
- A poll is a board-like receiver (its own wallet). A ballot is an anonymous post to it whose text
  is the option. The tally is computed by anyone who can read the poll.

## The two gaps

1. **"Members-only" needs a member list per poll.** The node accepts proofs only against roots of its
   own registry (everyone who registered). A poll's list is different. Options:
   - **A. Poll root registered with the node** (recommended): the creator publishes a signed
     `poll_root_v1 {poll_wallet, root, members_count, closes_at}`; the node accepts ballots to
     that poll wallet whose proof is against that root. Node change, not consensus; the ZK program is
     unchanged (it already proves membership under a given root). Each member must have registered
     a commitment the creator puts in the tree, so joining = giving the creator your commitment.
   - **B. Reader-side check:** ballots are posted against the node's root as today, and readers
     discard ballots whose member isn't on the list. Doesn't work: the nullifier hides which member
     voted, so readers can't filter. Listed only to rule it out.
2. **"One vote per nullifier" vs "one vote per member".** The nullifier changes every UTC day, so a
   poll open across midnight lets a member vote again. Options:
   - **A. Polls close at the end of the UTC day they open** (no ZK change; one nullifier = one vote).
   - **B. A poll-scoped nullifier** (`H(secret, poll_id)`): a new ZK guest, a new image id every node
     must accept. Phase-1-sized.

## Guards

- A ballot from a non-member (proof against another root) is not counted; control.
- Two ballots with the same nullifier count once; control.
- The tally page names no key and no nullifier beyond the 4-hex daily ID.
- Wording guard: no "nobody can see your IP"-type claim (privacy guard covers it).

## Decided (2026-10-08)

- Gap 1: **option A**, the node accepts per-poll member roots.
- Gap 2: **option A**, a poll closes at the end of the UTC day it opens.

## Open

- Who can see results before the poll closes: everyone, or nobody until close?

Size: node PR (poll roots, with tests and controls) + UI PR.
