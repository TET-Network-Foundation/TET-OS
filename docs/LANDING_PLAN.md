# /try landing page — plan (not built)

Status: **plan for review**, 2026-10-08. Nothing here is implemented. zh-HK strings come later.

The landing replaces today's first view of /try (the "start or open a board" panel). The Ledger
shell (sidebar, rail, tools) stays; the landing is what the main column shows before you pick
anything, and the sidebar's top item returns to it.

Style for every section: plain type, thin 1px rules, black/grey text, underlined links, no
gradients, no emoji or icon fonts, no cards with shadows, no "unlock / revolutionize / seamless /
next-gen / empower". Slightly dense: 15–16px body, 1.45 line height, section headings 13px caps-free
bold with a rule under them, like a text-board index. One accent colour for links only.

Every claim below is something the code does today, or is marked **planned** in the copy itself.

**Money.** The TET token is not featured in any main section. Nowhere on the page: prices, "earn",
"invest", buying (`try_money_guard.mjs` enforces it, PR #66). The FAQ has exactly one line about it
(below).

---

## Text wireframe

Phone (360px), one column, top to bottom:

```
──────────────────────────────────────────
 (logo) TET v0.2 · testnet            [≡]
──────────────────────────────────────────
 A board you write to with a key you
 hold. Nothing to sign up for.
 [ Try it now ]
──────────────────────────────────────────
 What works today
  sign      ……one line……  proves / not
  verify    ……
  boards    ……
  DM        ……
  files     ……
  live      ……
──────────────────────────────────────────
 Use it for
  data science   [try this]
  lab notes      [try this]  (planned)
  writers…       [try this]
  developers     [try this]
  shops          (planned)
  schools        (planned)
──────────────────────────────────────────
 Why this will be needed   (4 lines)
──────────────────────────────────────────
 How TET differs           (table, scrolls
                            inside its box)
──────────────────────────────────────────
 Roadmap                   (3 lines)
──────────────────────────────────────────
 Shelter (planned)         (5 lines + the
                            "does not prove" line)
──────────────────────────────────────────
 About · contact
──────────────────────────────────────────
 footer: testnet / IP line (as today)
```

Desktop (1280px): the same sections in the main column, max 46rem wide; the right rail keeps the
node facts (height, peers, commit); the sidebar keeps boards and tools. "What works today" and "Use
it for" sit side by side above 1024px as two narrow index columns.

Returning visitor (see the end): the intro block (sections 1–2) collapses to one line, and a
"Continue" block takes its place.

---

## 1. Name and one line

Decided (2026-10-08): **the TET logo** (the founder's design: a black disc with a grid of white
square rings), traced exactly to `public/brand/tet-logo.svg`, at the top left, about 40px, followed
by "TET v0.2 · testnet". Small sizes (favicon, app icon) use a simplified variant once the founder
approves it.

| | en | ja |
|---|---|---|
| title | TET v0.2 · testnet | TET v0.2 · テストネット |
| one line | A board you write to with a key you hold. Nothing to sign up for, and nobody holds your key for you. | 鍵だけで書ける、預からない掲示板。登録はいりません。鍵を預かる人もいません。 |
| under it, small | Testnet: the coins have no value and the chain can be reset. | テストネットです。コインに価値はなく、チェーンはリセットされることがあります。 |

## 2. Try it now

One black button, full width on phone. It makes a key in this tab and opens the public boards.
No form, no email.

| | en | ja |
|---|---|---|
| button | Try it now | 試してみる |
| under it | Makes a key in this tab. Close the tab without saving the 12 words and it's gone. | このタブで鍵を作ります。12語を保存せずに閉じると消えます。 |

## 3. What works today

An index: name (link to the tool) · what it does · proves / doesn't prove. Each row is one line on
desktop, two on phone.

| tool | en: does | en: proves / doesn't | ja: does | ja: proves / doesn't |
|---|---|---|---|---|
| sign | Sign a file or text with your key; optionally stamp it on chain. | Proves this key signed these exact bytes (and, stamped, that they existed by a block). Not who holds the key. | ファイルや文章に鍵で署名。チェーンに刻むこともできます。 | この鍵がこのバイト列に署名したこと（刻めばその時点で存在したこと）を証明。鍵を誰が持つかは証明しません。 |
| verify | Check a .sig.json, an owner's manifest, a pin, a stamp. | Each step says what it proves; a valid signature alone doesn't say who holds the key. | .sig.json・所有者の宣言・ピン・刻印を確認。 | 各段階が証明する範囲を表示。署名だけでは鍵の持ち主は分かりません。 |
| boards | Threads, anonymous or named posts. | An anonymous post proves a member wrote it, not which one. It doesn't hide your IP from the node. | スレッド、匿名または記名の投稿。 | 匿名投稿は「メンバーの誰か」が書いたことを証明。誰かは示しません。ノードからIPは隠しません。 |
| DM | End-to-end encrypted messages. | Proves which key sent it. The node still sees who writes to whom, and when. | エンドツーエンド暗号化のメッセージ。 | どの鍵が送ったかを証明。誰が誰にいつ送ったかはノードに見えます。 |
| files | Encrypted files up to 100 MB, kept 7 days. | Only the recipient can open it. Doesn't prove the file is what its name says. | 100 MBまでの暗号化ファイル、7日間保存。 | 受け取った人だけが開けます。名前どおりの中身かは証明しません。 |
| live | This node's own blocks and messages as they arrive. | Real numbers from one node. Not the whole network's view. | このノードに届くブロックとメッセージ。 | 一つのノードの実際の数字。ネットワーク全体の見え方ではありません。 |

## 4. Use it for

Each row: field · one sentence · a "try this" button that opens the tool pre-filled. "Pre-filled"
means the tool opens with a short instruction and the right options set; it never uploads anything
by itself. Rows whose feature isn't built say **planned** and have no button.

| field | en | ja | button opens | status |
|---|---|---|---|---|
| data science | Sign a dataset's fingerprint, so anyone can check later that the file is the one you used. | データセットの指紋に署名。後で誰でも、使ったファイルがそれだと確かめられます。 | Sign, with "drop the dataset; only its hash leaves this tab once stamped" | works today (#59) — note: today Sign embeds the whole file in the .sig.json; a hash-only mode for large datasets is a small follow-up |
| lab notes | Record date, aim, method and data files with one signature and a block. | 日付・目的・方法・データを一つの署名とブロックで記録。 | Lab record template | **planned** (queue p) |
| writers and artists | Show this key had this exact work at that block. | この鍵がその時点でこの作品を持っていたことを示す。 | Sign + stamp + QR | works today (#59, #60); the dedicated page is queue (o). Line: "proves this key had this exact file at that block; it does not prove authorship by itself or that nobody had it earlier." |
| developers | Sign a release so users can check it came from your key. | リリースに署名し、あなたの鍵から来たことを利用者が確かめられるように。 | Sign; the agent SDK for CI | works today |
| shops | A signed listing a buyer can scan. | 買い手が読み取れる署名付き出品。 | — | **planned** (queue r) |
| schools | A members-only anonymous poll. | メンバー限定の匿名投票。 | — | **planned** (queue n; needs a design decision) |

## 4b. Play (planned)

A small corner below "Use it for", labelled **planned**. Four items, one line each plus its honest
line. None is built; each is a later idea in FUTURE_IDEAS.

| item | en | proves / doesn't (en) | ja | proves / doesn't (ja) |
|---|---|---|---|---|
| sealed prediction | Seal a prediction now (only its salted hash is posted); reveal the text later. | Proves the text was fixed when it was sealed. Doesn't prove it was a good guess, or that the same person didn't seal other predictions too. | 予想を封印（ソルト付きハッシュだけを投稿）し、後で中身を公開。 | 封印した時点で文が決まっていたことを証明。当たったことや、同じ人がほかの予想も封印していないことは証明しません。 |
| letter to future self | Write a letter that is delivered to you later. | The node holds it, encrypted to you, until the date. Up to 30 days ahead on this node; if the node is gone, so is the letter. | 未来の自分に届く手紙。 | 日付まで暗号化したままノードが預かります。このノードでは30日先まで。ノードがなくなれば手紙も消えます。 |
| attendance | Scan the venue's QR, which changes every 30 seconds. | Proves you scanned the venue QR. Not that you were there: someone could pass the code on within 30 seconds. | 会場のQR（30秒ごとに変わる）を読み取る。 | 会場のQRを読み取ったことを証明。その場にいたことは証明しません（30秒以内に誰かが転送できます）。 |
| vouched recommendation | A member recommends someone anonymously. | The recipient must opt in to receive them, and nothing is shown publicly unless the recipient chooses to. Proves a member wrote it, not which one. | メンバーが匿名で誰かを推薦する。 | 受け取る側が受け取りを選んだときだけ届き、本人が選ばない限り公開されません。メンバーの誰かが書いたことを証明し、誰かは示しません。 |

## 5. Why this will be needed

Four short lines. No predictions with dates, no "the future of".

| en | ja |
|---|---|
| Images, voices and documents can now be faked cheaply. A signature doesn't stop that, but it lets you check whether a file came from a key you trust. | 画像・声・文書は安く偽造できるようになりました。署名で偽造は止められませんが、信頼する鍵から来たかは確かめられます。 |
| Most signatures today would be breakable by a large enough quantum computer. TET signs everything with a classical and a post-quantum key together. | 今の多くの署名は、十分大きな量子コンピュータで破られうるものです。TETはすべてを従来の鍵と耐量子の鍵の両方で署名します。 |
| Honest limit: the post-quantum key isn't yet bound to your wallet id; that comes with the Phase 1 genesis. | 正直な限界：耐量子の鍵はまだウォレットIDに結びついていません。Phase 1 のジェネシスで対応します。 |
| None of this is audited yet. | まだ監査は受けていません。 |

## 6. How TET differs

A plain table, TET against "most public chains" as a class (no named projects: naming them invites
claims I'd have to keep current). Every TET cell is true today or says planned.

| | TET today | most public chains |
|---|---|---|
| Signatures | Ed25519 + ML-DSA-44 on every transaction (PQ key not yet bound to the wallet id: **planned**, Phase 1) | classical only |
| Messaging and files | built in, end-to-end encrypted | usually not part of the chain |
| Anonymous posting | membership proof with hashes only (zero-knowledge) | usually none, or a separate system |
| Who makes blocks | **one producer today** (Helsinki); more producers **planned** | many |
| Audited | no | the large ones, yes |
| Value | testnet: a practice unit, no monetary value | real value |

The table's honest rows (one producer, not audited, no value) stay in it.

## 7. Roadmap

| en | ja |
|---|---|
| Now: v0.2 testnet. Two seed nodes, one block producer, coins with no value. | 現在：v0.2 テストネット。シードノード2台、ブロック生成は1台、コインに価値なし。 |
| Target: the Phase 1 genesis in Q1 2027 — binds the post-quantum key to the wallet, signs blocks, renames the chain. It's a target, not a date. | 目標：2027年第1四半期の Phase 1 ジェネシス。耐量子の鍵とウォレットの結びつけ、ブロック署名、チェーン名の変更。目標であって確定日ではありません。 |
| Planned: TetSearch at search.stevenexus.org — searches only signed TET sites; only vouched people can publish; built to keep out mass AI generation. (The address doesn't resolve yet.) | 予定：search.stevenexus.org の TetSearch。署名付きの TET サイトだけを検索し、紹介された人だけが公開でき、AIによる大量生成を締め出すように作ります。（アドレスはまだ有効ではありません） |
| What's open is in SECURITY.md. | 未解決の点は SECURITY.md にあります。 |

## 8. Shelter (planned)

The whole section is labelled **planned**: none of it is built. Copy:

| en | ja |
|---|---|
| A quiet corner for people who know each other. | 知り合い同士のための静かな場所。 |
| Invite only: someone already inside vouches for you in person. | 招待制：中にいる人が直接会って紹介します。 |
| Joining needs a membership proof; posts aren't served on the public API, and AI crawlers are asked not to crawl (robots.txt). | 参加にはメンバーである証明が必要。投稿は公開APIでは配信せず、AIクローラーには robots.txt で巡回しないよう求めます。 |
| Every post is signed, by name or anonymously. | すべての投稿は署名付き（記名でも匿名でも）。 |
| **A post proves a member wrote it. It does not prove no AI was used.** | **投稿は「メンバーが書いた」ことを証明します。AIが使われていないことは証明しません。** |

Never "AI cannot enter", never "AI-free". robots.txt is a request, not a wall; the copy says
"asked not to crawl". Building it needs: a per-shelter member set (the same open question as queue
n), node-side refusal to serve its posts on public routes (the operator-hide plumbing from the
pre-public PR), and a robots.txt on the demo.

## 9. About

Unchanged from the About panel (#53), shortened:

| en | ja |
|---|---|
| Built and run by Steve, a student in Switzerland. | スイスの学生、Steve が作って運営しています。 |
| Contact: tetsteve@proton.me · source on GitHub · SECURITY.md | 連絡先：tetsteve@proton.me · GitHub のソース · SECURITY.md |
| Report content: abuse@stevenexus.org — reviewed within 48 hours. | 通報：abuse@stevenexus.org（48時間以内に確認します） |

No age, no school. No personal email: the two addresses above are the only ones published.

---

## FAQ (one money line, word for word)

| en | ja |
|---|---|
| Testnet TET is a practice unit. It has no monetary value and cannot be bought. | テストネットの TET は練習用の単位です。金銭的な価値はなく、購入することもできません。 |

The Japanese line deliberately avoids 購入 as a claim of buying: it denies it. `try_money_guard`
is strict (no denial exception), so the Japanese FAQ line will be checked by hand and allow-listed
by its exact text when the landing is built.

## Returning visitors

**Without remembering anything** (works with today's rules): if this tab already has a key, the
intro collapses to one line ("TET v0.2 · testnet — you have a key in this tab") and a Continue block
shows: the last board opened in this tab, unsent drafts in this tab, and the key's short id. All of
it lives in the page's memory; a new tab starts fresh.

**Remembering things on this device** (decided 2026-10-08): a separate storage module with its own
guard; `try_wallet_guard` stays exactly as it is for everything else.

- **Plain storage, non-secret UI state only:** last board, drafts, language. Nothing that is or
  derives from a key.
- **The key, opt-in only, encrypted:** the 12 words encrypted with WebCrypto (AES-GCM under a key
  derived from the user's passphrase with PBKDF2-SHA-256 at a stated iteration count; parameters
  shown on screen), with "forget this device" next to it. The page says: "Anyone with this device
  and your passphrase can use your key. A script injected into this page could read it while it's
  open."
- **Its guard, with negative controls:** the words and the passphrase never reach storage in
  plain text; only ciphertext is written; a wrong passphrase opens nothing; the KDF parameters can't
  drop below the stated floor; only the listed UI-state keys may be stored in plain storage.
  Controls: a module that stores the words in plain text, or a key outside the list, is caught.
- (e)'s once-per-tab flag and (h)'s nicknames use the same module's plain UI-state store.

## Open questions for you

Decided: typeset logo; storage as above.

1. Section 6: keep "most public chains" as a class, or name specific chains (needs sources I keep
   current)?
2. Data science "try this": ship with today's Sign (embeds the file), or add the hash-only mode
   first?
