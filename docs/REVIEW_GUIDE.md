# Review guide: the whole stack (#70–#130)

For the founder's review before anything below is merged. Each PR has a few plain sentences and what to click. Then come the merge order, the deploy plan and a 15-minute click-through of the local site in Japanese.

Nothing here is merged or deployed unless it says so. I merge only after you say "merge the stack".

**The review server:** http://127.0.0.1:3200/try. It runs the combined branch `review-all` (build `0cef196`), which contains every open PR below except #68 (see "Not merged"). That build, from your local node pair (5010 producing, 5020 following by gossip) and your local prover, passes:
- all 397 Rust tests;
- all 47 UI guards;
- the fast anonymous posting end-to-end test, with the real prover and gossip to the second node;
- the ja/zh-HK render check. Its only flags are English test posts on the local boards, which are data, not page text.

## Found while preparing this review (fixed)

- **CI wasn't running on seven stack PRs** (#107, #114, #119, #121, #125, #126, #127). One of my forward merges dropped six `- if:` lines from `ci.yml`. That left duplicate keys, and GitHub then skips the whole workflow without saying so. All seven branches are fixed, and **#130** adds a separate workflow that refuses duplicate keys, so a broken `ci.yml` can't hide itself again.
- **Two wording-guard failures that this hid:**
  - #127's own guard quoted the overclaim it tests for, so the repo-wide wording guard flagged it. The control now builds that text at run time.
  - #129's plan quoted the banned phrase about anonymity without a "never" before it; it now says "never …".
- **The page's CSP blocked ML-DSA in the browser** (since #106). `pqc.ts` loaded the signing module with `new Function`, which a CSP without `'unsafe-eval'` refuses. Every browser path that signs or opens a board failed; "人間への質問" showed the error on load.
  - **The fix** is on #106, carried up to #113, #121 and #127.
  - **A new guard check** fails if anything the page runs evaluates a string as code. Control: the old `pqc.ts` fails it.
  - **Checked in a browser:** a site was built and every edit signed and verified in the tab.
- **#110 and #113 had a red CI check since 2026-10-10, which I missed:** the demo test checked HSTS after it had stopped the page, when every answer is a 502 without headers. HSTS itself was always sent. The check now runs while the page is up, and its control is the Caddyfile without `preload`, which fails it.
- **The offline verifier must be rebuilt after #118:** it inlines the signer WASM that #118 rebuilds. The review build carries a rebuilt copy. The real rebuild and re-mark are a step in the merge order below.

## The PRs

### Earlier in the stack (#73–#86, unchanged from the last guide)

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

### #87–#94 (stacked, not in the last guide)

**#87: a quiet home.** The trial badge is gone; "This is a testnet. Data may be reset." stays in the footer, Terms and FAQ. Home makes no inbox or key requests and loads with zero console errors.
- **Click:** home, then the footer.

**#91: honest wording and the AI access policy.**
- **Wording:** the key exchange is called Kyber-768 Round 3 (not the later NIST standard), and quantum resistance is "partly, until Phase 1".
- **Crawlers:** AI crawlers get robots.txt rules and a 403 from Caddy.
- **Guards** enforce all of this.
- **Click:** TET とは, then its comparison table.

**#92: the technical paper, first rewrite.** `/whitepaper` is rewritten against the code, with source files for every section. #107 replaces it with v2.
- **Click:** footer → 技術文書.

**#94: balance as a practice unit, and the boards' flood guard.**
- **Balance:** tapping your ID shows "N TET（練習用の単位。お金とは交換できません）".
- **Flood guard:** boards pace fast posting quietly instead of showing a limit.
- **Click:** your ID in the top bar.

### #100–#130

**#100: fast anonymous posting.** The day's first anonymous post on a board carries the proof (about 30 s, often already computed in the background), and every later post that day is instant. All your posts on that board that day share one daily ID, and the board says so. The flood guard and the five review fixes from #82 are in.
- **Click:** a thread → 匿名で投稿 twice. The second goes out at once, with the same 日替わりID.

**#101, #102: messaging keys must be signed by the wallet** (merged and deployed 2026-10-10). Pages check a recipient's keys and a sender's signature themselves, and DMs show a safety number.
- **Click:** DM, then 安全番号.

**#103: two deploy dates corrected in SECURITY.md.** A text fix from the seeds' own deploy log.
- **Click:** nothing; read the diff.

