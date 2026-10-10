# Shelter: a members-only space away from AI (design, for review)

Status: **design only, no code.** It's queued after the demo launch and before the site builder.
It's built from pieces that already exist:
- invite-only boards and their end-to-end encryption;
- per-list member roots (members-only polls);
- the operator log (operator hide);
- the vouch-accountability rules in `docs/plans/TETSEARCH.md`.

## What it is, in one paragraph

Shelter is an invite-only space where members post to each other. You join only through an
in-person vouch from a member, and each member can vouch for at most 3 people. Posts are
end-to-end encrypted to members, so neither outside AI nor the node operator can read them. The
public API never serves them, and AI crawlers are refused at the door. On entry, the house rule
reads: **"Don't post AI-written text here."** It's a promise members make to each other, not
something TET detects.

- **Proves:** a vouched member wrote each post, and the space isn't open to outside AI crawlers.
- **Doesn't prove:**
  - that no AI was used: a member can still paste AI-written text;
  - that members won't copy posts out.

## Wording (guarded)

- **Say:** "Members-only and end-to-end encrypted. Joining needs an in-person vouch. House rule:
  don't post AI-written text here."
- **Never:** "AI cannot enter", "AI-free guaranteed", "AI cannot access TET", "humans only,
  guaranteed", or any claim that TET detects AI.
- `try_ai_wording_guard` (new) enforces this across the UI, the docs and the i18n files, with a
  negative control. See also the AI access policy below.

## Pieces

### 1. Membership: in-person vouches, at most 3 each

- **The vouch record.** A vouch is a signed record (hybrid Ed25519 + ML-DSA-44, chain-bound like
  every other record):
  `tet shelter vouch v1|chain_id|genesis_hash|voucher|vouchee|met_in_person=true|date|mldsa_pk`.
  The vouchee's key is entered on the voucher's device: a QR from the vouchee's phone, scanned in
  person. The UI never offers a remote vouch flow.
- **Who decides membership.** The node keeps the member list (node-local in v1, like poll roots).
  - The first members are the founder's list, signed by the Shelter key (open question 1).
  - Everyone after that joins through a vouch.
  - The node refuses a fourth vouch from the same voucher. A vouch removed in an upheld appeal
    frees that slot.
- **The member root.** It's built by the node from the list, the same as `poll.rs` builds a
  members-only poll's root (MEMBERS_POLL.md option A), and it's used for anonymous posting (below).
- **Leaving.** A member can withdraw their own key, but the vouch still counts toward the voucher's 3.

### 2. Vouch accountability (from TETSEARCH.md, shared moderators)

- **The rule.** If moderation shows a vouched key is run by a bot:
  - the bot key is removed;
  - the voucher loses the right to vouch;
  - a second confirmed case from the same voucher suspends the voucher's posting for 90 days.
- **What "shown" means.** Evidence is written into the case, and two moderators who aren't the
  reporter must agree. Moderators' keys are listed to members.
- **Appeal.** One appeal within 14 days, decided by a moderator who wasn't on the first decision.
  New evidence counts, e.g. a fresh in-person vouch from a different member. If the appeal
  succeeds, everything is restored and the case is marked "overturned".
- **The log.** It works like `operator_hide.rs`: an append-only line per case, decision and appeal
  (case id, keys, decision, moderators, date, reason), written to the operator log and shown to
  members. Never the evidence's private content.
- **Documented in two places:** Terms, and a "How vouching works" page.

### 3. Content: encrypted, never on the public API

- **The space.** Shelter is an invite-only board, so posts are encrypted to the board key. Members
  receive the board key when they join (the vouch flow hands it over in person, next to the QR).
- **If the key leaks.** The Shelter key holder rotates it: a new board, members are re-keyed, and
  the old one is closed. That's an operator step, documented.
- **Reads are members-only.** The board's inbox route refuses unless the request is signed by a
  member key, or carries a membership proof with a one-day session token, as in TetSearch. Even
  ciphertext isn't served publicly, because it would still reveal post counts and timing. The
  Shelter routes stay off the public allowlist except these member-gated ones. The gate gets a
  guard with a negative control, like the operator-hide routes.
- **Posting.** Named-to-members by default: other members see the poster's member ID, and the
  public sees nothing. Anonymous posting with a proof against the Shelter root is an option (open
  question 2).
