# TETtalk: plan

Status: **plan only, no code.** A forum about TET, running on TET (in the spirit of bitcointalk).
After the demo launch.

## What it is

- **Fixed sections:** Announcements, Development, Ideas, Help, Off-topic. A section is a board with a
  public invite, listed on the TETtalk page.
- **Announcements** shows only posts marked with TET's publisher key (the key that marks the
  paper). Anyone's post to that board that isn't marked is not shown there.
- **Posting, as on boards today:** named (marked, with the ID card and DM from #113) or anonymous
  (a daily ID, fast anonymous posting). Threads, replies, `>>n` references, polls by the thread's
  starter.
- **Wording, everywhere TETtalk describes anonymous posts:** "Posts aren't linked to your key; the
  node sees your IP (not logged); use Tor to hide it." Never "completely anonymous".
- **Discord stays for chat;** TETtalk links to it and Discord links back.

## Long retention, for TETtalk only

Boards keep posts 7 days today. TETtalk is meant to be a record, so:

1. **Content kept long-term** in a TETtalk store on the node: posts to the five section boards are
   kept beyond the board TTL, under a size quota (per section and per author per day), like the site
   store. Nothing else on the node changes its retention.
2. **Replicable:** any node can mirror TETtalk: an export of the store (posts as signed, with their
   proofs) and an import that re-checks every signature and proof before keeping anything. Later,
   a gossip topic for TETtalk posts.
3. **Hashes on chain:** once a day, the node anchors the day's TETtalk posts: the SHA-256 of each
   post envelope goes into a Merkle tree, and the tree's root is stamped on chain (one transaction a
   day, not one per post). A post's inclusion can then be checked offline against that day's root,
   the same way Verify Level 2 checks a stamp.
4. **The Inside page states the real retention:** how long TETtalk posts are kept, the quota, and
   that copies on other nodes are beyond this node's control.

## Moderation

- **Operator hide and the takedown contact still apply** to TETtalk: hiding removes a post from this
  node's public API and from exports; the hash already anchored on chain stays (it reveals nothing
  about the content), and the moderation log records the hide.
- A mirror that imports TETtalk also imports the hide list, so a hidden post isn't re-served by
  honest mirrors. A mirror run by someone else is their responsibility; the page says so.

## Steps

1. The TETtalk page: the five sections as listed boards; Announcements filtered to publisher-marked
   posts; the wording lines; links to and from Discord. Uses only what exists (boards, fast
   anonymous posting, ID cards).
2. The TETtalk store (node): long retention with quotas, operator hide applied, export/import with
   full re-checks. Tests with controls (a forged post refused on import; a hidden post not exported;
   the quota holds).
3. The daily anchor: the Merkle root of the day's post hashes stamped on chain; an inclusion check
   in the offline verifier. Tests with controls.
4. The Inside page's retention lines.

## Tests (each with a negative control)

- Announcements: a post not marked by the publisher key isn't shown there.
- The wording guard: "completely anonymous" refused in en, ja and zh-HK; the required line present.
- Import: a post with a bad signature or proof is refused; a hidden post isn't exported.
- Anchor: a post's inclusion verifies against its day's root; a changed post doesn't.

## Open questions

1. The quota: per section and per author per day (suggestion: 10 posts per daily ID per section).
2. Who runs the daily anchor transaction (the demo node's own wallet, funded once from genesis)?
3. Should the first mirror be the Nuremberg seed?