**#104: Verify without TET, Level 1.** One HTML file and one CLI check "this key signed this file" fully offline, with no network code at all. Every proof-code box links to it: "TET がなくなっても、これは動きます".
- **Click:** a proof code → that link → drop a `.sig.json` and its file.

**#105: Shelter.** A members-only space: you plus up to 10 in-person invites, then each member vouches for up to 3. Posts are by nickname or anonymous, readable only by members and never gossiped, and you're the sole moderator with cases and appeals.
- **Click:** see step 7 of the click-through; it needs two browser windows.

**#106: the threat model and design rules 6–11.** `docs/THREAT_MODEL.md` marks each scenario defended, partly or out of scope. Six rules have guards: CSP, device-password strength and auto-lock, the three safety sentences, pinned Actions, and security.txt. This is where the CSP bug above was introduced and fixed.
- **Click:** read `docs/THREAT_MODEL.md`. On the page: パスフレーズ（12語）で ID を開く.

**#107: technical paper v2.** Sections 0–14, written against a pinned commit, with security fixes named by class only. It's marked with the publisher key, and the marks are published at launch.
- **Click:** footer → 技術文書. In Japanese it shows the ja draft from #119.

**#108: the positioning line.** "What is TET" opens with 「自分の証明と鍵を、会社から自分の手に。」, then one line on why now and two honest limits.
- **Click:** TET とは.

**#109: launch checklist.** `docs/LAUNCH_CHECKLIST.md`: pre-launch, operator readiness, the friends test and launch day, each item with who does it.
- **Click:** nothing; read it.

**#110: tetnet.org as the main domain.** Other names redirect permanently with the path kept, HSTS preload is on, the contacts are abuse@ and hello@, and a daily certificate-transparency watch posts to Discord. CI tests the redirect with a real Caddy.
- **Click:** nothing locally; it's live on the demo already.

**#112: provisioning SSH fix.** `provision-seed.sh` writes an explicit `ssh.socket` drop-in for every SSH port on IPv4 and IPv6, and never adds nftables reject rules. This is what fixed the demo host.
- **Click:** nothing; read the diff.

**#113: ID cards and DM to the verified signer.** Tapping a named post's short ID opens a card: full ID, copy, QR and DM を送る. The card always uses the key the browser verified, never the name or prefix shown. Anonymous posts get "匿名の書き込みには DM を送れません。", and your full ID is in the ID menu.
- **Click:** a named post's ID; then your ID → 自分の ID.

**#114: the repo front door.**
- **The README is rewritten:** what works today, what each part proves and doesn't, and honest limits.
- **Also:** CONTRIBUTING, old docs archived, the genesis line.
- **Paper images:** every one must match text the paper carries.
- **Click:** read `README.md` on the branch.

**#115, #120: one bad transaction can't empty the mempool** (merged and deployed 2026-10-10).

**#116: seed liveness covers the demo.** The demo's health check now counts like the seeds', with no exemption. Your healthchecks.io setting is done: `tet-demo` is 5 min / 5 min.
- **Click:** nothing.

**#117: never stage a whole directory** (the CLAUDE.md rule), and working logs are gitignored.
- **Click:** nothing.

**#118: the committed signer rebuilt without the build machine's home path.** Its behaviour is unchanged (same interop vectors), and CI now refuses a signer that names a home directory.
- **Click:** nothing. See the merge order: the offline verifier is rebuilt right after.

**#119: languages.**
- **First visit:** the page opens in the browser's language, and your choice is remembered.
- **The paper:** shows the ja draft (unmarked until your review).
- **Also translated:** the offline verifier, and a maintenance page that Caddy serves when the site is down.
- **A render guard** fails on English left in ja or zh-HK.
- **Click:** 言語 at the foot. Your ja review list is in `docs/i18n/JA_REVIEW.md`.

**#121: testnet rewards.** A welcome grant of exactly 100 TET (practice unit, can't be exchanged for money), paid once per anonymous member. It's off unless the node has its own grant wallet, and the page states that it's weak (registering is free). The thread-grant rewarder is **dry-run only** until vouching exists, as you decided.
- **Click:** your ID → ウェルカム付与を受け取る. It's on for the local node only.

**#122, #124: message times held to the node's clock** (#122 merged and deployed 2026-10-11; #124 is its class-level SECURITY.md entry).

