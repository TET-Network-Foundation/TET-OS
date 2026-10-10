# Japanese strings for review

Everything Japanese that is new or changed since main (0117bf0), in one place.
English is the source; fix a Japanese line by editing the file named in each part.

## 1. The technical paper (draft, not marked)

The whole of `tet-network/ui/app/whitepaper/paper_ja.ts`: a translation of the English paper at
commit 341c941, English authoritative. Read it rendered at `/whitepaper?lang=ja` (the review
server) or in the file. It will be built and marked only after your review. The Hong Kong Chinese
translation starts after that, so your changes carry over.

## 2. The page (`tet-network/ui/app/try/i18n_ja.ts`): 633 new, 1 changed

| English | 日本語 |
|---|---|
| The 1,000 µTET fee is paid by the demo's sponsor, up to 5 files per connection and per ID a day. Past that the file still arrives; its fee shows as unpaid. | 1,000 µTETの手数料はデモのスポンサーが払います。1日あたり接続ごと・ID ごとに5ファイルまでです。それを超えてもファイルは届きますが、手数料は未払いと表示されます。 |
| TET is a blockchain meant to stay secure once quantum computers can break today's signatures. Every transaction is signed twice, with Ed25519 and with ML-DSA-44; until the Phase 1 genesis binds the ML-DSA key to the wallet, that protection is incomplete. | TET は、量子コンピュータが今の署名を破れるようになっても安全であることを目指すブロックチェーンです。すべてのトランザクションは Ed25519 と ML-DSA-44 で二重に署名されます。ただし Phase 1 のジェネシスで ML-DSA の鍵がウォレットに結び付けられるまで、その保護は不完全です。 |
| TET is built by Steve. | TET は Steve が作っています。 |
| This browser won't let the page remember anything. | このブラウザではページが何も記憶できません。 |
| TET | TET |
| Continue | 続きから |
| Your key in this tab: | このタブの鍵: |
| No key in this tab yet: your first post makes one. | このタブにはまだ鍵がありません。最初の投稿で作られます。 |
| Last board: | 最後に開いた掲示板: |
| (invite-only: open it with its invite link) | （招待制: 招待リンクから開いてください） |
| This device forgot everything the page kept. | この端末からページが記憶していたものをすべて消しました。 |
| Forget this device | この端末の記憶を消す |
| What works today | いま使えるもの |
| Sign a file or text with your key; optionally stamp it on chain. | ファイルや文章に鍵で署名。チェーンに刻むこともできます。 |
| Proves this key signed these exact bytes (and, stamped, that they existed by a block). Not who holds the key. | この鍵がこのバイト列に署名したこと（刻めばその時点で存在したこと）を証明。鍵を誰が持つかは証明しません。 |
| Check a .sig.json, an owner's manifest, a pin, a stamp. | .sig.json・所有者の宣言・ピン・刻印を確認。 |
| Each step says what it proves; a valid signature alone doesn't say who holds the key. | 各段階が証明する範囲を表示。署名だけでは鍵の持ち主は分かりません。 |
| Threads, anonymous or named posts. | スレッド、匿名または記名の投稿。 |
| An anonymous post proves a member wrote it, not which one. It doesn't hide your IP from the node. | 匿名投稿は「メンバーの誰か」が書いたことを証明します。誰かは示しません。ノードからIPは隠しません。 |
| End-to-end encrypted messages. | エンドツーエンド暗号化のメッセージ。 |
| Proves which key sent it. The node still sees who writes to whom, and when. | どの鍵が送ったかを証明。誰が誰にいつ送ったかはノードに見えます。 |
| Encrypted files up to 100 MB, kept 7 days. | 100 MBまでの暗号化ファイル、7日間保存。 |
| Only the recipient can open it. Doesn't prove the file is what its name says. | 受け取った人だけが開けます。名前どおりの中身かは証明しません。 |
| This node's own blocks and messages as they arrive. | このノードに届くブロックとメッセージ。 |
| Real numbers from one node. Not the whole network's view. | 一つのノードの実際の数字。ネットワーク全体の見え方ではありません。 |
| Use it for | 使いみち |
| data science | データサイエンス |
| Sign a dataset's fingerprint, so anyone can check later that the file is the one you used. | データセットの指紋に署名。後で誰でも、使ったファイルがそれだと確かめられます。 |
| Drop the dataset. The .sig.json lets anyone check later that a file is exactly this one. | データセットを置いてください。.sig.json があれば、後で誰でもファイルがこれと同じか確かめられます。 |
| lab notes | 実験ノート |
| Record date, aim, method and data files with one signature and a block. | 日付・目的・方法・データを一つの署名とブロックで記録。 |
| writers and artists | 書き手・作り手 |
| Show this key had this exact work at that block. | この鍵がその時点でこの作品を持っていたことを示す。 |
| Drop the work, sign it, stamp it, and show it as a QR. Proves this key had this exact file at that block; not authorship by itself, or that nobody had it earlier. | 作品を置いて署名し、刻んでQRにします。この鍵がその時点でこのファイルを持っていたことを証明します。それだけで作者であることや、それより前に誰も持っていなかったことは証明しません。 |
| developers | 開発者 |
| Sign a release so users can check it came from your key. | リリースに署名し、あなたの鍵から来たことを利用者が確かめられるように。 |
| Drop the release archive. Users check it with Verify. | リリースのアーカイブを置いてください。利用者は「検証」で確かめます。 |
| shops | お店 |
| A signed listing a buyer can scan. | 買い手が読み取れる署名付き出品。 |
| schools | 学校 |
| A members-only anonymous poll. | メンバー限定の匿名投票。 |
| try this | 試す |
| planned | 予定 |
| Play | あそび |
| sealed prediction | 封印予想 |
| Seal a prediction now (only its salted hash is posted); reveal the text later. | 予想を封印（ソルト付きハッシュだけを投稿）し、後で中身を公開。 |
| Proves the text was fixed when it was sealed. Doesn't prove it was a good guess, or that the same person didn't seal other predictions too. | 封印した時点で文が決まっていたことを証明。当たったことや、同じ人がほかの予想も封印していないことは証明しません。 |
| letter to future self | 未来の自分への手紙 |
| Write a letter that is delivered to you later. | 後で自分に届く手紙を書く。 |
| The node holds it, encrypted to you, until the date. Up to 30 days ahead on this node; if the node is gone, so is the letter. | 日付まで暗号化したままノードが預かります。このノードでは30日先まで。ノードがなくなれば手紙も消えます。 |
| attendance | 出席 |
| Scan the venue's QR, which changes every 30 seconds. | 会場のQR（30秒ごとに変わる）を読み取る。 |
| Proves you scanned the venue QR. Not that you were there: someone could pass the code on within 30 seconds. | 会場のQRを読み取ったことを証明。その場にいたことは証明しません（30秒以内に誰かが転送できます）。 |
| recommendation | 推薦 |
| A member recommends someone anonymously. | メンバーが匿名で誰かを推薦する。 |
| The recipient must opt in to receive them, and nothing is shown publicly unless the recipient chooses to. Proves a member wrote it, not which one. | 受け取る側が受け取りを選んだときだけ届き、本人が選ばない限り公開されません。メンバーの誰かが書いたことを証明し、誰かは示しません。 |
| Why this will be needed | なぜ必要になるか |
| Images, voices and documents can now be faked cheaply. A signature doesn't stop that, but it lets you check whether a file came from a key you trust. | 画像・声・文書は安く偽造できるようになりました。署名で偽造は止められませんが、信頼する鍵から来たかは確かめられます。 |
| Most signatures in use today could be broken by a large enough quantum computer. TET signs everything twice: with a classical key and with quantum-resistant signatures (ML-DSA). TET does not use a quantum computer. | 今の多くの署名は、十分大きな量子コンピュータで破られうるものです。TET はすべてに二つの署名を付けます。従来の鍵と、耐量子署名（ML-DSA）です。TET 自体は量子コンピュータを使いません。 |
| Honest limit: the ML-DSA key isn't yet bound to your wallet id; that comes with the Phase 1 genesis. None of this is audited yet. | 正直な限界: ML-DSA の鍵はまだウォレットIDに結びついていません。Phase 1 のジェネシスで対応します。まだ監査は受けていません。 |
| How TET differs | TET のちがい |
| TET today | 今の TET |
| most public chains | 多くの公開チェーン |
| Signatures | 署名 |
| Ed25519 + ML-DSA-44 on every transaction (binding the ML-DSA key to the wallet id is planned, Phase 1) | すべての取引に Ed25519 + ML-DSA-44（ML-DSA の鍵とウォレットIDの結びつけは Phase 1 の予定） |
| classical only | 従来方式のみ |
| Messaging and files | メッセージとファイル |
| built in, end-to-end encrypted | 組み込み、エンドツーエンド暗号化 |
| usually not part of the chain | たいていチェーンの外 |
| Anonymous posting | 匿名投稿 |
| membership proof with hashes only (zero-knowledge) | ハッシュだけを使うメンバー証明（ゼロ知識） |
| usually none, or a separate system | たいていなし、または別のシステム |
| Who makes blocks | ブロックを作るのは |
| one producer today; more producers are planned | 今は1台。増やす予定です |
| many | 多数 |
| Audited | 監査 |
| no | なし |
| the large ones, yes | 大きなものは済み |
| Value | 価値 |
| testnet: a practice unit, no monetary value | テストネット: 練習用の単位で、金銭的な価値はない |
| real value | 実際の価値 |
| Roadmap | これから |
| Now: v0.2 testnet. Two seed nodes, one block producer, coins with no value. | 現在: v0.2 テストネット。シードノード2台、ブロック生成は1台、コインに価値なし。 |
| Target: the Phase 1 genesis in Q1 2027. It binds the ML-DSA key to the wallet, signs blocks and renames the chain. It's a target, not a date. | 目標: 2027年第1四半期の Phase 1 ジェネシス。ML-DSA の鍵とウォレットの結びつけ、ブロック署名、チェーン名の変更。目標であって確定日ではありません。 |
| TetSearch at search.stevenexus.org: searches only signed TET sites; only vouched people can publish; built to keep out mass AI generation. | search.stevenexus.org の TetSearch: 署名付きの TET サイトだけを検索し、紹介された人だけが公開でき、AIによる大量生成を締め出すように作ります。 |
| What's open is in | 未解決の点は次にあります: |
| Shelter | シェルター |
| A quiet corner for people who know each other. | 知り合い同士のための静かな場所。 |
| Invite only: someone already inside vouches for you in person. | 招待制: 中にいる人が直接会って紹介します。 |
| Joining needs a membership proof; posts aren't served on the public API, and AI crawlers are asked not to crawl (robots.txt). | 参加にはメンバーである証明が必要。投稿は公開APIでは配信せず、AIクローラーには robots.txt で巡回しないよう求めます。 |
| Every post is signed, by name or anonymously. | すべての投稿は署名付き（記名でも匿名でも）。 |
| A post proves a member wrote it. It does not prove no AI was used. | 投稿は「メンバーが書いた」ことを証明します。AIが使われていないことは証明しません。 |
| FAQ | よくある質問 |
| Testnet TET is a practice unit. It has no monetary value and cannot be bought. | テストネットの TET は練習用の単位です。金銭的な価値はなく、お金で手に入れることもできません。 |
| Built by Steve. | Steve が作っています。 |
| source on GitHub | GitHub のソース |
| Report content: | 内容の通報: |
| reviewed within 48 hours. | 48時間以内に確認します。 |
| TET: start here | TET: はじめに |
| Untitled | 無題 |
| How it works | しくみ |
| You hold a key: 12 words made in your browser. Nobody else has them, and nothing asks you to sign up. | 鍵を持つのはあなたです。ブラウザの中で作る12語で、ほかの誰も持っていません。登録も求めません。 |
| What you publish is signed with that key twice: Ed25519 and quantum-resistant signatures (ML-DSA). | 公開するものには、その鍵で二つの署名を付けます。Ed25519 と、耐量子署名（ML-DSA）です。 |
| Nodes check every signature and keep an ordered chain of blocks. Anyone can re-check a signature, a stamp or a block themselves, with Verify or the Live list. | ノードはすべての署名を確かめ、順番に並んだブロックのチェーンを保ちます。署名・刻印・ブロックは、「検証」やライブの一覧で誰でも自分で確かめ直せます。 |
| Search | 検索 |
| Try | 試す |
| The public-board directory didn't open on this node, so there is nothing to search. | このノードでは公開掲示板の一覧が開けなかったので、検索できるものがありません。 |
| Reading the public boards… | 公開掲示板を読み込み中… |
| Nothing found among {n} public threads. | {n} 件の公開スレッドの中に見つかりませんでした。 |
| Searches the public boards' threads on this node, in your tab. Later this box becomes TetSearch. | このノードの公開掲示板のスレッドを、あなたのタブの中で検索します。この検索窓はのちに TetSearch になります。 |
| signed tx | 署名付き取引 |
| message | メッセージ |
| file | ファイル |
| peer joined | ピア接続 |
| peer left | ピア切断 |
| This node, live | このノードのいま |
| node down: {why} | ノード停止中: {why} |
| last {n} events on this node | このノードの直近 {n} 件のイベント |
| nothing yet | まだ何もありません |
| Search threads, or enter a proof code | スレッドを検索、または証明コードを入力 |
| Proof code | 証明コード |
| QR code for this proof code | この証明コードのQRコード |
| The code finds it; the signature proves it. | コードで見つけ、署名で証明します。 |
| Proves this key signed this file's SHA-256, and that it was published on this node at that time. Doesn't prove the work is original or that a person made it. | この鍵がこのファイルの SHA-256 に署名し、その時点でこのノードに公開されたことを証明します。作品がオリジナルであることや、人が作ったことは証明しません。 |
| This node keeps the record for 7 days. Keep the .sig.json: with it and the file, anyone can check the signature in Verify. | このノードは記録を7日間保存します。.sig.json は保管してください。それとファイルがあれば、誰でも「検証」で署名を確かめられます。 |
| Download the record | 記録をダウンロード |
| Proof codes aren't set up on this node. | このノードでは証明コードが使えるようになっていません。 |
| The signatures board didn't open: {why} | 署名の掲示板が開けませんでした: {why} |
| Opening the signatures board… | 署名の掲示板を開いています… |
| The lookup failed: {why} | 検索に失敗しました: {why} |
| Looking up signatures… | 署名を探しています… |
| No published signature matches. Records are kept 7 days on this node. | 一致する公開済みの署名はありません。このノードでは記録は7日間保存されます。 |
| signature valid | 署名は有効 |
| signature invalid | 署名は無効 |
| published | 公開 |
| File SHA-256 | ファイルの SHA-256 |
| To check a file against a record, put both into Verify. | ファイルを記録と照らし合わせるには、両方を「検証」に入れてください。 |
| Publishing the record… | 記録を公開しています… |
| Get a proof code | 証明コードを取得 |
| Add a poll | 投票を追加 |
| Not in the anonymity set yet. | まだ匿名セットに入っていません。 |
| Vote | 投票する |
| Open until 00:00 UTC. | 00:00 UTC まで受付中。 |
| Closed. | 締め切りました。 |
| Members-only: {n} listed members can vote. | メンバー限定：名簿の {n} 人が投票できます。 |
| Anyone in this node's anonymity set can vote. | このノードの匿名セットに入っている人なら誰でも投票できます。 |
| {n} verified votes. | 検証済みの票 {n}。 |
| {n} not verified (not counted). | 未検証 {n}（数えていません）。 |
| Voting needs the native prover on this device. | 投票には、この端末にネイティブ証明器が必要です。 |
| proving… | 証明中… |
| Your vote was sent. | 票を送りました。 |
| Question | 質問 |
| Options, one per line (2 to 6) | 選択肢（1行に1つ、2〜6個） |
| The poll is open until 00:00 UTC today. Its options and member list can't be changed after it's made. | 投票は今日の 00:00 UTC まで受け付けます。作成後は選択肢も名簿も変更できません。 |
| Making the poll… | 投票を作成しています… |
| Make the poll | 投票を作成 |
| Cancel | キャンセル |
| You're not on this poll's member list. | あなたはこの投票の名簿に入っていません。 |
| Only the newest {n} ballots are counted. | 数えるのは新しい順に {n} 票までです。 |
| Your vote is hidden among this node's anonymity set. | あなたの票は、このノードの匿名セットの中に隠れます。 |
| One vote per member. Anyone who can read this thread sees votes as they arrive, so when few people vote, the timing can give a vote away. The node sees your IP address. | 1人1票です。このスレッドを読める人には票が届いた順に見えるので、投票する人が少ないと、タイミングから票が分かることがあります。ノードにはあなたの IP アドレスが見えます。 |
| continue: | 続き: |
| This node's newest blocks | このノードの最新ブロック |
| node not answering: {why} | ノードが応答しません: {why} |
| newest blocks on this node · blocks aren't signed by their producer yet; the signatures shown are each transaction's signer's (ed25519 · ML-DSA-44) | このノードの最新ブロック · ブロックにはまだ生成者の署名がありません。表示している署名は各トランザクションの署名者のものです（ed25519 · ML-DSA-44） |
| no blocks yet | まだブロックはありません |
| matches the hash on the line above | 上の行のハッシュと一致 |
| this node | このノード |
| Use a PNG, JPEG, GIF or WebP image. | PNG、JPEG、GIF、WebP のいずれかの画像を使ってください。 |
| An image can be at most 1 MB. | 画像は 1 MB までです。 |
| Site | サイト |
| site | サイト |
| Public: anyone with the link can read a site. This node keeps a site 30 days after its last edit; export it to keep a lasting copy. | 公開：リンクを知っている人は誰でも読めます。このノードは最後の編集から30日間サイトを保管します。長く残すにはエクスポートしてください。 |
| Anyone with these words can edit the site. Without them, nobody can, including you. | この12語があれば誰でもサイトを編集できます。なければ、あなたを含め誰も編集できません。 |
| I've written them down | 書き留めました |
| Start building | 作り始める |
| Make a new site | 新しいサイトを作る |
| Those aren't 12 valid words. | 有効な12語ではありません。 |
| Open my site | 自分のサイトを開く |
| Untitled site | 無題のサイト |
| Open the public page | 公開ページを開く |
| Checked in this tab: {n} edits, every signature and link valid | このタブで確認済み: {n} 件の編集、すべての署名とつながりが有効 |
| This site's chain doesn't check: edit {n}: {why} | このサイトのチェーンは確認できません: 編集 {n}: {why} |
| Title, language and look | タイトル・言語・見た目 |
| Title | タイトル |
| Look | 見た目 |
| Save title, language and look | タイトル・言語・見た目を保存 |
| Add a block | ブロックを追加 |
| Block type | ブロックの種類 |
| Heading | 見出し |
| Text | 本文 |
| Paragraphs. **bold**, *italic*, [a link](https://…) | 段落。**太字**、*斜体*、[リンク](https://…) |
| Image | 画像 |
| Describe the image (for people who can't see it) | 画像の説明（見えない人のために） |
| Items, one per line | 項目（1行に1つ） |
| numbered | 番号付き |
| Quote | 引用 |
| Who said it (optional; not checked) | 発言者（任意・確認しません） |
| Link (https://…) | リンク (https://…) |
| Label | 表示名 |
| Add | 追加 |
| Blocks | ブロック |
| Remove | 削除 |
| Preview: exactly what readers get | プレビュー（読む人が見るそのもの） |
| Preview | プレビュー |
| Export the page (.html) | ページを書き出す (.html) |
| Host the .html anywhere. With the .site.json, anyone can re-check every signature and re-render the same page. | .html はどこにでも置けます。.site.json があれば、誰でもすべての署名を確認し直し、同じページを再現できます。 |
| heading | 見出し |
| text | 本文 |
| image | 画像 |
| list | リスト |
| quote | 引用 |
| link | リンク |
| That isn't a site address. | サイトのアドレスではありません。 |
| This node has no site at this address (sites expire 30 days after their last edit). | このノードにはこのアドレスのサイトがありません（サイトは最後の編集から30日で期限切れになります）。 |
| Checking this site's signatures in your tab… | あなたのタブでこのサイトの署名を確認しています… |
| Signed site · checked in your tab | 署名済みサイト · あなたのタブで確認済み |
| {n} edits, every signature and link valid | {n} 件の編集、すべての署名とつながりが有効 |
| version | バージョン |
| Proves this site's key published every block, in this order. Not who holds the key. | このサイトの鍵がすべてのブロックをこの順番で公開したことを証明します。鍵を誰が持っているかは示しません。 |
| What is TET? | TET とは？ |
| This site's chain doesn't check (edit {n}: {why}). Not showing it. | このサイトのチェーンは確認できません（編集 {n}: {why}）。表示しません。 |
| Signed site | 署名済みサイト |
| What is TET | TET とは |
| Proves: | 証明すること: |
| Doesn't prove: | 証明しないこと: |
| What it is | TET とは何か |
| TET is a public network for checking who made something, and when. Every transaction and message on it is signed twice: once with Ed25519, and once with ML-DSA-44, one of the quantum-resistant signatures (ML-DSA) standardised by NIST as FIPS 204. | TET は、誰が・いつ何かを作ったかを確かめるための公開ネットワークです。すべての取引とメッセージは2回署名されます。1回は Ed25519、もう1回は ML-DSA-44 です。ML-DSA-44 は、NIST が FIPS 204 として標準化した耐量子署名（ML-DSA）の一つです。 |
| Anyone can check a signature on their own device. You don't have to trust this website or this node to do it. | 署名は誰でも自分の端末で確かめられます。このサイトやこのノードを信頼する必要はありません。 |
| Today it runs as a testnet (v0.2): a public test version. Nothing on it has monetary value. | 現在はテストネット（v0.2）、つまり公開の試験版として動いています。ここにあるものに金銭的な価値はありません。 |
| Why it's needed now | なぜ今必要なのか |
| Text, pictures and voices can now be generated in seconds, so "who made this, and when?" is harder to answer than it used to be. A signature answers part of it: it shows which key signed exactly these bytes. | 文章も画像も声も数秒で生成できる今、「誰が、いつ作ったのか」に答えるのは以前より難しくなりました。署名はその一部に答えます。どの鍵がまさにこのデータに署名したかを示します。 |
| The signatures most systems use today (ECDSA, Ed25519) could be forged by a large enough quantum computer, if one is ever built. Signatures are meant to be checked for years, so TET adds a quantum-resistant signature from the start. | 今日のほとんどのシステムが使う署名（ECDSA、Ed25519）は、十分に大きな量子計算機がもし作られれば偽造できるようになります。署名は何年も確かめられるべきものなので、TET は最初から耐量子署名を加えています。 |
| Sign and verify a file | ファイルに署名し、検証する |
| this key signed exactly this file. | この鍵がまさにこのファイルに署名したこと。 |
| who holds the key, that the work is original, or that a person made it. | 鍵を誰が持っているか、作品がオリジナルか、人が作ったか。 |
| Boards with anonymous posts | 匿名投稿のできる掲示板 |
| a post came from a member of this node's anonymity set, at most one per board per day. | 投稿がこのノードの匿名セットのメンバーから来たこと（1つの掲示板につき1日1件まで）。 |
| which member wrote it. The node still sees IP addresses. | どのメンバーが書いたか。ノードには IP アドレスが見えます。 |
| Encrypted messages and files | 暗号化されたメッセージとファイル |
| only the receiver can read them (X25519 + Kyber round 3, not yet the final ML-KEM standard). | 受け取った人だけが読めること（X25519 + Kyber ラウンド3。最終版の ML-KEM 標準ではまだありません）。 |
| who talks to whom: the node sees that. | 誰と誰がやり取りしているか（ノードには見えます）。 |
| The live chain | ライブのチェーン |
| the blocks this node holds, shown raw, each linked to the one before. | このノードが持つブロックを、それぞれ前のブロックとつながった生のまま表示していること。 |
| who produced a block: blocks aren't signed by their producer yet. | ブロックを誰が作ったか（ブロックにはまだ生成者の署名がありません）。 |
| How it differs from other chains | ほかのチェーンとの違い |
| Every transaction carries two signatures, Ed25519 and ML-DSA-44. Most widely used chains sign with one classical signature (ECDSA or Ed25519). | すべての取引に Ed25519 と ML-DSA-44 の2つの署名が付きます。広く使われているチェーンの多くは、古典的な署名（ECDSA か Ed25519）1つだけで署名します。 |
| Anonymous posts use a zero-knowledge proof built only from hashes (SHA-256). | 匿名投稿には、ハッシュ（SHA-256）だけで作られたゼロ知識証明を使います。 |
| Messages, files and boards are not written to the chain. They stay on nodes for a limited time; the chain holds keys and proofs, not your content. | メッセージ・ファイル・掲示板はチェーンに書き込まれません。ノードに一定期間置かれるだけで、チェーンが持つのは鍵と証明であり、あなたの中身ではありません。 |
| It is small and early: one person runs the testnet, nothing is audited, and nothing is for sale. | まだ小さく初期段階です。テストネットは一人で運営しており、監査は受けておらず、売っているものもありません。 |
| Now: testnet v0.2, this site. | 現在: テストネット v0.2（このサイト）。 |
| Next: blocks signed by their producer, members-only features that work across nodes, and an outside security audit. | 次: 生成者が署名するブロック、ノードをまたいで使えるメンバー限定機能、外部のセキュリティ監査。 |
| Genesis, the start of the real network: target Q1 2027. This is a target, not a promise; it moves if the work isn't ready. | ジェネシス（本番ネットワークの開始）: 目標は2027年第1四半期。これは目標であって約束ではありません。準備が整わなければ動きます。 |
| Who builds it | 誰が作っているか |
| One person builds TET, as open source. Every change is public: | TET は一人がオープンソースで作っています。すべての変更は公開されています: |
| the source | ソースコード |
| Questions and reports: | 質問や報告: |
| How the demo works | デモのしくみ |
| TET home | TET ホーム |
| Tools | ツール |
| open boards: | 開いている掲示板: |
| Breadcrumb | 現在地 |
| ← back to top | ← ページの先頭へ |
| Search public threads | 公開スレッドを検索 |
| last edit signed {when} | 最終編集の署名 {when} |
| A node can leave out newer edits and show an older version; compare the version with the site's owner. | ノードは新しい編集を省いて古い版を見せることができます。バージョンをサイトの持ち主と照らし合わせてください。 |
| Keys without a human vouch can't publish. | 人からの紹介がない鍵は公開できません。 |
| This demo shows only part of what TET can do. | このデモで見られるのは、TET にできることの一部だけです。 |
| How it compares with Bitcoin and Ethereum | Bitcoin・Ethereum との比較 |
| Purpose | 目的 |
| Digital money | デジタルのお金 |
| A platform for smart contracts | スマートコントラクトの基盤 |
| Checking who made something, and when | 誰が・いつ作ったかを確かめること |
| Post-quantum signatures today | 現時点での耐量子署名 |
| No (proposals are under discussion) | なし（提案が議論されている段階） |
| No (on the research roadmap) | なし（研究ロードマップにある段階） |
| Partly: every transaction also carries an ML-DSA-44 signature, but the wallet ID is still the Ed25519 key until Phase 1 | 一部：すべてのトランザクションに ML-DSA-44 の署名も付きますが、Phase 1 まではウォレット ID が Ed25519 の鍵のままです |
| Anonymous one-person-one-vote | 匿名の1人1票 |
| No | なし |
| Not built in (apps such as MACI add it) | 標準ではなし（MACI などのアプリで追加） |
| Built in: members-only polls, one vote per member | 標準で搭載: メンバー限定の投票、1人1票 |
| Everyday interface | 日常で使える画面 |
| Wallet apps from other projects | 他のプロジェクトのウォレットアプリ |
| Wallets and apps from other projects | 他のプロジェクトのウォレットやアプリ |
| Built in: boards, signing and polls in the browser | 標準で搭載: ブラウザで使える掲示板・署名・投票 |
| Energy | エネルギー |
| Proof of work: high | プルーフ・オブ・ワーク: 多い |
| Proof of stake since 2022: low | 2022年からプルーフ・オブ・ステーク: 少ない |
| One block producer, no mining: low | ブロック生成者は1つ、マイニングなし: 少ない |
| TET isn't the only network with post-quantum signatures: QRL and others already use them. What TET adds is the combination: quantum-resistant signatures (complete once Phase 1 binds them to your ID), anonymous one-person-one-vote and an everyday interface, in one network. | 耐量子署名を使うネットワークは TET だけではありません。QRL などがすでに使っています。TET が加えるのは組み合わせです。耐量子署名（Phase 1 で ID に結び付けられて完成）、匿名の1人1票、日常で使える画面を、一つのネットワークで。 |
| Where TET is weaker today | TET が今のところ弱いところ |
| It's a testnet only: nothing on it is meant to last or has value. | テストネットだけです。残すことを前提にしたものも、価値のあるものもありません。 |
| One block producer makes every block. | すべてのブロックを1つの生成者が作っています。 |
| No security audit has been done. | セキュリティ監査はまだ受けていません。 |
| Very few people use it. | 使っている人はごくわずかです。 |
| Phase 0 (now): testnet v0.2, this site. | フェーズ0（現在）: テストネット v0.2（このサイト）。 |
| Phase 1: genesis, the start of the real network. Target: Q1 2027. A target, not a promise; it moves if the work isn't ready. | フェーズ1: ジェネシス（本番ネットワークの開始）。目標は2027年第1四半期。これは目標であって約束ではありません。準備が整わなければ動きます。 |
| After that: the vision. No dates; the order may change. | その先は構想です。日付はなく、順番も変わることがあります。 |
| An outside security audit | 外部のセキュリティ監査 |
| More than one block producer | 複数のブロック生成者 |
| Signature badges, proof codes and search by file | 署名バッジ、証明コード、ファイルからの検索 |
| Members-only polls and the Shelter corner | メンバー限定の投票とシェルターのコーナー |
| The site builder | サイトビルダー |
| TetSearch | TetSearch |
| Nodes that run in the browser (libp2p over WebRTC) | ブラウザで動くノード（WebRTC 上の libp2p） |
| Open block production | 誰でも参加できるブロック生成 |
| Developer tools for other apps | ほかのアプリ向けの開発者ツール |
| Get involved | 参加するには |
| Developers: open an issue or a pull request on GitHub. | 開発者の方: GitHub で issue かプルリクエストを開いてください。 |
| Issues | Issues |
| Pull requests | プルリクエスト |
| Researchers, organizations, anything else: | 研究者・団体の方、そのほかのご用件: |
| TET is a volunteer open-source project. There are no paid roles or tokens to offer. | TET はボランティアのオープンソースプロジェクトです。報酬のある役割や、提供できるトークンはありません。 |
| Find signatures by file or date | ファイルや日付で署名を探す |
| Drop or choose a file: its SHA-256 is computed in this tab, and the file is never uploaded. | ファイルをドロップするか選んでください。SHA-256 はこのタブで計算され、ファイル自体はアップロードされません。 |
| A file to find its signatures | 署名を探すファイル |
| Exact files only: re-compressed or edited copies won't match. | 完全に同じファイルだけが一致します。再圧縮や編集をしたコピーは一致しません。 |
| published from | 公開日 |
| to | から |
| list signatures in these dates | この期間の署名を一覧 |
| Only signatures their signers chose to publish are listed. Anonymous posts and votes are never in it. | 署名した本人が公開を選んだ署名だけが表示されます。匿名の投稿や投票が含まれることはありません。 |
| Published in this node's public signature registry, at your request. Keep the .sig.json: with it and the file, anyone can check the signature in Verify. | あなたの依頼により、このノードの公開署名台帳に公開しました。.sig.json は保管してください。それとファイルがあれば、誰でも「検証」で署名を確かめられます。 |
| No published signature matches. Only signatures their signers chose to publish are listed. | 一致する公開署名はありません。署名した本人が公開を選んだ署名だけが表示されます。 |
| Show this key's public signatures | この鍵の公開署名を表示 |
| the sample with one letter changed | 1文字だけ変えたサンプル |
| the sample file | サンプルファイル |
| Check your copy | 手元のものを確かめる |
| Your copy of the file | 手元のファイル |
| …or paste the text | …または文章を貼り付け |
| Your copy of the text | 手元の文章 |
| the text you pasted | 貼り付けた文章 |
| Check | 確かめる |
| check the sample file | サンプルファイルを確かめる |
| now change one letter and check again | 1文字変えて、もう一度確かめる |
| Matches: {what} is exactly the one that was marked. | 一致：{what}は、記録されたものとまったく同じです。 |
| Doesn't match: {what} is not the one that was marked. Even one changed byte makes a different fingerprint. | 一致しません：{what}は、記録されたものではありません。1バイト変わるだけで指紋が変わります。 |
| Looking it up… | 調べています… |
| Nobody has marked this exact file as genuine on this node. | このノードでは、このファイルとまったく同じものを本物として記録した人はいません。 |
| Nothing found. Only things their owners chose to publish are listed. | 見つかりませんでした。表示されるのは、持ち主が公開を選んだものだけです。 |
| Your file was marked as genuine | このファイルは本物として記録されています |
| Marked as genuine | 本物として記録されています |
| Who | 誰が |
| ID | ID |
| Everything this ID has marked | この ID が記録したものすべて |
| When | いつ |
| recorded on this node at {when} | {when} にこのノードで記録 |
| What | 何を |
| fingerprint (SHA-256) | 指紋（SHA-256） |
| Code | コード |
| This shows that this ID marked this exact file and when this node recorded it. It doesn't show who is behind the ID, or that the content is original or true. | 分かるのは、この ID がこのファイルそのものを記録したことと、このノードがそれを記録した時刻です。ID の持ち主が誰か、内容が独自のものか、正しいかは分かりません。 |
| Download the proof file | 証明ファイルをダウンロード |
| Mark as genuine | 本物として記録 |
| Pick a file or write some text, then press the button. You get a code anyone can use to check it. | ファイルを選ぶか文章を書いて、ボタンを押してください。誰でも確かめられるコードがもらえます。 |
| What to mark | 記録するもの |
| A file | ファイル |
| Some text | 文章 |
| Choose a file (it stays on your device) | ファイルを選ぶ（端末の外には出ません） |
| Text to mark | 記録する文章 |
| Write or paste the text… | 文章を書くか貼り付けてください… |
| Marking… | 記録しています… |
| Only the fingerprint (SHA-256) of your file or text is recorded, never the content. It's published on this node with your ID, so anyone can look it up. | 記録されるのはファイルや文章の指紋（SHA-256）だけで、中身は記録されません。あなたの ID とともにこのノードで公開されるので、誰でも調べられます。 |
| Your proof code | あなたの証明コード |
| Copied | コピーしました |
| Mark something else | ほかのものを記録する |
| Anyone can check it: type the code into the search box on the TET home page, or open the link. | 誰でも確かめられます。TET のトップページの検索欄にコードを入れるか、リンクを開いてください。 |
| This shows that your ID marked this exact file and when this node recorded it. It doesn't show who is behind the ID, or that the content is original or true. | 分かるのは、あなたの ID がこのファイルそのものを記録したことと、このノードがそれを記録した時刻です。ID の持ち主が誰か、内容が独自のものか、正しいかは分かりません。 |
| Enter a proof code, or drop a file here | 証明コードを入力するか、ファイルをここにドロップ |
| try it: verify this sample | 試してみる：このサンプルを確かめる |
| This record doesn't check out. Don't trust it. | この記録は確認できません。信用しないでください。 |
| Find marks by file or date | ファイルや日付で記録を探す |
| Proof code, or search threads | 証明コード、またはスレッド検索 |
| First marked as genuine | 最初に本物として記録されたもの |
| Also marked later, by another ID | 後から別の ID でも記録されたもの |
| Sealed prediction | 予言の封印 |
| A sealed prediction, opened | 封印された予言が公開されました |
| Checking it against the seal… | 封印と照らし合わせています… |
| Written by {when}, unchanged since. | {when} までに書かれ、それ以降変わっていません。 |
| Doesn't match any seal on this node: this text was changed, or never sealed here. | このノードのどの封印とも一致しません。文章が変えられたか、ここで封印されていません。 |
| Sealed by ID | 封印した ID |
| code | コード |
| opens {date} | 公開日 {date} |
| This was opened before its date ({date}). | 予定（{date}）より前に公開されています。 |
| This shows the text existed when this node recorded the seal, and hasn't changed since. It doesn't show the prediction was right, or that the author didn't seal many different predictions and open only the one that came true. | 分かるのは、このノードが封印を記録した時点でこの文章が存在し、それ以降変わっていないことです。予言が当たったかどうかは分かりません。また、作者がたくさんの違う予言を封印して、当たったものだけを公開した可能性も否定できません。 |
| Write a prediction and choose when it opens. Only its fingerprint is recorded now; the text stays hidden until you reveal it. | 予言を書いて、公開日を選んでください。今記録されるのは指紋だけで、公開するまで文章は誰にも見えません。 |
| Your prediction | あなたの予言 |
| e.g. It will snow in Tokyo on 1 December. | 例：12月1日、東京で雪が降る。 |
| Opens in | 公開まで |
| {n} days | {n}日間 |
| in {n} days | {n}日後 |
| (this node allows 1 to 30 days) | （このノードでは1〜30日後まで） |
| Sealing… | 封印しています… |
| Seal it | 封印する |
| Only a fingerprint of your prediction is recorded on this node, with your ID. Nobody can read it until you share the reveal link. | このノードに記録されるのは、予言の指紋とあなたの ID だけです。公開用リンクを共有するまで、誰も読めません。 |
| Sealed. It opens on {date}. | 封印しました。公開日は {date} です。 |
| The card: sealed, opening date, proof code | カード：封印・公開日・証明コード |
| Save the card | カードを保存 |
| I sealed a prediction. It opens on {date}. | 予言を封印しました。{date} に公開します。 |
| Share on X | X で共有 |
| Copy the share link | 共有リンクをコピー |
| Your reveal link: keep it private until {date} | 公開用リンク：{date} まで誰にも見せないでください |
| Anyone with this link can read the prediction. On the day, share it: that is the reveal. Lose it and the prediction can't be opened. | このリンクを持つ人は誰でも予言を読めます。当日にこれを共有すれば、それが公開になります。なくすと予言は公開できません。 |
| Copy the reveal link | 公開用リンクをコピー |
| Hashtag: #TET予言 | ハッシュタグ：#TET予言 |
| Marks (proof codes) and sealed predictions hold only a fingerprint and your ID, never the content. They're kept on this node, and the operator can hide them like anything else. | 記録（証明コード）と予言の封印が持つのは、指紋とあなたの ID だけで、中身は持ちません。このノードに保管され、運営者はほかのものと同じように非表示にできます。 |
| Posting anonymously unlinks the post from your ID: the proof shows a member wrote it, not which one. It doesn't hide your IP address from the node; for that, use Tor or your own node. | 匿名で投稿すると、投稿とあなたの ID は結びつきません。証明が示すのはメンバーの誰かが書いたことで、誰かは示しません。ノードからあなたの IP アドレスは隠れません。隠したいときは Tor か自分のノードを使ってください。 |
| Tap a named post's ID to send it a message. Anonymous posts can't be messaged: nothing in them says who wrote them. | 記名投稿の ID をタップすると、その人にメッセージを送れます。匿名投稿には送れません。誰が書いたかを示すものが何もないからです。 |
| No prover here, so posts show your ID. | この端末には証明器がないため、投稿にはあなたの ID が表示されます。 |
| shows your ID | あなたの ID が表示されます |
| list this board again (needs the board's passphrase) | この掲示板をもう一度掲載する（掲示板のパスフレーズが必要） |
| The board's passphrase (12 words) | 掲示板のパスフレーズ（12語） |
| The board's passphrase (12 words)… | 掲示板のパスフレーズ（12語）… |
| Turning on your inbox is public: it shows this ID can receive messages. | 受信箱をオンにしたことは公開されます。この ID がメッセージを受け取れることが分かります。 |
| A message proves which ID sent it, or for an anonymous one, that a member did. It doesn't prove who is behind that ID. | メッセージが証明するのは、どの ID が送ったか（匿名ならメンバーの誰かが送ったこと）です。その ID の持ち主が誰かは証明しません。 |
| That isn't a 64-character ID. | 64文字の ID ではありません。 |
| Turn on your inbox first (the banner above), then you can write to yourself. | 先に受信箱をオンにしてください（上のお知らせ）。そのあと自分宛てに書けます。 |
| That ID hasn't turned on its inbox yet, so it can't receive messages. | その ID はまだ受信箱をオンにしていないため、メッセージを受け取れません。 |
| To receive messages, turn on your inbox. | メッセージを受け取るには、受信箱をオンにしてください。 |
| Write to an ID | ID 宛てに書く |
| New: 64-character ID… | 新規：64文字の ID… |
| Can't be opened in this tab. | このタブでは開けません。 |
| A delivered file proves which ID sent it and that only the recipient can open it. It doesn't prove who is behind that ID, or that the file is what its name says. | 届いたファイルが証明するのは、どの ID が送ったかと、受け取った人しか開けないことです。その ID の持ち主が誰か、ファイルが名前どおりの中身かは証明しません。 |
| The recipient must be a 64-character ID. | 宛先は64文字の ID にしてください。 |
| Turn on your inbox first (the banner above), then you can send files to yourself. | 先に受信箱をオンにしてください（上のお知らせ）。そのあと自分宛てにファイルを送れます。 |
| Another ID | ほかの ID |
| To receive files, turn on your inbox. | ファイルを受け取るには、受信箱をオンにしてください。 |
| Recipient's ID | 宛先の ID |
| Send something first: that makes your ID and its inbox. | まず何か送ってください。それであなたの ID と受信箱ができます。 |
| Your vote is hidden only among the {n} listed members. The poll's maker chose the list: if they control most of those IDs, they can work out how the others voted. | あなたの票が隠れるのは、名簿の {n} 人の中だけです。名簿は投票の作成者が決めました。作成者がその ID の大半を握っていれば、ほかの人の投票内容を割り出せます。 |
| Members-only: list the IDs that may vote | メンバー限定：投票できる ID を指定する |
| IDs, one per line, at least 3. Each must have joined the anonymity set on this node. | ID を1行に1つ、3つ以上。どれもこのノードで匿名セットに参加済みである必要があります。 |
| The member list is public: anyone can see which IDs may vote, not how they voted. | 名簿は公開されます。どの ID が投票できるかは誰にでも見えますが、どう投票したかは見えません。 |
| No ID yet: your first post or message makes one in this tab. | まだ ID はありません。最初の投稿かメッセージで、このタブに作られます。 |
| your ID | あなたの ID |
| passphrase | パスフレーズ |
| hide passphrase | パスフレーズを隠す |
| Made in this tab, never sent anywhere. Close the tab without saving the passphrase and it is gone. | このタブで作られ、どこにも送られません。パスフレーズを保存せずにタブを閉じると消えます。 |
| no ID yet | ID はまだありません |
| shown once you have an ID | ID ができると表示されます |
| save passphrase | パスフレーズを保存 |
| Your ID is open in this tab. | このタブであなたの ID を開きました。 |
| Wrong device password. Try again, or open with your passphrase (12 words). | 端末パスワードが違います。もう一度試すか、パスフレーズ（12語）で開いてください。 |
| This device can't open your remembered ID. Open it with your passphrase (12 words) instead. | この端末では記憶した ID を開けません。代わりにパスフレーズ（12語）で開いてください。 |
| open your remembered ID | 記憶した ID を開く |
| ID options | ID の設定 |
| An ID is remembered on this device. Open it with your device password: | この端末に ID が記憶されています。端末パスワードで開いてください： |
| Anyone with this device and your device password can use your ID. A script injected into this page could read it while it's open. | この端末と端末パスワードがあれば、誰でもあなたの ID を使えます。開いている間に、このページに入り込んだスクリプトが読み取る可能性もあります。 |
| Remember my ID on this device | この端末に ID を記憶する |
| Remember my ID on this device (optional, encrypted) | この端末に ID を記憶する（任意・暗号化） |
| Device password | 端末パスワード |
| Device password (8 characters or more) | 端末パスワード（8文字以上） |
| Device password again | 端末パスワード（確認） |
| Use a device password of at least 8 characters. | 端末パスワードは8文字以上にしてください。 |
| The two device passwords differ. Type them again. | 2つの端末パスワードが一致しません。もう一度入力してください。 |
| Remembered on this device, encrypted with your device password. | 端末パスワードで暗号化して、この端末に記憶しました。 |
| pages marked as genuine, block by block | ブロックごとに本物として記録されるページ |
| Make a new site, or open yours with its passphrase (12 words). | 新しいサイトを作るか、パスフレーズ（12語）で自分のサイトを開いてください。 |
| Every block on a site is published by the site's own ID, in order, and readers check each one in their own tab. That doesn't show who is behind the ID, or that a person wrote the text. | サイトのすべてのブロックはサイト自身の ID によって順番に公開され、読む人は自分のタブで一つずつ確かめます。ID の持ち主が誰か、人が書いた文章かどうかは示しません。 |
| The site's passphrase (12 words) is what lets you edit it. The page doesn't keep it: write it down. | サイトのパスフレーズ（12語）が編集の鍵です。このページは保存しません。書き留めてください。 |
| Your site's passphrase (12 words) | サイトのパスフレーズ（12語） |
| Add a block and it appears. Each add or removal is one edit, marked as genuine by the site's ID. | ブロックを追加するとすぐ表示されます。追加や削除はそれぞれ1つの編集で、サイトの ID が本物として記録します。 |
| Saving… | 保存しています… |
| Export the proof file (.site.json) | 証明ファイルを書き出す (.site.json) |
| Save the board's passphrase (12 words), then open the board. | 掲示板のパスフレーズ（12語）を保存してから、掲示板を開いてください。 |
| This is the board's own passphrase (12 words), not yours. A listing lasts 7 days; to keep the board listed, announce it again with it (from the board's page). It's shown only now. | これは掲示板自身のパスフレーズ（12語）で、あなたのものではありません。掲載は7日間有効です。掲載を続けるには、掲示板のページからこのパスフレーズでもう一度告知してください。表示されるのは今だけです。 |
| A public board is listed in the directory with its invite, so anyone can read every post. It's listed by the board's own ID, not yours. | 公開掲示板は招待リンクとともに一覧に載るので、誰でもすべての投稿を読めます。掲載するのは掲示板自身の ID で、あなたの ID ではありません。 |
| An invite-only board is readable by anyone with its invite link. The link is what opens it; the part after the # is never sent to the node. | 招待制の掲示板は、招待リンクを持つ人なら誰でも読めます。リンクが開くための鍵で、# より後ろの部分はノードに送られません。 |
| Only a board's own ID can list it: listings by anyone else are ignored. Nobody can list your invite-only board. | 掲示板を掲載できるのは掲示板自身の ID だけで、ほかの人による掲載は無視されます。招待制の掲示板を誰かが掲載することはできません。 |
| A listing lasts 7 days after its newest announcement; to keep a board listed, announce it again with the board's passphrase (12 words). | 掲載は最新の告知から7日間有効です。掲載を続けるには、掲示板のパスフレーズ（12語）でもう一度告知してください。 |
| A listing proves the board's own ID listed it. It doesn't prove who runs the board or that its name is true. | 掲載が証明するのは、掲示板自身の ID が掲載したことです。誰が掲示板を運営しているか、名前が本当かは証明しません。 |
| Turning it on is public: it shows this ID can receive messages. | オンにしたことは公開されます。この ID がメッセージを受け取れることが分かります。 |
| Turn on inbox | 受信箱をオンにする |
| Name (optional) | 名前（任意） |
| Start the thread | スレッドを立てる |
| Post | 書き込む |
| anonymous | 匿名 |
| Newest threads | 新着スレッド |
| Keep this ID? Save your passphrase (12 words) | この ID を残しますか？パスフレーズ（12語）を保存 |
| This is a testnet. Data may be reset. | これはテストネットです。データはリセットされることがあります。 |
| No name | 名無しさん |
| Chosen by the poster, not checked. The ID beside it is what counts. | 投稿者が付けた名前で、確認されていません。隣の ID が本人の印です。 |
| Inside | TET の中身 |
| {n} hours | {n} 時間 |
| {d} (up to {m}) | {d}（最長 {m}） |
| On the chain; not deleted | チェーン上にあり、削除されません |
| Listed for {d} after each announcement | 告知のたびに {d} 掲載 |
| Threads on public boards | 公開掲示板のスレッド |
| Posts on public boards | 公開掲示板の書き込み |
| All messages and posts | すべてのメッセージと書き込み |
| Public and invite-only boards, and direct messages. The node can't read any of them, so it knows only the total; how many invite-only boards there are isn't known. | 公開・招待制の掲示板と、個人宛てのメッセージ。ノードはどれも読めないため、分かるのは合計だけです。招待制の掲示板がいくつあるかは分かりません。 |
| No expiry on this node | このノードでは期限なし |
| Sites | サイト |
| {d} after the last edit | 最後の編集から {d} |
| A list of sites is coming. | サイトの一覧は準備中です。 |
| What's inside TET | TET の中身 |
| Counted at {time}, on this node. | {time} 時点、このノードでの数です。 |
| The node didn't answer ({why}). | ノードから応答がありません（{why}）。 |
| Counting… | 数えています… |
| How many | 件数 |
| How long it's kept | 保存期間 |
| Anyone: questions, ideas and feedback in GitHub Discussions. | 誰でも：質問・アイデア・感想は GitHub Discussions へ。 |
| Discussions | ディスカッション |
| In an age when AI can make anything. | AIで何でも作れる時代に。 |
| Prove 'I put this out, on this day' in 10 seconds. | 『これを、この日に出したのは自分』を、10秒で証明。 |
| It proves when, and whose mark. Not who the author is. | 証明できるのは『いつ・誰の印か』まで。作者本人かどうかまでは証明しません。 |
| The node can't be reached right now. New messages will show when it's back. | いまノードにつながりません。つながれば新しいメッセージが表示されます。 |
| Today that protection is incomplete: your ID is still your Ed25519 key, and the ML-DSA-44 key isn't bound to it until the Phase 1 genesis. | ただし今の保護は不完全です。あなたの ID はまだ Ed25519 の鍵で、ML-DSA-44 の鍵が ID に結び付けられるのは Phase 1 のジェネシスからです。 |
| AI and TET | AI と TET |
| Members-only spaces are encrypted; public pages opt out of AI training crawlers that respect robots.txt. | メンバー限定の場はエンドツーエンドで暗号化されています。公開ページは、robots.txt を守る AI 学習用クローラーに対して収集を断っています。 |
| That opt-out is a request: crawlers that ignore robots.txt, or don't say who they are, aren't stopped by it. Anything public (blocks, transactions, public boards, published marks) can be read by anyone who runs a node, AI included. Only the members-only spaces are out of reach, because they're end-to-end encrypted. | この拒否はお願いにすぎません。robots.txt を無視するクローラーや、名乗らないクローラーは止められません。公開されているもの（ブロック、トランザクション、公開掲示板、公開された記録）は、ノードを動かす人なら誰でも、AI も含めて読めます。読めないのは、エンドツーエンドで暗号化されたメンバー限定の場だけです。 |
| Technical paper | 技術文書 |
| {amount} TET (practice unit, can't be exchanged for money) | {amount} TET（練習用の単位。お金とは交換できません） |
| Your anonymous posts on a board share one ID for the UTC day. The first carries a proof (about 30 s); the rest that day are instant. | 掲示板での匿名投稿は、UTC の1日の間ずっと同じ ID になります。最初の投稿に証明が付き（約30秒）、その日の残りはすぐに投稿できます。 |
| An anonymous post's ID (ID:ab12) comes from its proof: the same for one member on one board for one UTC day, and different tomorrow or on another board. Nobody running the node chooses it, and it appears only after the proof is checked. All of one member's anonymous posts on a board that day carry it, so they can be read as one person's; two members can share an ID by chance. | 匿名投稿の ID（ID:ab12）は証明から作られます。同じメンバー・同じ掲示板・同じ UTC の日なら同じで、翌日や別の掲示板では変わります。ノードの運営者が決めるものではなく、証明を確認したあとにだけ表示されます。その日にその掲示板で同じメンバーがした匿名投稿にはすべて同じ ID が付くので、同じ人の投稿だと分かります。偶然、2人のメンバーの ID が同じになることもあります。 |
| Anonymous posts here are instant for the rest of today. | この掲示板では、今日はこのあと匿名ですぐに投稿できます。 |
| The first anonymous post here today takes about 30 s to prove; the rest are instant. | 今日この掲示板での最初の匿名投稿は証明に約30秒かかります。そのあとはすぐに投稿できます。 |
| A members-only space. Joining needs an in-person vouch from a member. | メンバーだけの場所です。入るには、メンバーに直接会って推薦してもらう必要があります。 |
| Shelter isn't open on this node. | このノードではシェルターは開いていません。 |
| To join, a member who meets you in person scans your join code. | 入るには、直接会ったメンバーにあなたの参加コードを読み取ってもらいます。 |
| Show my join code | 参加コードを表示 |
| the moderator | モデレーター |
| That invite is for another board, not this node's Shelter board. | その招待は別の掲示板のものです。このノードのシェルターの掲示板ではありません。 |
| You're in. Waiting for the board key from the member who let you in. | 参加できました。あなたを推薦したメンバーから掲示板の鍵が届くのを待っています。 |
| Members | メンバー |
| Log | 記録 |
| House rule | ハウスルール |
| No posts yet. | まだ投稿はありません。 |
| Anonymous member | 匿名のメンバー |
| moderator | モデレーター |
| (can't be opened with this key) | （この鍵では開けません） |
| Members-only and end-to-end encrypted. Joining needs an in-person vouch. House rule: don't post AI-written text here. | メンバー限定で、エンドツーエンドで暗号化されています。入るには直接会っての推薦が必要です。ハウスルール：AI が書いた文章はここに載せないでください。 |
| This node serves Shelter only to members and never passes its posts to other nodes. | このノードはシェルターをメンバーにだけ表示し、投稿を他のノードに渡しません。 |
| Show this to a member, in person. They scan it (or type the code) to let you in. | これを直接会ったメンバーに見せてください。メンバーが読み取る（またはコードを入力する）とあなたが参加できます。 |
| Your join code | あなたの参加コード |
| Your membership belongs to this ID: save your passphrase so you can come back. | メンバーであることはこの ID にひも付きます。また来られるように、合言葉を保存してください。 |
| Waiting for a member to let you in… | メンバーが参加させてくれるのを待っています… |
| Don't post AI-written text here. | ここに AI が書いた文章は載せないでください |
| This is a promise between members, not a filter. TET can't tell who or what wrote a text. | これはメンバー同士の約束で、フィルターではありません。TET には、文章を誰が・何が書いたかは分かりません。 |
| What this proves: a vouched member wrote each post, and the space isn't open to outside AI crawlers. | これで分かること：各投稿は推薦されたメンバーが書いたこと、そしてこの場所が外部の AI クローラーに開かれていないこと。 |
| What it doesn't prove: that no AI was used (a member can still paste AI-written text), or that members won't copy posts out. | 分からないこと：AI が使われていないこと（メンバーが AI の書いた文章を貼ることはできます）、メンバーが投稿を外に持ち出さないこと。 |
| Who let you in: {who} | あなたを参加させた人：{who} |
| I'll keep the house rule | ハウスルールを守ります |
| Set Shelter's board: paste its invite once. It's sealed to you; the node can't read it. | シェルターの掲示板を設定します。招待を一度だけ貼り付けてください。あなただけが開けるよう封をして保存され、ノードには読めません。 |
| The board's invite | 掲示板の招待 |
| Set the board | 掲示板を設定 |
| Anonymous posting needs at least {n} members in the anonymity set. | 匿名で投稿するには、匿名グループに少なくとも {n} 人のメンバーが必要です。 |
| Proving you're a member (about 30 s the first time today)… | メンバーであることを証明しています（今日の最初は約30秒）… |
| Not sent. | 送信されませんでした。 |
| Your posting is suspended until {date}. | {date} まで投稿は停止されています。 |
| Nickname | ニックネーム |
| Set nickname | ニックネームを設定 |
| Post anonymously instead | 代わりに匿名で投稿 |
| Post as | 投稿する名前 |
| As {nick} | {nick} として |
| Anonymously | 匿名で |
| Anonymous here means other members can't tell which member wrote it. The node operator still sees which device sent it. | ここでの匿名とは、どのメンバーが書いたかを他のメンバーが分からないという意味です。ノードの運営者には、どの端末から送られたかは見えます。 |
| Join the anonymity set to post anonymously here (it takes effect at the next epoch). | ここで匿名投稿するには匿名グループに参加してください（次の区切りから有効になります）。 |
| Anonymous posting needs at least {n} members in the anonymity set; there are {k}. | 匿名で投稿するには、匿名グループに少なくとも {n} 人のメンバーが必要です。今は {k} 人です。 |
| Anonymous posting needs the native prover on your own computer. | 匿名投稿には、自分のコンピューターで動く証明プログラムが必要です。 |
| Write to members… | メンバーに書く… |
| Invite someone | 誰かを招待 |
| Let someone in | 誰かを参加させる |
| {n} invites left. | 招待はあと {n} 回。 |
| {n} vouches left. | 推薦はあと {n} 回。 |
| No invites left. | 招待は残っていません。 |
| You have no vouches left, or someone you vouched for was confirmed as a bot. | 推薦の回数が残っていないか、あなたが推薦した人がボットだと確認されました。 |
| Stop scanning | 読み取りをやめる |
| Scan their code | 相手のコードを読み取る |
| Their join code | 相手の参加コード |
| I met this person in person. | この人に直接会いました。 |
| {who} is in. Their board key is sealed to them. | {who} が参加しました。掲示板の鍵は本人だけが開けるよう封をして渡しました。 |
| Let them in | 参加させる |
| let in by {who} | {who} が参加させた |
| Hand over the key again | 鍵をもう一度渡す |
| Confirm as a bot… | ボットだと確認… |
| What showed it (members see this) | 根拠（メンバーに表示されます） |
| Confirm case | 確認する |
| Change nickname | ニックネームを変更 |
| Leave? Your vouches stay used. Tap again to leave. | 抜けますか？使った推薦の回数は戻りません。もう一度押すと抜けます。 |
| Leave Shelter | シェルターを抜ける |
| invited | が招待： |
| vouched for | が推薦： |
| left | が抜けました |
| confirmed a bot case against | がボットだと確認： |
| decided the appeal of a case | が異議申し立てを判断 |
| Cases | 確認された件 |
| Appeal: overturned | 異議申し立て：取り消し |
| Appeal: kept | 異議申し立て：維持 |
| Appeal open until {date} | 異議申し立ては {date} まで |
| No appeal | 異議申し立てなし |
| Why (members see this) | 理由（メンバーに表示されます） |
| Overturn | 取り消す |
| Keep | 維持する |
| Decide the appeal | 異議申し立てを判断 |
| (overturned) | （取り消し） |
| (kept) | （維持） |
| Joining: a member vouches for you in person, by scanning your code. Each member can vouch for 3 people; the moderator invites up to 10. | 参加：メンバーが直接会って、あなたのコードを読み取って推薦します。メンバーは1人3人まで推薦でき、モデレーターは10人まで招待できます。 |
| If a key turns out to be run by a bot, it's removed, and whoever vouched for it can't vouch any more. A second case against the same member suspends their posting for 90 days. | ある鍵がボットに使われていると分かったら、その鍵は外され、推薦した人はもう推薦できなくなります。同じメンバーに2件目があると、その人の投稿は90日間止まります。 |
| Appeals: within 14 days. An overturned case restores everything it took. | 異議申し立て：14日以内。取り消された件は、失われたものがすべて元に戻ります。 |
| For now there is one moderator, who decides cases and appeals alone. That's weaker than two people agreeing; every decision is in the log, which all members can see. | 今はモデレーターが1人で、確認も異議申し立ても1人で判断します。2人の合意より弱いやり方です。判断はすべて記録に残り、メンバー全員が見られます。 |
| Posts are end-to-end encrypted to members; this node serves Shelter only to members and never passes its posts to other nodes. | 投稿はメンバー向けにエンドツーエンドで暗号化されます。このノードはシェルターをメンバーにだけ表示し、投稿を他のノードに渡しません。 |
| Each member has a number, given in the order members were let in. A nickname can look like another; the number next to it can't be chosen or copied. | メンバーにはそれぞれ番号があり、参加した順に付きます。ニックネームは別の人と似せられますが、横の番号は選ぶことも真似することもできません。 |
| Choose a nickname first. Members see it next to your posts, with your member number. | まずニックネームを決めてください。メンバーには、投稿の横にあなたのメンバー番号と一緒に表示されます。 |
| The member who lets you in hands you the board key through your inbox. | あなたを参加させるメンバーは、受信箱を通して掲示板の鍵を渡します。 |
| A delivered file proves which ID sent it. Only the recipient can open it, if the safety number you see for them in DM matches theirs. It doesn't prove who is behind that ID, or that the file is what its name says. | 届いたファイルは、どの ID が送ったかを示します。開けるのは受取人だけです（DM で見える安全番号が相手と一致していれば）。その ID の背後に誰がいるか、ファイルが名前どおりの中身かは示しません。 |
| Compare this number with the other person, in person or on a call. If both of you see the same number, only the two of you can read your messages. If the numbers differ, someone in between may be reading along: don't send anything private. | この番号を相手と、直接または通話で見比べてください。2人とも同じ番号なら、メッセージを読めるのは2人だけです。番号が違うなら、途中の誰かが読んでいるおそれがあります。大事なことは送らないでください。 |
| The node operator can't read posts, as long as each member's page checks the keys it seals the board key to (it does) and you compare safety numbers when you meet. It sees which ID reads and posts, when, and from which address. | ノードの運営者は投稿を読めません。ただし、各メンバーの画面が掲示板の鍵を渡す相手の鍵を確認していること（確認しています）と、会ったときに安全番号を見比べることが条件です。どの ID がいつ、どのアドレスから読んだり投稿したりしたかは見えます。 |
| Board key from {who}: check it's the member who let you in. | 掲示板の鍵の送り主：{who}。あなたを参加させたメンバーか確かめてください。 |
| On a device managed by your school or employer, the admin can see everything. | 学校や会社が管理している端末では、管理者がすべてを見られます。 |
| Open an ID with your passphrase (12 words) | 合言葉（12語）で ID を開く |
| Open an ID with your passphrase (12 words): | 合言葉（12語）で ID を開く： |
| Those aren't 12 valid words. Check them and try again. | 正しい12語ではありません。確認してもう一度試してください。 |
| TET asks for your passphrase (12 words) only on the restore screen; support never DMs you. | TET が合言葉（12語）を求めるのは復元画面だけです。サポートが DM で聞くことはありません。 |
| Lose your passphrase (12 words) and nobody can recover it. | 合言葉（12語）をなくすと、誰にも復旧できません。 |
| Your passphrase (12 words) | あなたの合言葉（12語） |
| That device password is too common. A few words you'll remember is easiest. | その端末パスワードはよく使われすぎています。覚えやすい単語をいくつか並べるのが簡単です。 |
| That device password is too easy to guess. Use 12 or more characters, or mix letters, digits and symbols. | その端末パスワードは推測されやすすぎます。12文字以上にするか、文字・数字・記号を混ぜてください。 |
| A remembered ID locks itself after 15 minutes without use; open it again with your device password. | 端末に覚えさせた ID は、15分使わないと自動でロックされます。端末パスワードでまた開けます。 |
| Even if TET disappears, this still works: | TET がなくなっても、これは動きます： |
| the offline verifier | オフライン検証ツール |
| (one file: it checks a record on your device, with the network off) | （1つのファイル。ネットに接続しなくても、あなたの端末で記録を確認します） |
| The testnet's genesis contains a founder wallet, locked by a one-year cliff, and a treasury address that collects test fees. This chain can never become mainnet; mainnet supply and allocation are undecided. | テストネットのジェネシスには、1年のクリフでロックされた創設者のウォレットと、テスト用の手数料を集めるトレジャリーのアドレスが入っています。このチェーンがメインネットになることはありません。メインネットの総量と配分は未定です。 |
| Draft translation of the English version at commit {commit}; the English version is authoritative. This translation isn't marked yet: the proof codes below are for the English files. | コミット {commit} 時点の英語版の翻訳（下書き）です。英語版が正本です。この翻訳にはまだ印が付いていません。下の証明コードは英語版のファイルのものです。 |
| This paper isn't translated into this language yet. Below is the English version, which is authoritative. | この文書はまだこの言語に翻訳されていません。下は英語版で、英語版が正本です。 |
| {date} · written against commit {commit} · the public seeds run {seeds} · this is a testnet; data may be reset | {date} · コミット {commit} に基づいて執筆 · 公開シードは {seeds} を実行中 · テストネットなので、データはリセットされることがあります |
| (the code) | （コード） |
| Download the PDF (English) | PDF をダウンロード（英語） |
| proof code {code} (marks this PDF file) | 証明コード {code}（この PDF ファイルの印） |
| Version 1 (2026-10-09, superseded, kept): | 第1版（2026-10-09、置き換え済み、保存しています）: |
| proof codes {a} and {b} | 証明コード {a} と {b} |
| Contents | 目次 |
| Sources: | 出典: |
| The English text of this paper ({file}, SHA-256 {sha}) is marked with proof code {code}. It proves this ID marked exactly that text; not who wrote it. | この文書の英語版の本文（{file}、SHA-256 {sha}）には証明コード {code} の印が付いています。この ID がまさにその本文に印を付けたことを証明します。誰が書いたかは証明しません。 |
| TET technical paper | TET 技術文書 |
| Anonymous | 匿名さん |

## 3. The offline verifier (`tet-network/ui/scripts/build_offline_verifier.mjs`, `L.ja`)

| Key | 日本語 |
|---|---|
| title | TET なしで検証 |
| lead | <b>TET がなくなっても、これは動きます。</b>この1つのファイルが、TET の署名記録をあなたの端末の上で確かめます。どこにも何も送らず、どのサーバーにも問い合わせません。ネットワークを切った状態でも使えます。 |
| record | 記録（.sig.json または .record.json） |
| file | 印が付いたファイル（任意。あなたの端末から出ません） |
| chain | 署名が結びついているチェーン |
| cid | チェーン ID |
| gh | ジェネシスハッシュ |
| go | 検証する |
| lang | 言語 |
| what | これが確かめること |
| l1 | レベル1。オフラインで、チェーンは要りません: 記録にある2つの鍵（Ed25519 と ML-DSA-44）が、このチェーン向けにこの SHA-256 に署名したこと。ファイルを渡せば、そのハッシュがまさにそれと一致すること。鍵を誰が持っているか、内容が本当か、いつ署名されたかは証明しません。 |
| l2 | レベル2（チェーンの写しに含まれていることの確認）は次の段階です。今の TET は1つのブロック生成者と1人の運営者に頼っているので、ブロックに生成者の署名が付くまでは、チェーンの写しはそれ自体の中で矛盾がないかしか確かめられません。生成者を増やすことと外部からの確認は計画中です（ロードマップの段階 3 と 9）。 |
| genuine | このファイルが本物か確かめるには: その SHA-256 は TET の印と一緒に公開されていて、ソースは TET-OS のリポジトリ（tet-network/ui/scripts/build_offline_verifier.mjs）にあります。 |
| other | 別のチェーン… |
| noEd | このブラウザには Ed25519 が組み込まれていません。最新の Chrome、Edge、Firefox、Safari か、CLI を使ってください。 |
| chooseRecord | 記録ファイル（.sig.json または .record.json）を選んでください。 |
| no | 検証できません:  |
| signer | 署名者（Ed25519）:  |
| publisher |   — これは TET の発行者 ID です。 |
| mldsa | ML-DSA-44 の鍵:  |
| matches | 渡されたファイルは完全に一致しました。 |
| noFile | ファイルが渡されていません: この SHA-256 をあなたのファイルのもの（どの SHA-256 ツールでも）と比べてください。 |
| code | 証明コード:  |
| limit | 鍵がこれに署名したことを証明します。鍵を誰が持っているか、内容が本当か、いつ署名されたかは証明しません。 |

Error reasons and the result lines are in the same block (`reasons`, `verified`).