- **Flood guard, invisible (founder, 2026-10-09).** There's no visible per-minute limit. A
  member's first 5 posts in a burst go out at once; after that, posts are spaced a few seconds
  apart (proposed: 3 s), silently. Normal conversation never hits it. On top of that:
  - a daily cap per member key (proposed: 100) stops scripted posting;
  - an anonymous post is capped by its nullifier, at one per day as today.

### 4. Keeping AI crawlers out (site-wide, see the policy below)

- robots.txt disallows AI training crawlers, and Caddy refuses them by user agent.
- Shelter pages and routes are members-only, so a crawler that ignores robots.txt still sees
  nothing.

### 5. On entry

A one-screen notice, shown on the first visit and then from a "house rule" link:
- **Heading:** 「ここに AI が書いた文章は載せないでください」 / "Don't post AI-written text here."
- **Then, as a promise between members:** "This is a promise between members, not a filter. TET
  can't tell who or what wrote a text."
- **The proves / doesn't-prove lines above.**
- **Who vouched for you:** your voucher's member ID.

## AI access policy (the whole site)

1. **Public pages.** `robots.txt` disallows AI training crawlers and allows normal search
   crawlers.
   - **The list lives in one file**, `deploy/ai-crawlers.txt`. Both `robots.txt` and the Caddy
     rule are generated from it.
   - **Starting list:** GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, Claude-Web, anthropic-ai,
     Google-Extended, CCBot, Applebot-Extended, PerplexityBot, Perplexity-User, Bytespider,
     Amazonbot, meta-externalagent, FacebookBot, cohere-ai, Diffbot, ImagesiftBot, Omgilibot,
     YouBot, Timpibot.
   - **Caddy refuses those user agents with 403**, and keeps per-IP bulk-read limits on the
     `/tet-node-api` routes (the read buckets in `public_api.rs`, plus a Caddy rate limit on page
     fetches).
2. **Members-only spaces** (Shelter, invite-only boards) are end-to-end encrypted, so neither
   outside AI nor the node operator can read them.
3. **Wording.** Say: "Members-only spaces are encrypted; public pages opt out of AI training
   crawlers that respect robots.txt." Never "AI cannot access TET". Guarded (`try_ai_wording_guard`,
   with a negative control).
4. **An "AI and TET" FAQ entry** with the honest limits:
   - robots.txt is a request; well-behaved crawlers follow it, others don't;
   - the user-agent block stops only crawlers that say who they are;
   - public chain data (blocks, transactions, public boards, published marks) can be read by
     anyone who runs a node, AI included;
   - only the members-only spaces are out of reach, because they're encrypted.

The site-side part of this policy (robots, Caddy, FAQ, guard) ships separately, as its own PR. It
doesn't wait for Shelter.

## Threat model

| Threat | What happens |
|---|---|
| A bot gets a key | It can't join without an in-person vouch. If a member vouches for one anyway, the accountability rules apply. |
| Vouch rings or bought vouches | 3 vouches each, accountability, and a public-to-members log. Not prevented, only limited and traceable. |
| A member pastes AI text | Not detected; the house rule is a promise. Stated on the page. |
| A member copies posts out | Not prevented. Stated on the page. |
| The node operator | Can't read posts (E2EE). Sees who reads and posts, when, and from which IP. |
| A crawler that ignores robots.txt | Gets nothing from Shelter: members-only routes and encrypted content. |
| A leaked board key | Ciphertext isn't public, but a member could pass on old posts. The key is rotated. |
| A compromised member device | That member's view is exposed. Out of scope. |

## Tests (each with a negative control)

- **Vouching:**
  - a fourth vouch from one voucher is refused;
  - a remote vouch with no in-person flag is refused;
  - a vouch signed by a non-member is refused.
- **Accountability:**
  - a confirmed bot case removes the voucher's right to vouch;
  - an upheld appeal restores everything;
  - every step writes one log line.
- **Content gate:**
  - an unsigned or non-member read of the Shelter inbox is refused;
  - the route is absent from the public allowlist;
  - the invisible flood guard holds: 5 posts instant, then spaced; normal conversation is never
    delayed;
  - the per-ID daily cap holds.