**#123: the browser nodes plan (Phase 8).** js-libp2p over WebRTC, with the seeds as relays, and the libp2p Discord relay offer noted. Plan only.
- **Click:** read `docs/plans/BROWSER_NODES.md`.

**#125: the signed build manifest and "verify this page".**
- **The manifest:** every served file with its SHA-256; two builds of one commit are byte-identical.
- **Signing:** you sign it on your own machine.
- **Checking:** `verify_site.mjs` checks a live site without trusting it.
- **Click:** このページを検証 at the foot. Locally it says the manifest isn't signed by TET's publisher ID. That's expected: only the demo's build gets signed.

**#126: Verify without TET, Level 2.** A stamp is checked offline against an exported stretch of the chain, and seven kinds of tampering are each caught. One new read-only node route: `GET /explorer/block/:height`.
- **Click:** the offline verifier → Level 2. Optional; it needs a chain export file.

**#127: TetSearch v1.** A Shelter member lists their site with two signatures, theirs and the site's. Search runs in the member's browser, so the node never sees the words, and results are ranked one per member. The node does see which member read the listings, and the screen says so.
- **Click:** step 8 of the click-through.

**#128: community.** GOVERNANCE.md, a run-your-own-node guide and seven good-first-issue drafts, opened as GitHub issues after the merge.
- **Click:** nothing; read them.

**#129: the TETtalk plan.** A forum about TET, on TET: five sections, and announcements only from the publisher key. Long retention with a daily on-chain anchor of post hashes, mirrors, and moderation as on boards. Plan only.
- **Click:** read `docs/plans/TETTALK.md`.

**#130: CI refuses duplicate keys in workflow files.** A separate workflow, so it runs even when `ci.yml` is broken.
- **Click:** nothing.

**Japanese terms (settled 2026-10-11):** vouch is 推薦 (保証 reads as a money guarantee), the 12 words are パスフレーズ, and the anonymity set is 匿名グループ. グループ isn't used for anything in Shelter; its only other use is the paper's Sign in with TET line 「グループ X のメンバー」, which means the same kind of member set. The two agent-manifest lines ("the owner vouched for the key") now say 認めた, because 推薦 reads oddly for a key. `ja_terms_guard` keeps all of this in CI. In zh-HK (settled 2026-10-13), vouch is 引薦 everywhere: 擔保 and 作保 are gone, the agent-manifest lines say 認可, and the same guard refuses the old words.

## Not merged

- **#68 (quantum wording)** conflicts with the stack's About line, which says quantum resistance is incomplete until Phase 1. #68 says "so it stays secure", which is stronger. Decided: the stack's About line stays, and I rebase #68 after the stack, keeping its guard (no "quantum-powered" or "unbreakable").
- **#69 (remove the old home and participate pages)** merges with one small TopNav conflict, resolved in `review-all` to "Try TET" plus "Technical paper". I'll rebase it after the stack.
- **#75** is the wordmark draft: pick one first.
- **#90 and #93** are closed as superseded (2026-10-11); #105 and #121 carry the later versions.
- **#62 and #64** (old landing and plans docs) are outside this review. Your call: merge as history, or close.

## Merge order

The stack has three tips, and each contains everything below it:
- **#127**: #70 … #107, #114, #119, #125, #126 and #127;
- **#113**: adds #108 and #110;
- **#121**: adds the rewards.

Every stack PR currently conflicts with `main`, because main gained #115 and #122 after the stack branched. The conflicts are in the i18n dictionaries, the tests file, one gossip check and `ci.yml`. They're the ones already resolved and tested in `review-all`.

**Recommended:** land the tree you reviewed, tip by tip, with merge commits (never squash, never rewriting history):

1. **#130**, so CI is trustworthy from here on.
2. **The independent small PRs:** #103, #124, #117, #112, #116, #109, #123, #128, #129.
3. **#118** (the signer).
4. **#127:**
   - first #131 (libp2p page and probe), #132 (chain label, FAQ lines), #133 (genesis_bridge removal) and #138 (the zh-HK paper draft) merge into its branch: they're stacked on it;
   - I merge main into its branch with exactly the resolutions in `review-all`;
   - I rebuild the offline verifier on #118's signer and re-mark it with the publisher key (new proof codes, not yet published);
   - when CI is green, it gets a merge commit.

   GitHub then marks every PR whose head it contains as merged: #70–#107, #114, #119, #125 and #126, plus #82 and #97.
