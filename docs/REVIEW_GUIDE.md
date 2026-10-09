# Review guide: #70–#84

For the founder's review before the stack is merged. Each PR below has three short parts:
- what changed;
- what to click to see it;
- the risk.

Then there's a 15-minute click-through of the local site in Japanese.

Nothing here is merged or deployed. After your review, I merge in the order below, each PR only when its CI is green.

## Merge order

1. **#73** and **#78**: two security fixes based on `main`. **Both are merged and deployed on the seeds** (2026-10-09).
2. **#70**: the base of the stack. It's outside #71–#84, but #71 is built on it.
3. Then the stack, in order:

   **#71 → #72 → #74 → #76 → #77 → #79 → #80 → #81 → #83 → #84 → #86**

**How each PR is merged:**
- Merge commits, not squash, so each next PR's history still lines up.
- After a base PR merges, the next PR's base is switched to `main`.
- GitHub rejects `--author-email` on `gh pr merge`. Merge commits use the account's default email unless "Keep my email addresses private" is ticked in GitHub's email settings. Please check that before the first merge.

**Not merged:**
- **#75** is a draft. Pick a wordmark first.
- **#82** is a draft design doc for fast anonymous posting. It waits for your review; no code yet.
- **#62, #64, #68, #69** are outside this review.

## The PRs

**#73: anonymous posts count only from TET's own proving program.**
- **What changed:** the node accepts an anonymous proof only from the membership program pinned in the code; anything else is refused before any proof work.
- **To see it:** nothing to click. It's covered by tests.
- **Risk:** if a real build of the program ever gets a new id, every anonymous post is refused until that id is added. A test catches this on the real-program build, and the operator can add an id with `TET_ANON_ACCEPTED_IMAGE_IDS`. Details: TET-OS-security.

**#78: an anonymous post whose proof fails is never kept, shown or passed on.**
- **What changed:** this is the fix for the "証明が通らず" post. The node now checks the proof *before* storing. A failure is refused with the reason and nothing is kept; posts that arrived from other nodes are deleted once they fail.
- **To see it:** post anonymously twice on the same board on the same day. The second post is refused with a message.
- **Risk:** proof checks now run one at a time, which is slower under load. A post whose membership list this node hasn't seen yet is dropped, but can arrive again later.

**#70: the first landing page** (base of the stack).
- **What changed:** the first home screen: hero sentence, live lists of threads and blocks, a remembered-key option and dark mode.
- **To see it:** most of it is replaced by #71's home, so look at #71.
- **Risk:** low.

**#71: home v2 and "What is TET".**
- **What changed:**
  - home: logo, search box, links and a live block stream;
  - a "What is TET" page with a Bitcoin/Ethereum comparison, a roadmap (only Phase 1 is dated, and called a target), "Where TET is weaker today" and "Get involved";
  - the first-load fix: home shows from the first paint.
- **To see it:** open the site (it should go straight to home), then click TET とは.
- **Risk:** the wording is public claims. Read the comparison table and roadmap carefully; a guard blocks "first" and any date beyond Phase 1.

**#72: proof codes, first version.**
- **What changed:** marking a file gives a code `TET-XXXX-XXXX`, a QR and a link; the home search finds records by code.
- **To see it:** #79 polished this flow, so click through it there.
- **Risk:** low. Records hold only the file's fingerprint (SHA-256) and the signer's ID, never the file.

**#74: members-only anonymous polls.**
- **What changed:**
  - the thread's author can add a poll: one vote per member, closing at 00:00 UTC;
  - the tally counts only votes the node verified;
  - it also carries the merge of #78. A ballot the poll's rules refuse gets a clear "refused" answer with the reason (HTTP 403), not a server error.
- **To see it:** start a thread, then press 投票を追加.
- **Risk:** a vote is hidden only among the listed members. If the poll's maker controls most of those IDs, they can work out how the others voted; the page says so. The node still sees IP addresses.

**#76: sites ("thread-style site builder").**
- **What changed:** you build a page block by block. Each change is signed by the site's own passphrase, and readers check the whole chain in their own browser before showing anything.
- **To see it:** footer → サイト → 新しいサイトを作る → add a block → open it.
- **Risk:**
  - sites expire 30 days after their last edit;
  - a node can show an *older* version of a site, which signatures can't rule out, so the page shows when it was last signed.

**#77: signature search and the registry.**
- **What changed:** the node keeps a public list of marks whose signers chose to publish them. Search by code, file, signer or date. The file is fingerprinted in the browser and never uploaded.
- **To see it:** home → ファイルや日付で記録を探す.
- **Risk:**
  - published records don't expire on this node, though they can still be hidden by the operator;
  - publishing requires a second consent signature, so nobody can publish someone else's;
  - storage is capped.

**#79: "Mark as genuine", end to end.**
- **What changed:** this is the headline flow: file or text → one button → proof code, QR, link and proof file. Anyone can check by code or by dropping the file; a single changed byte shows a red "doesn't match". Home has a "try it" sample.
- **To see it:** home → 試してみる：このサンプルを確かめる.
- **Risk:** the demo's sample must be marked there by the operator (`make_sample.mjs`). Until then the sample link finds nothing.