- **Crawlers:**
  - robots.txt and the Caddy rule list exactly the agents in `deploy/ai-crawlers.txt`;
  - a request with `GPTBot` gets 403, and one with `Googlebot` doesn't.
- **Wording:** `try_ai_wording_guard` catches "AI cannot enter", "AI-free guaranteed" and "AI
  cannot access TET" in en, ja and zh.

## Order

Demo launch → the AI access policy (site) → Shelter → the site builder.

## Open questions for the founder

1. Who are the first members, and who are the moderators (at least 3, so two can decide and one
   can hear an appeal)?
2. Should posting be named-to-members, as proposed, or anonymous with a daily ID? Named makes
   bot cases attributable; anonymous hides who posted from other members.
3. Is the daily cap right: 100 posts per member per day, behind the invisible flood guard?
4. Should the "Questions for humans" corner merge into Shelter, or stay separate?

## Implementation v1 (the founder's decisions, 2026-10-10)

The founder answered open questions 1–3:
- **Who:** the founder plus about 10 invitees.
- **Moderation:** the founder is the sole moderator.
- **Posting:** nicknames by default, anonymous optional.
- **Flood guard:** invisible.

v1 builds exactly this.

- **One Shelter per node, node-local.** Two settings switch it on:
  - `TET_SHELTER_MODERATOR`: the founder's wallet;
  - `TET_SHELTER_BOARD`: an invite-only board the founder created.

  With either one unset, Shelter is off and its routes answer 404. Shelter posts are **never
  gossiped**: a node doesn't send them, and refuses them from peers. So they exist only on the node
  that runs Shelter.
- **Members.** The moderator, plus at most **10 in-person invites** from the moderator. After that,
  each member can vouch in person for up to **3** people. Every step is a signed record
  (`tet shelter record v1`: hybrid, chain-bound, with `met_in_person=true` required for invites and
  vouches). The node replays the records in order to know who is a member, so the log *is* the
  membership.
- **One moderator, so the two-person rule waits.** The plan's rule ("two moderators who aren't the
  reporter agree; a different moderator hears the appeal") needs three moderators. In v1:
  - the founder decides cases **and** appeals alone;
  - the 14-day appeal window and the effects are unchanged;
  - every decision is a log line shown to members.

  This is weaker, and the "How vouching works" text says so. The two-person rule comes back once
  there are three moderators.
- **Accountability, as planned:**
  - a confirmed bot case removes that member;
  - their voucher loses the right to vouch;
  - a second active case against the same voucher suspends their posting for 90 days;
  - an appeal that overturns a case restores everything it took.

  The moderator's own invitees are the moderator's responsibility. There's no one above them to
  apply this to, and that's stated too.
- **Posting:**
  - **By nickname (default):** an ordinary signed post to the board, accepted only from a current,
    unsuspended member. Other members see the nickname. Nicknames are unique and listed to members
    only.
  - **Anonymous (optional):** a proof against **Shelter's own member root**, never the node's open
    anonymity set. The node builds that root from current, unsuspended members who have joined the
    anonymity registry, and the option needs at least 3 of them. When anyone leaves or is removed,
    earlier roots stop counting. Fast posting (#82) applies: one proof a day, then no proof.
- **Flood guard (invisible):** per member key, the first 5 posts go out at once, then one every 3 s,
  up to 100 a day. Nothing on the page shows a limit.
- **Reads are members-only.** Board posts, the member list, the log and the anonymous-set leaves are
  served only to a request signed by a current member's key, made within the last 2 minutes and
  bound to the route. `GET /tmail/inbox/<the Shelter board>` answers 403.
- **The board key, handed over after the vouch.** The voucher's page seals the board's invite to
  the new member's Tmail keys. It's an ordinary end-to-end encrypted envelope, and the node keeps
  it (`POST /shelter/key`).
  - **Who may set it:** only the member who let them in, the moderator, or the member themselves.
  - **Who gets it back:** only that member, in their own signed `/shelter/me`.
  - **What the node and the device see:** the node can't open it, and the device stores nothing,
    so a new tab gets the key back after unlocking the wallet.
- **The house rule** is shown the first time Shelter opens in a tab, and from a "house rule" link
  after that. It isn't remembered on the device, because a stored "seen" flag would show the
  device was in Shelter.