5. **#113:** main merged in, CI green, merge.
6. **#121:** main merged in, CI green, merge.
7. **Afterwards:**
   - rebase #68 and #69;
   - close #90 and #93 if you agree;
   - open the seven good first issues (#128);
   - rebuild `review-all` from main and check that it matches.

Each merge goes through only with green CI. After step 6, `main` has the same tree as `review-all`, except for #68 and the verifier re-mark, and I compare them file by file before reporting.

**The alternative:** merge one PR at a time, bottom up (#70 first). That's about 30 merges, each needing main merged in and its own CI run, for the same final tree. It gives one merge commit per PR on main, but it takes most of a day. I recommend the tips.

**Note:** the old guide said GitHub rejects `--author-email` on `gh pr merge`. Merge commits use the account's default email unless "Keep my email addresses private" is ticked in GitHub's email settings; please check that before the first merge.

## Deploy plan

**What goes where:**
- **Helsinki, Nuremberg:** the new node binary only. These are its changes:
  - fast anonymous posting (#100);
  - Shelter (#105; off without `TET_SHELTER_*`);
  - the grants route (#121; off without `TET_GRANT_MNEMONIC_FILE`);
  - TetSearch (#127; off without Shelter);
  - the Verify Level 2 route (#126);
  - the `genesis_bridge` route removed (#133).

  Shelter and grants stay off on the seeds: Shelter lives on the node where its members are, and the seeds have no grant wallet.
- **The demo:** everything: node, UI and Caddy allowlist. Shelter is on only once you give me your moderator ID and board, and grants only once you decide (leaving them off at first is my recommendation).

**Why mixed versions are safe during the rollout:** the stack changes no consensus or ledger code; the only change is one comment line in `ledger.rs`. (#133 removes a REST route that wrote outside blocks; it changes nothing blocks do.) Old and new nodes therefore build and accept the same blocks. New data goes into new database trees only, so rolling back to `404bd86` reads the database unchanged. Fast anonymous posts only start once the demo runs the new code, which comes last.

**When:** your daytime, while you're reachable, starting no later than early afternoon so that a rollback still happens in daylight. Not on launch day. It takes about 90 minutes in all.

**Before:**
- `main` is at the stack's final merge, and CI is green;
- on my machine: the full Rust tests and every guard on that commit, and the Docker images built;
- on each host: record the height, state root, commit and `docker image ls` (the rollback target is `404bd86`).

**For each host, in this order: Helsinki, then Nuremberg, then the demo.** Each one is deployed with the `.env`-safe update in `docs/RUNNING_A_NODE.md` ("Updating a running seed"), and the health check is reinstalled, and `tet-logseal accept` is run on each seed right after its deploy (the log seal, #137, would otherwise alert on the new binary and image). Then I check:

1. **`/status/live`** shows the new commit and an advancing height.
   - Helsinki waits its 120 s solo-producer grace before mining again. **If it isn't mining 5 minutes after the restart, I roll it back.**
2. **Agreement with the other hosts:** the same height and state root.
3. **The new routes, on loopback:**
   - `GET /explorer/block/<h>` returns 200, and the block id recomputes;
   - `GET /grants/status` says "not on";
   - `GET /shelter/status` answers;
   - a fast-post lookup for an unknown key returns 404.
4. **The health check** is OK and NTP is synced. The healthchecks.io check stays green for one period.
5. **The demo only:**
   - `/try` in ja and en, plus `/whitepaper`, `/build-manifest.json` and `/verify/tet-verify.html`;
   - `lang_render_guard` against https://tetnet.org;
   - a named post on the demo reaches Helsinki by gossip;
   - two anonymous posts on one board: the second is instant, with the same daily ID.

**If anything looks wrong at any step,** I stop, leave the remaining hosts on the old code, roll back the host just changed to `404bd86`, and report.

**After the deploy (these need you):**
- sign the demo's build manifest on your machine (`sign_build_manifest.mjs https://tetnet.org --local … --publish`, see `deploy/demo/README.md`), then I run `verify_site.mjs` against the demo;
- the launch checklist items: hide the test boards, mark the sample, publish the paper and verifier marks;
- Shelter's moderator and board, and the grant decision, as above.
- **The demo's file-fee sponsor is off today.** Its log says `/run/tet-demo/sponsor.mnemonic does not exist`. Posting doesn't need it: board posts, DMs, joining 匿名グループ, Shelter, sites, TetSearch, 本物として記録 and 予言の封印 are all off-ledger and cost a visitor nothing. But a stamp (署名 → 刻印, the on-chain date) and a sent file's fee are paid only by the sponsor, never by the visitor's own TET, so on the demo today every stamp ends with "Not stamped" (files still arrive, fee unpaid). To turn it on, a funded sponsor wallet's 12 words go in that file (caps: 5 per connection and per ID a day, 500 a day in all, floor 10 TET). The welcome grant doesn't change this: the page never spends the visitor's TET on a fee.

## 15分クリックテスト（ローカル、日本語）

**開くページ:** **http://127.0.0.1:3200/try?lang=ja**

ローカルのノード2台、UI（`review-all`）、証明プログラムはすべて動いています。シェルターで使うテスト用の鍵（このローカルノード専用の使い捨て）は、`~/.claude/jobs/6a58ed84/tmp/REVIEW_LOCAL_KEYS.txt` にあります。

1. **ホームと言語（1分）**
   - ホームがすぐに出ます。
   - 下の「言語」で English に切り替えて、日本語に戻します。選んだ言語は覚えられます。
   - 「TET とは」を開くと、一行目が「自分の証明と鍵を、会社から自分の手に。」です。
2. **本物として記録（2分）**
   - 「本物として記録」で一行書いてボタンを押します。証明コード、QR、リンクが出ます。
   - そのコードをホームの検索窓に貼ると、記録が見つかります。
   - 証明コードの欄にある「TET がなくなっても、これは動きます」のリンクを開くと、ネットにつながらない検証ファイルが開きます。
3. **掲示板と速い匿名投稿（3分）**
   - 「新着スレッド」からスレッドを開き、「匿名で投稿」で書き込みます。1回目は証明を作るので30秒ほどかかります。
   - もう一度「匿名で投稿」すると、すぐに出ます。どちらも同じ「日替わりID」です。
   - 次に記名で書き込みます。自分の書き込みの短い ID を押すと、ID カードが開きます（全桁の ID、コピー、QR、「DM を送る」）。
   - 匿名の書き込みの ID を押すと、「匿名の書き込みには DM を送れません。」と出ます。
4. **自分の ID と残高（1分）**
   - 上のバーの ID を押します。「自分の ID」（全桁、QR）と、残高「N TET（練習用の単位。お金とは交換できません）」が出ます。
   - 「ウェルカム付与を受け取る」を押すと、証明のあと 100 TET が届きます（このローカルノードだけ有効にしています）。
5. **サイト（2分）**
   - 下の「サイト」→「新しいサイトを作る」で、ブロックを一つ足して開きます。
   - 「署名済みサイト · あなたのタブで確認済み」と出ます。
   - あとで検索するので、本文に珍しい単語を一つ入れておきます。
6. **シェルター（3分、ウィンドウを2つ使います）**
   - **シークレットウィンドウで:**
     - 同じページを開き、「パスフレーズ（12語）で ID を開く」でモデレーターの12語を入れます。
     - 「シェルター」で「掲示板の招待」にテスト用の招待を一度だけ貼り、「ニックネームを設定」します。
   - **普通のウィンドウで:** 「シェルター」→「参加コードを表示」で出たコードをコピーします。
   - **シークレットウィンドウで:** 「誰かを招待」の「相手の参加コード」に貼って招待します。
   - **普通のウィンドウで:** ページを開き直すとメンバーになっています。ニックネームを決めて一言書き込みます。
7. **TetSearch（2分）**
   - 普通のウィンドウで、手順5のサイトを開いて「TetSearch に掲載」を押します。
   - 下の「TetSearch」を開き、手順5で入れた単語を検索すると、サイトが見つかります。
   - 検索は自分のタブの中で行われ、ノードには検索語が送られません（画面にその説明があります）。
8. **検証・中身・技術文書（1分）**
   - 下の「このページを検証」は、ローカルでは「TET の発行者 ID の署名がありません」と出ます。署名するのはデモのビルドだけなので、これが正しい表示です。
   - 「TET の中身」では、件数と、それぞれの保存期間が出ます。
   - 「技術文書」では、日本語の下書きが出ます（印はまだ付けていません）。

おかしな所や変えたい言葉があれば、手順の番号を書いて知らせてください。マージの前に直します。
