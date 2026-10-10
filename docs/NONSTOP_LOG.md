# Non-stop run log

Started 2026-10-08 (after #70). Rules: one PR per item, stacked where needed; nothing merged to
main, nothing deployed; stop on a security issue or an unexplained test failure; every guard stays
green; the Mac runs under `caffeinate -dimsu`.

Order: landing v2 → signature badge + proof codes → members-only poll → site builder + site
language v1 → TetSearch (plan + ranking + vouch accountability) → Play corner → (a) → pass 12 →
(b)…(r).

## Built

| item | PR | stacked on | notes |
|---|---|---|---|
| 1. landing v2 (home: logo, search, four links, live stream; How it works behind a link) | #71 | #70 | search over public threads works today (try_search_guard); e2e 360/1280 light/dark |
| (security) anonymous receipts count only from the pinned membership program | #73 | main | found during item 3; private write-up in TET-OS-security; not deployed |
| 4. site builder + site language v1 | #76 | #74 | signed edit chains on the node, verified in the reader's tab; six blocks; deterministic, script-free renderer; export; try_site_guard; e2e; screenshots |
| 5. signature search + TetSearch vouch wording guard | #77 | #76 | public signature registry with signer consent; search by code/file/signer/date; members-only index waits for vouching |
| landing feedback: home v3 (centred, alone) + live strip of real raw blocks | #71 (merged up into #72, #74) | — | new public route `GET /explorer/blocks/recent` (allow-list + Caddy + test + control); screenshots en/ja × phone/desktop × light/dark |
| landing feedback round 3: tagline, What is TET, results-style inner pages, "0 ·" fix, human time | #71 (merged up through #76) | — | screenshots en/ja × phone/desktop; i18n guard caught one missing key on #72 after a merge (fixed the same hour) |
| home wordmark variants A/B/C (not shipped) | #75 (draft) | main | docs/brand/home-variants/; waiting for the founder's pick |
| 3. members-only poll | #74 | #72 + #73 | node builds each poll's root from its own registry; poll wallet takes only its own root; try_poll_guard; real-prover e2e; screenshots |
| 2. signature badge + proof codes | #72 | #71 | hash-only records as files to a signatures board; code = 40 bits of the record hash = start of its file id; try_badge_guard; e2e both widths |

## Decisions made for the founder

- **Proof codes are lookup handles, not proofs.** A short code (≈40 bits) can be collided by
  someone willing to spend the compute, so a code only *finds* published signatures; the page then
  verifies the full signature and lists every match. Wording: "the code finds it; the signature
  proves it". Never called a key.
- **What a proof code publishes:** a hash-only signature record (the file's SHA-256 and the
  signer's keys), never the file itself, so a code can be looked up publicly without exposing the
  file.

- **Proof code format:** `TET-XXXX-XXXX` (8 Crockford base32 characters, 40 bits) instead of the
  6-character example, for fewer accidental collisions; still only a lookup handle.
- **Where proof codes live today:** a public "signatures" board on the demo node, so the demo's
  board limits apply (a record is kept 7 days, the newest 5 per signer); the page says so. Lasting
  storage comes with the site store.
- **Hash-only signatures:** the badge signs the file's SHA-256 (`application/vnd.tet.sha256`), never
  the file; Verify accepts such a signature only for a file that hashes to exactly that value.

- **Proof-code records are files, not board posts:** a record is ~5 KB, over the 4,096-character
  post limit. The record's file id is its hash, so a code lookup fetches one file (fetching every
  record hit the node's read rate limit in the e2e).
- **The home view reads public boards only when someone searches for words** (same rate-limit
  reason).

- **TetSearch vouch accountability numbers** (proposals): two moderators who aren't the reporter;
  one appeal within 14 days to a moderator not on the decision; a second confirmed case from the
  same voucher removes their publishing rights for 90 days.

## STOPPED (2026-10-08, during item 3)

Stopped under the run's rule: a security issue was found while surveying the anonymous-proof path
for the members-only poll. Class level only here (details go to TET-OS-security if the founder
agrees): the anonymous-Tmail verification does not pin which zero-knowledge program a proof came
from. The consensus path (VerifyZkProof) does. Nothing for item 3 was committed; branch `try-poll`
is empty. Item 5's plan text is on #64; its wording-guard code is not written yet.

- **Resumed after the stop** (founder chose: write-up, fix, then resume). The pinned program id is
  the one the prover built from this repo returns, and a real-guest build matches it; zk-real now
  fails if they ever diverge.
- **Members-only poll design (#74):** a poll has its own wallet; ballots are anonymous posts to
  it; the creator signs (with the poll wallet) a list of member **wallet ids**, and **the node**
  builds the root from its own registry — the first draft let the creator send a root, which would
  have let any wallet invent members (caught by the background review before any push; fixed with
  a test and control). A poll wallet accepts only its own root (caught while writing the e2e: the
  draft also accepted the anonymity-set root). The poll closes at 00:00 UTC on its day. **Poll
  roots are node-local in v1.** The post carries only the member count (a list wouldn't fit in
  4,096 characters); voters take the list from the node. The member list is public, and the page
  says so.
- **#74 after the background review (second commit):** a real close (ballot checked on the poll's
  day only); a poll's wallet stores only verified ballots (named mail and unverified proofs refused
  before storing, REST and gossip) and keeps all of them; open polls registered too; members-only
  needs at least 3; the box says a vote is hidden only among the listed members, the maker chose the
  list, timing can give a vote away. I treated these as fixes to my own unmerged code, not as a
  stop: nothing affected was merged or deployed.
- **Live strip: no producer signatures shown, because blocks have none.** Blocks carry no producer
  signature yet (the Phase 1 header change, already documented in p2p.rs, mitigated on followers by
  TET_PRODUCER_PEERS; backfill is content-addressed from an authenticated head). Known, not a new
  finding, so not a stop. The strip says so and shows each tx signer's ed25519 + ML-DSA-44
  signatures instead; the route says `producer_signed: false`. Proof codes aren't on chain (they're
  files), so the strip never shows one.