**#80: sealed prediction (#TET予言).**
- **What changed:** you write a prediction and pick when it opens (1–30 days). Only its fingerprint is recorded. The shareable card shows the code and the opening date, never the text. The reveal link opens it later and shows green "written at …, unchanged" or red.
- **To see it:** home → 予言の封印.
- **Risk:** whoever has the reveal link can read the prediction, and a lost link can't be recovered. The page says both.

**#81: pre-launch.**
- **What changed:** a "Before going public" checklist in `deploy/demo/README`, a read-only script that lists public boards, and Terms lines for marks and seals.
- **To see it:** footer → 利用規約.
- **Risk:** none in code. The operator steps on the demo host are listed under "After the merge" below.

**#83: plain language and 2ch-style boards.**
- **What changed:**
  - plain words in en/ja/zh: ID, passphrase (12 words), inbox, device password;
  - the reply box has an optional name (blank = 名無しさん);
  - home lists the newest threads;
  - "TET v0.2" carries a 試験運用中 badge.
  - Anonymous posting stays the default; named posting is one tap away.
- **To see it:** home → 新着スレッド → a thread → 記名で投稿する → a name → 書き込む.
- **Risk:** names are limited to ASCII, kana, CJK and Hangul, so Cyrillic or Greek names show as 名無しさん. This came out of four security-review rounds on look-alike names.

**#84: "What's inside TET".**
- **What changed:**
  - a page of live counts (blocks, boards, threads, posts, marks, files, sites) with the time counted;
  - how long each kind is kept, read from the node's real settings;
  - a GitHub Discussions link under "Get involved", now that Discussions is on.
- **To see it:** home → TET の中身.
- **Risk:** the demo's Caddy allowlist gains `GET /tet-node-api/stats/inside` (already in `deploy/demo/Caddyfile`).

**#86: the home headline (stacked on #84).**
- **What changed:** 「AIで何でも作れる時代に。」「『これを、この日に出したのは自分』を、10秒で証明。」, with the limit right under it: 「証明できるのは『いつ・誰の印か』まで。作者本人かどうかまでは証明しません。」 The same in en and zh-HK.
- **To see it:** the home screen.
- **Risk:** "10秒" is a claim. `scripts/try_ten_seconds_e2e.mjs` measured pick file → mark → code shown, plus the verify lookup, at worst 2.6 s of machine time on a laptop profile in Japan using a node in Germany. That run used my local node with emulated latency, because the demo itself isn't reachable from here; re-run it against the demo once it's up. A guard bans "proves you made it" / 「作ったことを証明」 everywhere.

## 15-minute click-through (local site, Japanese)

Open **http://127.0.0.1:3200/try?lang=ja**. The local node, the UI (built from #84, the top of the stack) and the prover are all running.

1. **Home (1 min).** It goes straight to home with no flash of another page. Check:
   - "TET v0.2" with the 試験運用中 badge;
   - the search box;
   - 新着スレッド: real threads with reply count, board and time.
2. **Sample (2 min).**
   - Click 試してみる：このサンプルを確かめる: a green result appears, saying who, when and what.
   - Click サンプルファイルを確かめる: green 一致.
   - Click 1文字変えて、もう一度確かめる: red, doesn't match.
3. **Mark your own (2 min).**
   - Click 本物として記録, write a line of text and press the button.
   - You get a large code, a QR and a link.
   - Paste the code into the home search box: it finds your mark.
4. **Sealed prediction (2 min).**
   - Click 予言の封印, write a prediction, choose 1 day and press 封印する.
   - The card shows the code, the block number and the opening date, but no text.
   - Click 公開用リンクをコピー and open the link in a new tab: green "written at …, unchanged", plus a note that it was opened before its date.
5. **Board (3 min).**
   - Click a thread under 新着スレッド.
   - Each post shows its number, name (or 名無しさん), ID, time and text.
   - At the bottom, 匿名セットに参加する is the default; click 記名で投稿する.
   - Type a name and some text, then press 書き込む (or Ctrl+Enter). Your post appears with your name and ID.
   - Tap your ID in the top bar: it offers to save your passphrase (12 words).
6. **Poll (optional, 1 min).** In a thread you started, click 投票を追加.
7. **Inside (1 min).** Click TET の中身. You'll see counts with the time they were taken, and how long each kind is kept (投稿 7日間（最長 30日間） and so on).
8. **What is TET (1 min).** Click TET とは. Read the comparison table and the roadmap. Under 参加するには, the ディスカッション link opens GitHub Discussions.
9. **Terms and footer (1 min).**
   - The footer says これはテストネットです。データはリセットされることがあります。
   - Click 利用規約: it covers marks and seals.
10. **Site (1 min).** Footer → サイト → 新しいサイトを作る → add one block → open it.
11. **Phone and English (1 min).**
    - Open the browser's device mode at 390 px wide and repeat steps 1 and 5.
    - Switch 言語 to English and look at the home screen.

Anything wrong, or wording you want changed: note the step number and I'll fix it before merging.

## After the merge

Next comes opening the demo server, not more features. The operator steps, from #81 and #84:
- hide the test boards with `deploy/operator-hide.sh`;
- mark the sample with `make_sample.mjs`;
- deploy with the new Caddy allowlist entry;
- check every page in ja and en on the demo.