- **"continue" line:** the remember/open/forget-key forms moved behind one small "key options"
  link (unchanged behaviour), so home keeps one small line under the links.
- **Hong Kong Chinese style:** the page's existing zh-HK is formal written Chinese; my first poll
  strings were colloquial Cantonese. Rewritten to match (#74).
- **Wordmark variants palette (A):** TET has no colour palette (the logo is black and white), so A
  uses the page's own verdict colours (indigo named, forest verified, oxblood refused).
- **Sites (item 4) — decisions:** images inline in the site store (counted against the site's
  quota; Files expire in 7 days); pages at `/s/<site>` on the same host; three fixed templates
  (plain, paper, terminal); v1 ships **public pages + export**, members-only pages after (they need
  a member-key distribution design). After the background review: edits are charged to the per-IP
  daily upload budget (same as Files), the store has a node-wide byte cap (512 MiB), quotas count
  each edit as stored (signatures included), and **sites expire 30 days after their last edit**
  (any edit renews; expired sites are pruned when the store fills) so a filled store can't lock
  everyone out for good. The page says so; the export is the lasting copy.
- **A poll shows as a poll only as a named post by the thread's own author** ("options set by the
  thread's author"), so nobody can drop a fake poll into someone else's thread.
- **Screenshots from `next start`:** the local `next dev` stopped hydrating in headless Chrome
  (with or without the branch's changes); the production build is fine.

## Founder instructions received during the run

- **2026-10-08, for item 5 (TetSearch): signature search, in the plan and built.** Search by proof
  code; by dropped file (hash computed in the browser, the file is never uploaded); by signer
  (public signatures only); by date. Only signatures the signer chose to make public are listed;
  anonymous signatures stay unlinkable. Dropped-file search finds exact files only, and the screen
  says "re-compressed or edited copies won't match".

- **2026-10-08, landing feedback (apply to #71, then continue):** home only, without the sidebar
  and the right "this node" panel; a larger logo, "TET v0.2 · testnet" and the search box centred
  both ways; under it the four links, then "continue: <last board>" on one small line. The live
  chain moves to a monospace strip at the bottom, above the IP footer. Inner pages keep the
  sidebar. "This node" details sit behind a small footer link. Screenshots: phone + desktop,
  ja + en.
- **2026-10-08, live strip = real raw chain data:** 4–6 monospace lines. Each new block pushes
  lines up: height, hash, prev, state root, tx count, timestamp, the producer's ed25519 and
  ML-DSA-44 signatures (shortened), and each tx's short id + kind (+ proof code for signatures).
  The prev hash visibly matches the previous block's hash. Real data only: no fake hashes, no
  filler animation; the strip stays still with no new block, and says so when the node is down.
  Public header and tx metadata only. Any new route goes on the node and Caddy allow-lists,
  rate-limited, with a test.
- **2026-10-08, wordmark exploration (don't ship until picked):** three centred-home variants
  (A 1999 search-engine serif in TET's palette, never another brand's; B hacker terminal; C modern
  minimal), desktop + phone, light + dark, live strip monospace in all; free self-hosted OFL fonts
  with Japanese fallback, no Inter; the logo checked beside each; in docs/brand/home-variants/.

- **2026-10-08, landing feedback round 3 (apply to #71):** a tagline above the search box; links
  "What is TET · Try · Sign · Verify"; a new "What is TET" page (one column, plain text: what, why
  now, works today with proves/doesn't, how it differs (true claims only), roadmap with genesis
  target Q1 2027 labelled as a target, who builds it); inner pages as a single results-style
  column (top bar: small logo + search + compact wallet line; breadcrumb; no sidebars; node
  details behind the footer link; "back to top"); boards as a plain one-line-per-board directory;
  fix the "0 · お知らせ" title on Sign; human time next to the raw ms in the strip. Screenshots
  ja + en, phone + desktop.

- **2026-10-08:** FinalSpark note added to docs/FUTURE_IDEAS.md idea #12 (科学の検証層). That file
  is gitignored, so the change is local only.
- **Item 5 scope (decision):** TetSearch's members-only index needs the vouching flow first (the
  plan says so); this PR ships the vouch wording guard and the signature search the founder asked
  for. Signature search needs a real index (the #72 records are encrypted files on a board: only
  the newest 20 can be scanned), so records move to a **public signature registry** on the node:
  publish = the signer's explicit act; search by code, file hash, signer, date; readers re-verify.

- **2026-10-08, What is TET round 2 (#71):** a comparison table vs Bitcoin and Ethereum (true
  claims only, never "first"; QRL named; the combination), "Where TET is weaker today", "This demo
  shows only part of what TET can do.", roadmap Phase 0 / Phase 1 (Q1 2027 target) then phases 2–10
  as an undated vision, "Get involved" (GitHub issues/PRs; hello@stevenexus.org; volunteer line; no
  personal details). Guard: no "first", no dates beyond Phase 1, with controls.
  **GitHub Discussions is disabled on the repo**, so the page links Issues and PRs only; enable it
  (Settings → General → Features → Discussions) and the link can be added.
- **2026-10-08, next after the landing work — plain-language pass:** 2ch-style boards (thread list →
  thread with numbered posts, name, date, text, >>N; reply box at the bottom: name (blank =
  名無しさん / Anonymous), text, Post; the key made silently on first post; "keep this identity?
  save your 12 words" only on a second visit or on request; all limits and guards kept); home lists
  the 5–10 newest public threads (real data); plain words in en/ja/zh (wallet → "your ID", key /
  12 words → "passphrase (12 words)", sign → "mark as genuine", .sig.json → "proof file", never
  "nullifier"; technical terms stay on How it works); title "TET v0.2" + a small "trial" badge
  (ja: 試験運用中); Terms and footer say "This is a testnet. Data may be reset."; "testnet" stays
  in Terms, FAQ and the money line.

- **2026-10-08, after the plain-language pass:** (1) a "What's inside TET" page (home link
  "Inside"): a Yahoo-style directory with real live counts — blocks, boards (public / invite-only
  as a count only, never names or content), threads, posts, signatures, files, sites ("coming") —
  each row linking to its list, with the time of the counts; next to each type, where it's stored
  and for how long (on chain forever / node storage, expires after N days / browser only), read
  from the real config, with a test that the shown retention matches the config. (2) Home lists:
  newest threads now; newest sites when the builder lands; both move to TetSearch when it exists;
  never show an empty list (hide until there's data).

## PRIORITY CHANGE (2026-10-08, founder)

TET's headline feature is "mark as genuine + proof code"; everything else is secondary until it's
excellent and public. New order:
1. Finish the "証明が通らず" security investigation — **done: fix #78** (not deployed).
2. Proof-code flow polished end to end: file or text → "mark as genuine" → proof code + QR + share
   link → anyone types the code in the home search or drops the file → "who, when, what" in plain
   words; one changed byte → a clear red "doesn't match". Phone and desktop; a 10-second demo; no
   jargon.
2b. **Sealed prediction** (the fun headline, right after the proof-code flow; same mechanism:
   commit now, reveal later): write a prediction, choose a reveal date (1–30 days on this node; say
   the limit); only the hash is recorded, the text stays hidden. A shareable card image (for X):
   "sealed · block #N · opens <date>" + proof code + link, never the hidden text. On the reveal date
   the author (or anyone with the reveal link) publishes the text: "written at <time>, unchanged" in
   green, red if it doesn't match. Japanese-first copy; hashtag #TET予言. Proves: this exact text
   existed at that block and wasn't changed. Doesn't prove: that the prediction was right, or that
   the author didn't seal many different predictions — said plainly on the card page. Same Terms
   and operator-hide rules.
3. Home: the one line + the search box make this the obvious first action; one example link "try
   it: verify this sample" with a real signed sample.
4. Pre-launch cleanup: remove test boards; check every page in ja/en.
5. Then the rest: plain-language boards, Inside page, FAST_ANON_POSTING design doc (stop for
   review), site builder, TetSearch, Play corner, …

| plain language: 2ch-style boards, newest threads, plain words, trial badge | #83 | #81 | anonymous stays the default (security review: the named default was reverted); names never ride on anonymous posts; names are an allowlist of fixed code-point ranges (ASCII, kana, CJK, Hangul) after three review rounds on blocklists — decision: Cyrillic/Greek names show as 名無しさん; try_plain_guard |
| What's inside TET: live counts, retention from the node's settings | #84 | #83 | GET /stats/inside (Caddy allowlist entry is an operator step); Rust test + control; try_inside_guard |
| fast anonymous posting — design doc only (stops for review) | #82 (draft) | main | one proof per board per day; key re-derivable; threat model; tests listed |
| 4. pre-launch: checklist, list_public_boards.mjs, Terms for marks/seals, ja/en sweep | #81 | #80 | hiding the demo's test boards is the operator's step (host unreachable from here) |
| 2b. sealed prediction (#TET予言) | #80 | #79 | card (no hidden text), private reveal link, green/red reveal; try_seal_guard |
| 2–3. mark as genuine: proof-code flow end to end + sample + plain words | #79 | #77 | 10-second demo screenshots; try_genuine_guard; registry review fixes |
| (security) anonymous posts whose proof fails are never kept, served or relayed | #78 | main | private note ANON_UNVERIFIED_STORED.md; real-prover e2e |

- **#78 got five follow-ups from the background review** (release on failed store; race;
  blocking lock; cancellation; "keep root-unknown" reversed to "delete without tombstone"), each
  with a test and control; the real-prover e2e passes after each.
- **Sealed prediction "block #N" (decision):** registry records carry the node's time, not a block;
  the card shows the chain height at sealing as context, and the proves line says "existed when
  this node recorded it". Anchoring on chain (a stamp tx) would make it a block proof — proposed as
  a follow-up, not claimed now.

## STOPPED (2026-10-08, second time: anonymous posts) — resolved by #78

Stopped under the run's rule, at the founder's request to investigate a board post labelled
"proof failed". Class level only here (details in TET-OS-security `ANON_UNVERIFIED_STORED.md`):
the node keeps, serves and relays anonymous posts whose proof doesn't verify, labelled "failed".
The screenshot's case was a member's second anonymous post on the same board on the same UTC day
(correctly refused as a repeat, but still kept and shown). Nothing is fixed yet; waiting for the
founder's decision. FAST_ANON_POSTING.md (design doc only) is also waiting.

- **#77 background review, not yet handled:** two more findings on sigs.rs ("logic/integrity",
  "resource-exhaustion"); details not delivered. To look at when work resumes.
- **First-load flash fix** committed on #71's branch (home from the first paint), not yet pushed.

## Open review items

- **#76 "authorization-bypass in handlers/sites.rs"** (background review, details not delivered):
  audited by hand — the operator-hide check runs on every write and read with the same id
  normalisation as everywhere else, and the signer must equal the site; I couldn't reproduce a
  bypass. Flagged for the founder's review rather than guessed at.
- **#76 "integrity rollback"** (fixed, f1cce3a): a node can serve a valid *prefix* of a site's
  chain (an older version) by withholding newer edits; signatures can't prove recency. The reader
  now sees the last edit's signed time and the version, and the page says a node can withhold newer
  edits (compare the version with the owner); try_site_guard keeps that line.
- **"0 · お知らせ"**: not a counter bug — the pinned notice was deliberately styled as post #0 of a
  board's rules (2ch style). Read as a bug, so the "0 ·" is gone.
- **What is TET wording:** "one person builds TET" (matches the existing "Run by one person" line);
  no founder name; genesis "target Q1 2027 … not a promise".

## Pre-launch (before the demo goes public)

- Test boards (e.g. "desktop public ctx8f") must not appear in the public directory: hide them
  with the operator command, or start the demo's directory fresh.

## Left

6. Play corner → (a) → pass 12 → (b)…(r).

## 2026-10-09 — paused new features (founder)

- Decisions: anonymous stays the default posting mode; named posting stays an option. GitHub
  Discussions enabled; linked under "Get involved" (#84, guard + control).
- #71's first-load fix (094791c) pushed and merged up through #84.
- #78 merged into the poll stack at #74 (real conflict: ballot refusals via `send_anonymous` would
  have been a 500; now `AnonSendError::Ballot` → 403, test + control), then up through #84.
  Full tet-core suite at the top: 355 passed.
- docs/REVIEW_GUIDE.md (in #84): merge order #73, #78, #70, then #71→#84; drafts #75, #82 not
  merged; 15-minute ja click-through. Merge after founder review, each when CI is green.
- Next goal after the merge: open the demo server (operator steps), not features.

## 2026-10-09 — security deploy + headline

- #73 and #78 merged after CI (#78 re-tested with #73 on main first: 340 passed, CI green).
- Deployed f5f968a: Helsinki 07:11 UTC, Nuremberg 07:59 UTC. Nuremberg's SSH dropped mid-transfer
  once (tree half-extracted, node untouched); retried the identical step via scp + sha256 +
  systemd-run (judgment call: network drop, not a code problem; reported).
- Verified on both seeds: same-day repeat anonymous post refused (403 replay), not stored or
  relayed; first post verified on both; heights/roots match; monitors OK.
- SECURITY.md Fixed entry (#85, merged). Private notes ANON_UNVERIFIED_STORED / ANON_PROGRAM_ID
  removed per their own rule (git history keeps them).
- Merge commits show the noreply address: the email setting works.
- #86: home headline; "10 seconds" measured (worst 2.6 s machine time, laptop JP→DE profile);
  guard against "proves you made it" / 「作ったことを証明」.

## 2026-10-09 — STOPPED: security finding (details in TET-OS-security only)

- Paper work paused. While gathering facts for the technical paper, code reading showed a gap in
  how followers authenticate blocks received during sync (class: block source authentication).
  Not tested against the live seeds. Private note: TET-OS-security CATCHUP_SYNC_UNPINNED.md
  (commit 1bca592), with fix options. Waiting for the founder's decision.
- Before the stop, on try-paper (local, not pushed): commit 7c3c173 — Kyber Round 3 never called
  ML-KEM (kem_wording_guard), quantum resistance stated as incomplete until Phase 1, "Built by
  Steve" + founder_privacy_guard.

## 2026-10-09 — security fix deployed (founder: "fix now")

- #88 merged (CI green) and deployed: Helsinki 14:11, Nuremberg 14:25 UTC (8239d10), via scp +
  sha256 + detached systemd build. Verified: trust lines in logs, Nuremberg catches up from the
  pinned producer, heights/roots match, monitors OK. SECURITY.md Fixed entry: #89 (merged). Private
  note retired.
- Side effect (not security): Helsinki now reports synced=false and waits the 120 s restart grace
  before producing peerless. Follow-up to propose, not fixed at night.
- Queued from the founder: Shelter design doc (stop for review), AI access policy (site + plan),
  then resume the technical paper.

## 2026-10-09 — Shelter plan, AI access policy, technical paper

- #90 (draft): docs/plans/SHELTER.md + AI access policy — stops for founder review.
- #91 (stacked on #87): honest crypto/founder wording (kem_wording_guard, founder_privacy_guard,
  quantum incomplete until wallet_id_v2) + AI access policy on the site (deploy/ai-crawlers.txt →
  robots.txt + Caddy 403; FAQ "AI and TET"; ai_crawlers_guard, try_ai_wording_guard). Found: the
  site claimed a robots.txt that didn't exist.
- #92 (stacked on #91): technical paper at /whitepaper (written against 04667cd), PDF with the
  text's code TET-W78E-P3YG on its last page, PDF code TET-P76S-BC21; publisher ID at
  ~/.tet/tet-publisher.words; publish both marks when the demo opens (paper_publish_marks.mjs).
  paper_guard in CI.
- Open follow-up: Helsinki reports synced=false and waits the 120 s grace after a restart (side
  effect of #88) — propose a fix for review.

## 2026-10-09 late — keys, tokens, flood guard, CI

- Publisher key replaced by the founder (new_publisher_key.mjs, run in their own terminal);
  paper re-marked: text TET-418B-CFT2, PDF TET-QQGQ-B5MM (#92); old key file deleted.
- #93 (draft): testnet rewards experiment design — stops for review.
- #94 (stacked on #92): testnet balance "N TET (practice unit, can't be exchanged for money)" in
  the ID area + money-guard check; invisible board flood guard (5 instant, then 3 s) + guard.
- Shelter plan (#90) updated: no visible per-minute limit. FUTURE_IDEAS (local): mainnet supply
  options (needs legal advice before genesis) and the Phase 9 activity idea (Sybil risk).
- Found: seed-liveness red since Oct 7 because of the never-pinged tet-demo check (seeds up) →
  #95 (--not-yet-live; green on the branch with real data).
- Found: CI docker/shell jobs blocked by Docker Hub's anonymous pull limit → #96 (mirror.gcr.io;
  all 6 checks green). #92 and #94 need #96 merged in to go green.

## 2026-10-10 — STOPPED: security finding in deployed code (details in TET-OS-security only)

- #95 and #96 merged (founder said yes). Then non-stop item 1: fast anonymous posting — design
  review (5 fixes, on #82), node side built with tests (6 tests, 5 controls), page side in progress.
- The background review of that WIP flagged (a) an expiry parsing bug in my new code (unmerged;
  will be fixed) and (b) a class of issue in how anonymous posts are grouped for retention, which a
  unit test confirmed on main's code (deployed). Private note: TET-OS-security
  ANON_RETENTION_UNVERIFIED_GROUPING.md. Stopped; waiting for the founder.

## 2026-10-10 — security fix deployed (founder: "fix now and deploy")

- #98 (only a verified nullifier groups anonymous posts for retention; test + control) merged and
  deployed: Helsinki 23:21, Nuremberg 23:33 UTC (39036cf). Verified: heights/roots match, monitors
  OK, anonymous posting end to end on both seeds (verified, relayed, repeat refused).
- SECURITY.md Fixed entry: #99 (merged). Private note retired.
- Resuming non-stop item 1 (fast anonymous posting), which adopts the same verified-only grouping.

## 2026-10-10 — item 1 done: fast anonymous posting (#100)

- #100 (stacked on #94): implements #82 with its five review changes; members-only key question;
  prewarm asks the node nothing; in-memory "registered today". Tests: 7 tet-core (controls run),
  full suite 364; anon_poster_guard additions (control run); e2e with real prover on two nodes.
- Next: item 2, Shelter (#90) with the founder's decisions. Decision taken: "me + ~10 invitees"
  = the moderator's own invites (up to 10, the plan's "first members"); after that, vouches (3 each).

## 2026-10-10 — Shelter (item 2), node side

- Plan section "Implementation v1" (founder decisions) on try-shelter; node: records/replay,
  members-only reads, no gossip, Shelter's own anon root, flood guard, sealed board keys.
- Background security review flagged 5 issues in my unmerged Shelter commits (nickname
  look-alikes, roots refresh race/fail-open, record replay, sealed-key sender and replay). All fixed
  in 52fa6fc with tests and controls. Not deployed code; nothing on main affected.
- Full suite 375 passed. Next: the page (ShelterPanel), translations, guards, e2e.
- Third background review: 2 more in my unmerged Shelter code (nickname look-alike gaps; leaving
  before a case dodged it). Fixed with tests/controls (see branch log). Full suite 376.

## 2026-10-10 — STOPPED: security issue in deployed code

- While fixing a background-review finding in the unmerged Shelter page code, found the same class
  in deployed code (DMs/files). Details: TET-OS-security, CLIENT_KEY_REGISTRATION_UNVERIFIED.md.
- Stopped per the standing rule. Nothing merged or deployed. try-shelter kept local (not pushed):
  its page code has the same pattern, and two review findings on it are open (noted in that file).
- Shelter node side: done, tests 13 + controls; page built; e2e not run yet.

## 2026-10-10 — security fix deployed (founder: "Fix now and deploy")

- #101 (v2 PAE-signed key registrations only; browser verifies recipient keys and senders; safety
  numbers; wording qualified) merged as bea1e45 and deployed: Helsinki 08:57, Nuremberg 09:09 UTC.
  Verified: heights/roots match, monitors OK; live on both seeds: older registration refused, v2
  accepted and trusted, DM sender verified.
- SECURITY.md entry #102 merged. Private note retired.
- Shelter plan (#90 branch) qualified. Remaining wording: the paper (try-paper2) and try-shelter
  page strings, done with the Shelter page rebuild and the paper re-mark.
- Queued from the founder's messages: log seal (#12), community track (#13), Verify without TET
  (#14, next), TETtalk plan (#15), Sign in with TET additions (#16), positioning line (#17),
  threat model + 11 rules (#18), paper v2 outline (#19).

## 2026-10-10 (CEST afternoon) — after the deploy

- Dates corrected: 39036cf went live 2026-10-09 23:21 UTC; bea1e45 2026-10-10 08:57 UTC (#103 PR).
- Review server: ~/Nexus_Network-review worktree at #94 (try-balance 8658967), own node build;
  local nodes 5010/5020 and UI 3200 serve it. My branch switches don't touch it.
- verify-offline: main merged into the stack top (plain guard fixed by rewording), then Verify
  without TET Level 1 (#104): offline HTML + CLI, marked TET-PC94-EC1K / TET-MXEQ-X7T9.
- Rule 10 added: nightly routine prompt (Hard limits), local CLAUDE.md; CONTRIBUTING/THREAT_MODEL
  when written.
- Next: Shelter page on the key-trust fix (try-shelter), threat model (#18), paper v2 outline (#19).
- Shelter #105 (stacked on #100): rebuilt on the key-trust fix; shelter_guard (2 controls); e2e on
  a real node + prover passed (scripts/try_shelter_e2e.mjs). Full suite 379. Not merged.
- Next: threat model + 11 rules (#18), then paper v2 outline (#19, stop for review).
- Threat model #106 (stacked on #105): THREAT_MODEL.md; rules 6–11 with guards and controls;
  SRI only partial with Next (stated); private infra issues #1–#8. #97 updated with rules 1–5 and
  the sign-in additions. Next: paper v2 outline (#19), then stop for review on that item.
- Paper v2 outline: draft #107 — stopped on that item for the founder's review.
- Positioning line on What is TET: #108.
- Remaining queue: rewards (#93), Verify without TET Level 2, site builder/site language → TetSearch,
  log seal idea, community track, TETtalk plan (after demo).

## 2026-10-10 (CEST evening) — STOPPED: security issue in deployed code

- Found while running the welcome-grant e2e: one invalid transaction makes the producer drop every
  pending transaction (deployed on both seeds). Details: TET-OS-security,
  PRODUCER_DROPS_MEMPOOL_ON_INVALID_TX.md. Stopped per the rule; nothing deployed or merged
  (except #111, the founder's explicit "delete the preview PNGs now", after CI).
- Done before the stop: tetnet.org (#110), launch checklist (#109, updated), paper v2 written and
  marked (#107: TET-ZSK3-VQ1J / TET-YJ9J-TS4Z), Sign in with TET example URL (#97), rewards WIP on
  branch `rewards` (welcome grant node+page+tests; e2e: proof+claim OK, mining blocked by the
  fee_bps issue — fixed in the grant code; general issue open).
- Demo host: SSH 22 blocked from this network; 167.233.31.223 (DNS) answers on no port even from a
  seed; 167.233.239.82 looks like the unprovisioned demo host. Founder to check Hetzner.
- Queued from the founder: ID cards + DM from verified signer; language completeness (stop after
  ja paper draft); repo front door PR.
- Open review finding (rewards WIP, not deployed): the grant payer's balance check ignores grants already sent but not yet mined (fix: reserve pending grants).
