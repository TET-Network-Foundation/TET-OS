# Wording audit: "prove", "proof" and 証明 in the UI

Read-only. Every user-facing string in `tet-network/ui/app` that says *prove*, *proves*, *proven*, *proving*, *proof(s)*, 証明 or 證明, with file and line, as of `cd60e58` (2026-11-08). Nothing here changes code; the owner decides what changes.

The wording rule this checks against: a mark shows which key signed and before which block. It never proves, never names a date, never says who.

| Group | Rows (a page translation sits under its English row; the paper's translations are rows of their own) | Decision |
|---|---|---|
| **A**: claims authorship, or says who | 8 | must change |
| **B**: describes what a signature or proof check shows | 97 | owner decides |
| **C**: "proof" as the name of a thing (proof code, proof file, zero-knowledge proof) | 58 | owner decides |
| Translations whose English key has no such word | 40 | listed separately |

Lines are counted in the file as it is at that commit. A source string's ja and zh-HK translations are listed under it (`i18n_ja.ts`, `i18n_zh_hk.ts`). The paper's translations (`paper_ja.ts`, `paper_zh_hk.ts`) are separate files and listed on their own.

## A. Claims authorship, or says who: must change

Each of these tells the reader who did something, or that TET can show who. A mark shows a key, not a person.

| Where | Lang | Text |
|---|---|---|
| `app/try/HowPanel.tsx:122` | en | Proves you scanned the venue QR. Not that you were there: someone could pass the code on within 30 seconds. |
| ↳ `app/try/i18n_ja.ts:456` | ja | 会場のQRを読み取ったことを証明。その場にいたことは証明しません（30秒以内に誰かが転送できます）。 |
| ↳ `app/try/i18n_zh_hk.ts:456` | zh-HK | 證明你掃描了會場的 QR 碼。不證明你在場：有人可在 30 秒內把碼轉傳。 |
| `app/whitepaper/paper.ts:22` | en | Your proofs and keys, in your hands, not a company's. TET is a public test network for checking who signed something, and when: every transaction and signed record carries two signatures, Ed25519 and ML-DSA-44; members can post anonymously with a RISC Zero membership proof; messages and files are end-to-end encrypted with X25519 and CRYSTALS-Kyber-768 (Round 3), with keys and senders checked in the browser. This paper describes what the code does at the commit named above, including what it does not protect; Sections 11 and 13 are the parts about plans. |
| `app/whitepaper/paper.ts:50` | en | What TET is for: proofs of who, when and what that anyone can check without trusting a company, and that stay checkable if TET itself disappears. What each neighbouring system is for, and what TET adds or leaves to it: |
| `app/whitepaper/paper_ja.ts:19` | ja | 自分の証明と鍵を、会社から自分の手に。TET は、誰がいつ何に署名したかを確かめるための公開テストネットです。すべての取引と署名付きの記録には、Ed25519 と ML-DSA-44 の2つの署名が付きます。メンバーは RISC Zero のメンバー証明を使って匿名で投稿できます。メッセージとファイルは X25519 と CRYSTALS-Kyber-768（Round 3）でエンドツーエンドで暗号化され、鍵と送り主はブラウザで確かめられます。この文書は、上に書いたコミットの時点でコードが何をするかを、守れないことも含めて説明します。計画について書いた部分は第11節と第13節です。 |
| `app/whitepaper/paper_ja.ts:48` | ja | TET の役目: 誰が、いつ、何を、の証明を、会社を信用せずに誰でも確かめられるようにすること。そして TET 自体がなくなっても確かめられ続けること。近くにある仕組みがそれぞれ何のためにあり、TET が何を足し、何をそちらに任せるか: |
| `app/whitepaper/paper_ja.ts:56` | ja | いつ、だけでなく誰が署名したか。匿名のメンバー証明 |
| `app/whitepaper/paper_zh_hk.ts:19` | zh-HK | 自己的證明與金鑰，從公司手中拿回自己手上。TET 是一個公開測試網，用來核實誰在何時簽署了甚麼：每宗交易及每份已簽署的紀錄都帶有兩個簽名，Ed25519 及 ML-DSA-44；成員可憑 RISC Zero 成員證明匿名發帖；訊息及檔案以 X25519 及 CRYSTALS-Kyber-768（第三輪）作端對端加密，金鑰及寄件人都在瀏覽器內核實。本文件描述程式碼在上述 commit 時的實際行為，包括它保護不到的地方；第 11 及第 13 節是關於計劃的部分。 |
| `app/whitepaper/paper_zh_hk.ts:48` | zh-HK | TET 的用途：提供關於誰、何時、甚麼的證明，任何人都可以在不信任任何公司的情況下核實，而且即使 TET 本身消失，仍然可以核實。以下是相鄰系統各自的用途，以及 TET 補充了甚麼、留給它們做甚麼： |

## B. Describes what a signature or proof check shows: owner decides

These say what a check establishes, mostly next to what it doesn't ("…, not who holds it"). Many use *proves* where the rule would say *shows*. Hand-checked: rows that say "doesn't prove who …" are limits, and "Proving you're a member" is the membership proof running, so neither is in A.

| Where | Lang | Text |
|---|---|---|
| `app/i18n/translations.ts:401` | en | Cryptographically Signed • Mathematically Proven • 100% Self-Sovereign |
| `app/i18n/translations.ts:513` | en | Keep your vault non-custodial: the device holds private keys; the network receives signatures and proofs only. |
| `app/i18n/translations.ts:543` | en | Most requests route to fast, local inference. Disputes escalate to a small, enforceable court path that can prove execution against public rules. |
| `app/i18n/translations.ts:555` | en | A Proof of Compute |
| `app/i18n/translations.ts:557` | en | TET is an accounted unit for verifiable work. Value flows when execution is proven and accepted under the network’s public rules. |
| `app/i18n/translations.ts:568` | en | Each request can be authorized by an Ed25519 signature (and, when required, a quantum-resistant ML-DSA-44 signature), proving intent without trusting a central server. |
| `app/i18n/translations.ts:606` | en | Dispute escalated. Cryptographic proof verified against public network rules. |
| `app/i18n/translations.ts:615` | en | Verifies proof against public rules. |
| `app/i18n/translations.ts:644` | en | The remaining “1” is enforcement: if a result is disputed, the request can escalate to a ZK Court path that proves or rejects contested execution against public rules. |
| `app/i18n/translations.ts:669` | en | Eliminate API key liability and prove what was executed. |
| `app/i18n/translations.ts:850` | en | 暗号による署名 • 数学による証明 • 完全な自己主権 |
| `app/i18n/translations.ts:959` | en | Vaultはノンカストディアルです。秘密鍵は端末内に保持され、ネットワークへ送るのは署名と証明のみです。 |
| `app/i18n/translations.ts:989` | en | 多くのリクエストは高速なローカル推論へルーティングされます。争いが起きた場合のみ、公開ルールに対して実行を証明できるZK Courtへエスカレートします。 |
| `app/i18n/translations.ts:1001` | en | 投機ではなく、コンピュートの証明 |
| `app/i18n/translations.ts:1003` | en | TETは検証可能な仕事のための計上単位です。実行が証明され、公開ルールの下で受理されたときに価値が流れます。 |
| `app/i18n/translations.ts:1014` | en | 各リクエストはEd25519署名（必要に応じて量子耐性のML-DSA-44署名）で認可でき、中央サーバーを信頼せずに意思を数学的に証明できます。 |
| `app/i18n/translations.ts:1052` | en | 争いが発生した場合のみエスカレートし、公開ルールに対して暗号学的証明を検証します。 |
| `app/i18n/translations.ts:1061` | en | 公開ルールに対して証明を検証します。 |
| `app/i18n/translations.ts:1090` | en | 残りの（1）は執行層です。結果が争われたときだけ、公開ルールに対して実行を証明/否定できるZK Courtへエスカレーションします。 |
| `app/i18n/translations.ts:1115` | en | APIキーの負債をなくし、“何が実行されたか” を証明する。 |
| `app/lib/site_lang.ts:214` | en | <footer><p>${esc(PROVES[lang](version))}</p> |
| `app/lib/tmail_anon.ts:120` | en | ANONYMOUS — PROOF FAILED |
| `app/lib/tmail_anon.ts:128` | en | ANONYMOUS — PROOF PENDING |
| `app/os/OsClient.tsx:1461` | en | Workers will compete to process it, generate proof, and settle the result on-chain. |
| `app/os/OsClient.tsx:1539` | en | ${now}  [WORKER] Watch rewards: AI Tasks Cleared -> ZK Proof Wins -> Live Balance |
| `app/os/tabs/WorkerPanel.tsx:200` | en | ZK Proof Wins |
| `app/s/[site]/page.tsx:56` | en | Proves this site's key published every block, in this order. Not who holds the key. |
| ↳ `app/try/i18n_ja.ts:623` | ja | このサイトの鍵がすべてのブロックをこの順番で公開したことを証明します。鍵を誰が持っているかは示しません。 |
| ↳ `app/try/i18n_zh_hk.ts:623` | zh-HK | 證明此網站的鑰匙按此順序發佈了每個區塊。不表示鑰匙由誰持有。 |
| `app/try/BoardPanel.tsx:57` | en | anonymous · proof failed |
| ↳ `app/try/i18n_ja.ts:6` | ja | 匿名 · 証明が通らず |
| ↳ `app/try/i18n_zh_hk.ts:6` | zh-HK | 匿名 · 證明不成立 |
| `app/try/BoardPanel.tsx:58` | en | anonymous · checking proof |
| ↳ `app/try/i18n_ja.ts:7` | ja | 匿名 · 証明を確認中 |
| ↳ `app/try/i18n_zh_hk.ts:7` | zh-HK | 匿名 · 正在檢查證明 |
| `app/try/BoardPanel.tsx:170` | en | Your anonymous posts on a board share one ID for the UTC day. The first carries a proof (about 30 s); the rest that day are instant. |
| ↳ `app/try/i18n_ja.ts:915` | ja | 掲示板での匿名投稿は、UTC の1日の間ずっと同じ ID になります。最初の投稿に証明が付き（約30秒）、その日の残りはすぐに投稿できます。 |
| ↳ `app/try/i18n_zh_hk.ts:915` | zh-HK | 你在同一討論區的匿名帖文，在同一 UTC 日內共用一個 ID。第一則附有證明（約 30 秒），當日其後的帖文即時發出。 |
| `app/try/BoardPanel.tsx:544` | en | The first anonymous post here today takes about 30 s to prove; the rest are instant. |
| ↳ `app/try/i18n_ja.ts:918` | ja | 今日この掲示板での最初の匿名投稿は証明に約30秒かかります。そのあとはすぐに投稿できます。 |
| ↳ `app/try/i18n_zh_hk.ts:918` | zh-HK | 今日在此討論區的第一則匿名帖文需約 30 秒證明；其後即時發出。 |
| `app/try/BoardPanel.tsx:678` | en | Daily ID: from this post's proof. Same member, same board, same UTC day: same ID. |
| ↳ `app/try/i18n_ja.ts:287` | ja | 日替わりID: この投稿の証明から得たものです。同じメンバー・同じ掲示板・同じUTCの日なら同じIDです。 |
| ↳ `app/try/i18n_zh_hk.ts:287` | zh-HK | 每日 ID：來自此帖文的證明。同一成員、同一討論區、同一 UTC 日，ID 相同。 |
| `app/try/DirectoryPanel.tsx:27` | en | A listing proves the board's own ID listed it. It doesn't prove who runs the board or that its name is true. |
| ↳ `app/try/i18n_ja.ts:872` | ja | 掲載が証明するのは、掲示板自身の ID が掲載したことです。誰が掲示板を運営しているか、名前が本当かは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:872` | zh-HK | 列出證明是討論區自己的 ID 列出的。它不證明誰營運該討論區，也不證明其名稱屬實。 |
| `app/try/FilesTryPanel.tsx:41` | en | A delivered file proves which ID sent it. Only the recipient can open it, if the safety number you see for them in DM matches theirs. It doesn't prove who is behind that ID, or that the file is what its name says. |
| ↳ `app/try/i18n_ja.ts:1015` | ja | 届いたファイルは、どの ID が送ったかを示します。開けるのは受取人だけです（DM で見える安全番号が相手と一致していれば）。その ID の背後に誰がいるか、ファイルが名前どおりの中身かは示しません。 |
| ↳ `app/try/i18n_zh_hk.ts:1015` | zh-HK | 已送達的檔案證明由哪個 ID 傳送。只有收件人能開啟（前提是你在 DM 看到的安全號碼與對方的一致）。它不能證明該 ID 背後是誰，亦不能證明檔案內容與檔名相符。 |
| `app/try/GenuineCheck.tsx:210` | en | ${h.code}.proof.json |
| `app/try/GenuinePanel.tsx:147` | en | ${done.code}.proof.json |
| `app/try/HowPanel.tsx:55` | en | Proves this key signed these exact bytes (and, stamped, that they existed by a block). Not who holds the key. |
| ↳ `app/try/i18n_ja.ts:418` | ja | この鍵がこのバイト列に署名したこと（刻めばその時点で存在したこと）を証明。鍵を誰が持つかは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:418` | zh-HK | 證明這條鑰匙簽署了這些位元組（蓋章後亦證明它們在某個區塊之前已存在）。不證明誰持有鑰匙。 |
| `app/try/HowPanel.tsx:60` | en | Each step says what it proves; a valid signature alone doesn't say who holds the key. |
| ↳ `app/try/i18n_ja.ts:420` | ja | 各段階が証明する範囲を表示。署名だけでは鍵の持ち主は分かりません。 |
| ↳ `app/try/i18n_zh_hk.ts:420` | zh-HK | 每一步都會說明它證明甚麼；單憑有效簽名並不知道誰持有鑰匙。 |
| `app/try/HowPanel.tsx:65` | en | An anonymous post proves a member wrote it, not which one. It doesn't hide your IP from the node. |
| ↳ `app/try/i18n_ja.ts:422` | ja | 匿名投稿は「メンバーの誰か」が書いたことを証明します。誰かは示しません。ノードからIPは隠しません。 |
| ↳ `app/try/i18n_zh_hk.ts:422` | zh-HK | 匿名帖文證明由某位成員所寫，不顯示是哪一位。它不會向節點隱藏你的 IP。 |
| `app/try/HowPanel.tsx:70` | en | Proves which key sent it. The node still sees who writes to whom, and when. |
| ↳ `app/try/i18n_ja.ts:424` | ja | どの鍵が送ったかを証明。誰が誰にいつ送ったかはノードに見えます。 |
| ↳ `app/try/i18n_zh_hk.ts:424` | zh-HK | 證明是哪條鑰匙發出的。節點仍看得到誰在何時寫給誰。 |
| `app/try/HowPanel.tsx:75` | en | Only the recipient can open it. Doesn't prove the file is what its name says. |
| ↳ `app/try/i18n_ja.ts:426` | ja | 受け取った人だけが開けます。名前どおりの中身かは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:426` | zh-HK | 只有收件人能開啟。不證明檔案內容與名稱相符。 |
| `app/try/HowPanel.tsx:93` | en | Drop the work, sign it, stamp it, and show it as a QR. Proves this key had this exact file at that block; not authorship by itself, or that nobody had it earlier. |
| ↳ `app/try/i18n_ja.ts:437` | ja | 作品を置いて署名し、刻んでQRにします。この鍵がその時点でこのファイルを持っていたことを証明します。それだけで作者であることや、それより前に誰も持っていなかったことは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:437` | zh-HK | 放入作品、簽署、蓋章，再以 QR 顯示。證明這條鑰匙在該區塊時持有這個檔案；本身不證明作者身份，亦不證明之前無人持有。 |
| `app/try/HowPanel.tsx:120` | en | Proves the text was fixed when it was sealed. Doesn't prove it was a good guess, or that the same person didn't seal other predictions too. |
| ↳ `app/try/i18n_ja.ts:450` | ja | 封印した時点で文が決まっていたことを証明。当たったことや、同じ人がほかの予想も封印していないことは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:450` | zh-HK | 證明內容在密封時已確定。不證明猜得好，亦不證明同一人沒有密封其他預測。 |
| `app/try/HowPanel.tsx:123` | en | The recipient must opt in to receive them, and nothing is shown publicly unless the recipient chooses to. Proves a member wrote it, not which one. |
| ↳ `app/try/i18n_ja.ts:459` | ja | 受け取る側が受け取りを選んだときだけ届き、本人が選ばない限り公開されません。メンバーの誰かが書いたことを証明し、誰かは示しません。 |
| ↳ `app/try/i18n_zh_hk.ts:459` | zh-HK | 收件人須選擇接收才會收到，除非收件人選擇公開，否則不會公開顯示。證明由某位成員所寫，不顯示是哪一位。 |
| `app/try/HowPanel.tsx:198` | en | A post proves a member wrote it. It does not prove no AI was used. |
| ↳ `app/try/i18n_ja.ts:495` | ja | 投稿は「メンバーが書いた」ことを証明します。AIが使われていないことは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:495` | zh-HK | 帖文證明由成員所寫，不證明沒有使用 AI。 |
| `app/try/MailPanel.tsx:49` | en | A message proves which ID sent it, or for an anonymous one, that a member did. It doesn't prove who is behind that ID. |
| ↳ `app/try/i18n_ja.ts:816` | ja | メッセージが証明するのは、どの ID が送ったか（匿名ならメンバーの誰かが送ったこと）です。その ID の持ち主が誰かは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:816` | zh-HK | 訊息證明是哪個 ID 發出的，匿名訊息則證明由某位成員發出。它不證明 ID 背後是誰。 |
| `app/try/ProofCode.tsx:44` | en | The code finds it; the signature proves it. |
| ↳ `app/try/i18n_ja.ts:526` | ja | コードで見つけ、署名で証明します。 |
| ↳ `app/try/i18n_zh_hk.ts:526` | zh-HK | 證明碼用來找到它；簽名才證明它。 |
| `app/try/ProofCode.tsx:45` | en | Proves this key signed this file's SHA-256, and that it was published on this node at that time. Doesn't prove the work is original or that a person made it. |
| ↳ `app/try/i18n_ja.ts:527` | ja | この鍵がこのファイルの SHA-256 に署名し、その時点でこのノードに公開されたことを証明します。作品がオリジナルであることや、人が作ったことは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:527` | zh-HK | 證明這條鑰匙簽署了此檔案的 SHA-256，並於當時在此節點發佈。不證明作品是原創，亦不證明由人所製作。 |
| `app/try/ProofCode.tsx:128` | en | The code finds it; the signature proves it. |
| ↳ `app/try/i18n_ja.ts:526` | ja | コードで見つけ、署名で証明します。 |
| ↳ `app/try/i18n_zh_hk.ts:526` | zh-HK | 證明碼用來找到它；簽名才證明它。 |
| `app/try/QuestionsPanel.tsx:27` | en | An owner is only as trustworthy as the manifest: it proves the owner vouched for the key, not who runs the agent. “Automated” is the owner's declaration. |
| ↳ `app/try/i18n_ja.ts:157` | ja | 所有者を信頼できるかはマニフェスト次第です。マニフェストが証明するのは所有者がその鍵を認めたことで、誰がエージェントを動かしているかではありません。「自動」は所有者の申告です。 |
| ↳ `app/try/i18n_zh_hk.ts:157` | zh-HK | 擁有者的可信程度只取決於清單：它證明擁有者認可該鑰匙，並不證明誰在運行代理人。「自動化」只是擁有者的聲明。 |
| `app/try/SearchPanel.tsx:95` | en | Proves: each result's site was listed by a vouched member and every block on it is signed by the site's key. Doesn't prove: that a person wrote it, or that it's true. |
| ↳ `app/try/i18n_ja.ts:1082` | ja | 証明すること: 各結果のサイトは推薦を受けたメンバーが掲載し、その全ブロックはサイトの鍵で署名されています。証明しないこと: 人が書いたこと、内容が本当であること。 |
| ↳ `app/try/i18n_zh_hk.ts:1082` | zh-HK | 證明：每個結果的網站都由獲引薦的成員列出，網站上每個區塊都由網站的金鑰簽署。不證明：是由人寫的，或內容屬實。 |
| `app/try/ShelterPanel.tsx:393` | en | What this proves: a vouched member wrote each post, and the space isn't open to outside AI crawlers. |
| ↳ `app/try/i18n_ja.ts:941` | ja | これで分かること：各投稿は推薦されたメンバーが書いたこと、そしてこの場所が外部の AI クローラーに開かれていないこと。 |
| ↳ `app/try/i18n_zh_hk.ts:941` | zh-HK | 這可以證明：每則帖文都由經引薦的成員撰寫，而此空間不向外界的 AI 爬蟲開放。 |
| `app/try/ShelterPanel.tsx:394` | en | What it doesn't prove: that no AI was used (a member can still paste AI-written text), or that members won't copy posts out. |
| ↳ `app/try/i18n_ja.ts:942` | ja | 分からないこと：AI が使われていないこと（メンバーが AI の書いた文章を貼ることはできます）、メンバーが投稿を外に持ち出さないこと。 |
| ↳ `app/try/i18n_zh_hk.ts:942` | zh-HK | 這不能證明：沒有使用 AI（成員仍可貼上由 AI 撰寫的文字），亦不能證明成員不會把帖文複製出去。 |
| `app/try/ShelterPanel.tsx:457` | en | Proving you're a member (about 30 s the first time today)… |
| ↳ `app/try/i18n_ja.ts:949` | ja | メンバーであることを証明しています（今日の最初は約30秒）… |
| ↳ `app/try/i18n_zh_hk.ts:949` | zh-HK | 正在證明你是成員（今日首次約 30 秒）… |
| `app/try/SignPanel.tsx:189` | en | A signature proves that this wallet's two keys (Ed25519 and ML-DSA-44) signed these exact bytes. Not who holds the wallet, and not when. |
| ↳ `app/try/i18n_ja.ts:341` | ja | 署名が証明するのは、このウォレットの2つの鍵（Ed25519とML-DSA-44）がこのバイト列そのものに署名したことです。誰がウォレットを持っているか、いつ署名したかは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:341` | zh-HK | 簽名證明此錢包的兩條鑰匙（Ed25519 及 ML-DSA-44）簽署了這些位元組本身，但不證明誰持有錢包，亦不證明何時簽署。 |
| `app/try/VerifyPanel.tsx:36` | en | A valid signature proves which key signed, not who holds it. Without a manifest or a pin, the verdict stops at step 1. |
| ↳ `app/try/i18n_ja.ts:198` | ja | 有効な署名が証明するのはどの鍵で署名したかで、誰がその鍵を持っているかではありません。マニフェストか固定した鍵がなければ、判定はステップ1で止まります。 |
| ↳ `app/try/i18n_zh_hk.ts:198` | zh-HK | 有效的簽名證明的是哪條鑰匙簽署，而不是誰持有該鑰匙。沒有清單或固定鑰匙的話，判定只到第 1 步。 |
| `app/try/VerifyPanel.tsx:38` | en | A signature cannot prove when something was written: there is no timestamping. |
| ↳ `app/try/i18n_ja.ts:200` | ja | 署名では、いつ書かれたかは証明できません。タイムスタンプの仕組みはありません。 |
| ↳ `app/try/i18n_zh_hk.ts:200` | zh-HK | 簽名無法證明內容何時寫成：這裡沒有時間戳記。 |
| `app/try/VerifyPanel.tsx:39` | en | “Automated” in a manifest is the owner's declaration, not a proof; a manifest cannot be revoked before it expires. |
| ↳ `app/try/i18n_ja.ts:201` | ja | マニフェストの「自動」は所有者の申告であって証明ではありません。マニフェストは期限前に取り消せません。 |
| ↳ `app/try/i18n_zh_hk.ts:201` | zh-HK | 清單中的「自動化」只是擁有者的聲明，不是證明；清單在到期前無法撤回。 |
| `app/try/VerifyPanel.tsx:201` | en | Add the .sig.json it names (SHA-256 below) and the file. The QR says the signer is key {key}; that is proven only when the .sig.json is checked. |
| ↳ `app/try/i18n_ja.ts:381` | ja | QRが指す .sig.json（SHA-256 は下記）とファイルを追加してください。QRには署名者が鍵 {key} だと書かれていますが、それが証明されるのは .sig.json を確かめたときだけです。 |
| ↳ `app/try/i18n_zh_hk.ts:381` | zh-HK | 請加入 QR 所指的 .sig.json（SHA-256 見下方）及檔案。QR 表示簽署者是鑰匙 {key}；只有核實 .sig.json 後才算證明。 |
| `app/try/VerifyPanel.tsx:301` | en | Existence proof: show that a file is exactly the one a key signed. Not when it was signed: there is no timestamping yet. |
| ↳ `app/try/i18n_ja.ts:316` | ja | 存在の証明: ファイルが、ある鍵で署名されたものとまったく同じであることを示します。いつ署名されたかは示せません（タイムスタンプの仕組みはまだありません）。 |
| ↳ `app/try/i18n_zh_hk.ts:316` | zh-HK | 存在證明：證明某檔案正是某條鑰匙所簽署的那一個。但不能證明何時簽署：暫時未有時間戳記。 |
| `app/try/WhatPanel.tsx:20` | en | Proof of work: high / Proof of stake since 2022: low |
| ↳ `app/try/i18n_ja.ts:690` | ja | プルーフ・オブ・ワーク: 多い |
| ↳ `app/try/i18n_ja.ts:691` | ja | 2022年からプルーフ・オブ・ステーク: 少ない |
| ↳ `app/try/i18n_zh_hk.ts:690` | zh-HK | 工作量證明：高 |
| ↳ `app/try/i18n_zh_hk.ts:691` | zh-HK | 自 2022 年起為權益證明：低 |
| `app/try/WhatPanel.tsx:47` | en | Doesn't prove: |
| ↳ `app/try/i18n_ja.ts:629` | ja | 証明しないこと: |
| ↳ `app/try/i18n_zh_hk.ts:629` | zh-HK | 不證明： |
| `app/whitepaper/PaperView.tsx:182` | en | The English text of this paper ({file}, SHA-256 {sha}) is marked with proof code {code}. It proves this ID marked exactly that text; not who wrote it. |
| ↳ `app/try/i18n_ja.ts:1064` | ja | この文書の英語版の本文（{file}、SHA-256 {sha}）には証明コード {code} の印が付いています。この ID がまさにその本文に印を付けたことを証明します。誰が書いたかは証明しません。 |
| ↳ `app/try/i18n_zh_hk.ts:1064` | zh-HK | 此文件英文版的內文（{file}，SHA-256 {sha}）已以證明碼 {code} 標記。這證明此 ID 標記了正是這段內文；並不證明是誰寫的。 |
| `app/whitepaper/paper.ts:45` | en | 1. A public proof layer no company owns |
| `app/whitepaper/paper.ts:73` | en | Verify, don't trust: every signature and proof is checked by the reader's own page or tool, not taken from a node. |
| `app/whitepaper/paper.ts:75` | en | Every feature says what it proves and what it doesn't, next to the feature. |
| `app/whitepaper/paper.ts:160` | en | The proof. A RISC Zero zkVM guest (risc0-zkvm 3.0.5) proves, using SHA-256 only, that the prover knows a secret whose commitment is a leaf under a given root. Its public output (journal, kind `TAM1`) is the root, a nullifier, a one-time Ed25519 key that signs the post, the receiver (a board or a person) and the UTC day. The nullifier is `SHA-256("tet-null-v1" ‖ secret ‖ receiver ‖ day)`, with the day as a little-endian u64 of `sent_at_ms / 86,400,000`. The prover runs on the member's own machine (127.0.0.1:9945), because it receives the secret. |
| `app/whitepaper/paper.ts:169` | en | Fast posting (at this commit; not yet on the seeds). A post whose proof verifies registers its one-time key for that board and UTC day; later posts that day by the same member carry no proof and are signed with that key, so they appear at once. The day's opening post still takes about 30 seconds to prove. The node holds unregistered gossiped posts only while their registering post is checked, keeps at most 20 posts per daily ID on a board, paces each key (five at once, then one every 3 seconds, 200 a day), and never takes a post without a proof for a poll (one proof, one ballot). |
| `app/whitepaper/paper.ts:202` | en | The envelope is signed by the sender's wallet, or, for an anonymous post, by the one-time key in its proof. The signature covers the message id, flags, sender, receiver, release time, fee and the SHA-256 of the ciphertext. Burn after reading is a signed request, by the sender or the receiver, that cooperating nodes delete the message: best effort, not cryptographic erasure. A time lock is a signed release time before which cooperating nodes withhold the ciphertext; anyone holding the receiver's keys and the ciphertext could read it earlier. |
| `app/whitepaper/paper.ts:283` | en | An anonymous post whose proof did not verify could still be kept and passed on (fixed and deployed 2026-10-09). |
| `app/whitepaper/paper.ts:297` | en | Level 1, offline and with no chain: the two keys in a record signed this SHA-256 for this chain, and, given the file, the file hashes to exactly that. It shows the proof code and whether the signer is TET's publisher ID. It doesn't prove who holds the keys, that the content is true, or when it was signed. |
| `app/whitepaper/paper.ts:324` | en | What it proves: a vouched member wrote each post, and the space isn't served to crawlers. What it doesn't prove: that no AI was used. The house rule, "Don't post AI-written text here", is a promise between members, not a filter. |
| `app/whitepaper/paper_ja.ts:43` | ja | 1. どの会社も持たない、公開の証明の層 |
| `app/whitepaper/paper_ja.ts:71` | ja | 信用せず確かめる: 署名と証明はすべて、ノードから受け取ったものをそのまま使わず、読む人自身のページやツールが確かめます。 |
| `app/whitepaper/paper_ja.ts:73` | ja | どの機能も、何を証明し何を証明しないかを、その機能のすぐ横に書きます。 |
| `app/whitepaper/paper_ja.ts:93` | ja | 取引は `SignedTxEnvelopeV1` です。中身は、取引（`TxV1`。`transfer`、`signer_link`、`founding_member_enroll`、`genesis_bridge`、`initial_airdrop`、`file_fee`、`worker_register`、`enterprise_inference`、`verify_zk_proof` のどれか）、ハイブリッド署名、証明情報です。ハッシュは、チェーンに結びついた署名用メッセージ（第4節）の SHA-256 です。コミット 01d7192 から、取引は、それが代わりに動くウォレット自身が署名しなければなりません。これは、受け入れるとき、ブロックを試算するとき、ブロックを適用するときに確かめます。メモリプールは最大 10,000 件または 64 MiB を持ち、手数料の一番低いものから追い出します。 |
| `app/whitepaper/paper_ja.ts:158` | ja | 証明。RISC Zero の zkVM のゲスト（risc0-zkvm 3.0.5）が、SHA-256 だけを使って、証明する人が、あるルートの下の葉になっているコミットメントの秘密を知っていることを証明します。公開される出力（ジャーナル、種類は `TAM1`）は、ルート、ヌリファイア、投稿に署名する使い捨ての Ed25519 鍵、宛先（掲示板または人）、UTC の日付です。ヌリファイアは `SHA-256("tet-null-v1" ‖ secret ‖ receiver ‖ day)` で、日付は `sent_at_ms / 86,400,000` のリトルエンディアンの u64 です。証明は、秘密を受け取るので、メンバー自身のマシン（127.0.0.1:9945）で作ります。 |
| `app/whitepaper/paper_ja.ts:164` | ja | その結果。1人のメンバーは、掲示板ごと、UTC の1日ごとに、1つの日替わり ID を持ちます（前後1日を受け付けるので、UTC の深夜0時の前後には最大3つ）。投稿の日替わり ID はヌリファイアの先頭4桁の16進数で、証明の検証が済んでから表示されます。同じメンバーなら同じ掲示板・同じ日で同じ、次の日には変わります。メンバー限定の投票は、作った人が選んだメンバーのリスト（3〜1,000 のウォレット）を使います。ノードはそのリストのルートを自分の登録簿から作るので、架空のメンバーで投票を埋めることはできません。 |
| `app/whitepaper/paper_ja.ts:167` | ja | 速い投稿（このコミットの時点。シードではまだ動いていません）。証明が通った投稿は、その掲示板とその UTC の日について、使い捨ての鍵を登録します。同じメンバーのその日の後の投稿は証明なしで、その鍵で署名されるので、すぐに表示されます。その日の1件目の投稿は、今も証明に約30秒かかります。ノードは、登録前にゴシップで届いた投稿を、登録する投稿を確かめる間だけ保持し、1つの掲示板で日替わり ID ごとに最大20件を持ち、鍵ごとに速さを抑え（一度に5件、その後は3秒に1件、1日200件）、投票には証明のない投稿を決して受け付けません（1つの証明に1票）。 |
| `app/whitepaper/paper_ja.ts:200` | ja | 封筒には、送り主のウォレット、匿名の投稿なら証明の中の使い捨て鍵が署名します。署名の対象は、メッセージ id、フラグ、送り主、宛先、公開時刻、手数料、暗号文の SHA-256 です。読んだら消すは、送り主か受け取る人が署名した、協力するノードにメッセージを消してもらう依頼です: できる限りであって、暗号的な消去ではありません。時間ロックは署名付きの公開時刻で、それより前は協力するノードが暗号文を渡しません。受け取る人の鍵と暗号文を持っている人なら、それより早く読めます。 |
| `app/whitepaper/paper_ja.ts:281` | ja | 証明が検証に通らない匿名の投稿が、保存・中継されることがありました（2026-10-09 に修正・反映）。 |
| `app/whitepaper/paper_ja.ts:295` | ja | レベル1、オフラインでチェーンなし: 記録の2つの鍵が、このチェーンのためにこの SHA-256 に署名したこと。ファイルがあれば、そのファイルのハッシュがちょうどそれであること。証明コードと、署名者が TET の発行者 ID かどうかを表示します。誰が鍵を持っているか、内容が正しいか、いつ署名されたかは証明しません。 |
| `app/whitepaper/paper_ja.ts:322` | ja | 証明すること: 各投稿は推薦を受けたメンバーが書いたこと、そしてこの場がクローラーには配られないこと。証明しないこと: AI が使われていないこと。ハウスルール「ここに AI が書いた文章は載せないでください」は、メンバー同士の約束であって、フィルターではありません。 |
| `app/whitepaper/paper_zh_hk.ts:43` | zh-HK | 1. 一個不屬於任何公司的公開證明層 |
| `app/whitepaper/paper_zh_hk.ts:45` | zh-HK | 自己的證明與金鑰，從公司手中拿回自己手上。 |
| `app/whitepaper/paper_zh_hk.ts:71` | zh-HK | 核實，而非信任：每個簽名及證明都由讀者自己的頁面或工具核實，而非照單全收節點給的結果。 |
| `app/whitepaper/paper_zh_hk.ts:72` | zh-HK | 你的金鑰與證明在你手上：金鑰來自當事人持有的字詞；紀錄是他們自己保存的檔案。 |
| `app/whitepaper/paper_zh_hk.ts:73` | zh-HK | 每項功能都在功能旁邊說明它證明甚麼、不證明甚麼。 |
| `app/whitepaper/paper_zh_hk.ts:93` | zh-HK | 一宗交易是一個 `SignedTxEnvelopeV1`：交易本身（`TxV1`，為 `transfer`、`signer_link`、`founding_member_enroll`、`genesis_bridge`、`initial_airdrop`、`file_fee`、`worker_register`、`enterprise_inference`、`verify_zk_proof` 其中之一）、一個混合簽名及一份證明書（attestation）。其雜湊值是其綁定鏈的簽署訊息的 SHA-256（第 4 節）。自 commit 01d7192 起，交易必須由它所代表的錢包簽署；在接納交易、預覽區塊及套用區塊時都會檢查。記憶池最多容納 10,000 宗交易或 64 MiB，並會逐出手續費最低的交易。 |
| `app/whitepaper/paper_zh_hk.ts:158` | zh-HK | 證明。一個 RISC Zero zkVM guest（risc0-zkvm 3.0.5）只使用 SHA-256，證明證明者知道一個秘密，而該秘密的承諾是某個根之下的一片葉。其公開輸出（journal，類型 `TAM1`）包括根、一個 nullifier、一把用來簽署帖文的一次性 Ed25519 金鑰、收件方（一個討論區或一個人）及 UTC 日期。nullifier 是 `SHA-256("tet-null-v1" ‖ secret ‖ receiver ‖ day)`，日期以小端序 u64 表示，值為 `sent_at_ms / 86,400,000`。證明程式在成員自己的電腦上運行（127.0.0.1:9945），因為它會接收秘密。 |
| `app/whitepaper/paper_zh_hk.ts:164` | zh-HK | 由此可知。一位成員在每個討論區、每個 UTC 日只有一個每日 ID（在 UTC 午夜前後最多三個，因為前後各一日都會被接受）。帖文的每日 ID 是其 nullifier 的開首四個十六進位數字，只在證明通過驗證後才顯示：同一成員在同一討論區同一日相同，翌日則不同。僅限成員的投票使用由發起人選定的成員名單（3 至 1,000 個錢包）；節點從自己的登記冊建立該名單的根，因此投票不能用虛構的成員填滿。 |
| `app/whitepaper/paper_zh_hk.ts:167` | zh-HK | 快速發帖（此 commit 已有；種子節點尚未運行）。一則證明通過驗證的帖文，會為該討論區及該 UTC 日登記其一次性金鑰；同一成員當日稍後的帖文不帶證明，以該金鑰簽署，因此會即時出現。當日開首那則帖文仍需約 30 秒產生證明。節點只在相應的登記帖文仍在核實期間，暫時保留未登記的 gossip 帖文；每個每日 ID 在一個討論區最多保留 20 則帖文；為每把金鑰控制節奏（一次 5 則，然後每 3 秒 1 則，每日 200 則）；投票則絕不接受沒有證明的帖文（一個證明，一張選票）。 |
| `app/whitepaper/paper_zh_hk.ts:200` | zh-HK | 信封由寄件人的錢包簽署；若是匿名帖文，則由其證明中的一次性金鑰簽署。簽名涵蓋訊息 id、旗標、寄件人、收件人、發佈時間、手續費及密文的 SHA-256。閱後即焚是由寄件人或收件人簽署的請求，要求合作的節點刪除該訊息：盡力而為，並非密碼學上的抹除。時間鎖是一個已簽署的發佈時間，在此之前合作的節點會扣留密文；任何持有收件人金鑰及密文的人都可以提早閱讀。 |
| `app/whitepaper/paper_zh_hk.ts:281` | zh-HK | 證明未通過驗證的匿名帖文仍可能被保留及轉發（2026-10-09 已修正並部署）。 |
| `app/whitepaper/paper_zh_hk.ts:322` | zh-HK | 它證明的：每則帖文都由一位獲引薦的成員撰寫，而這個空間不會提供給爬蟲。它不證明的：沒有使用 AI。「不要在這裡張貼由 AI 撰寫的文字」這條規則是成員之間的承諾，不是過濾器。 |
| `app/worker/WorkerCockpitClient.tsx:208` | en | ZK Proof Wins |
| `app/worker/WorkerCockpitClient.tsx:210` | en | Verified proof receipts |

## C. "Proof" as the name of a thing: owner decides

*Proof code*, *proof file*, *zero-knowledge proof*, *membership proof*, "your proofs and keys", and the prover's progress labels ("proving…"). These name a thing or a running step rather than claim something. Renaming *proof code* would reach the search box, the registry, the paper's marks and `proofCode()`.

| Where | Lang | Text |
|---|---|---|
| `app/lib/tmail_anon.ts:116` | en | Membership proof checked by this node. |
| `app/lib/tmail_anon.ts:130` | en | The sender's membership proof has not been verified yet. |
| `app/os/tabs/WorkerPanel.tsx:220` | en | CPU proving |
| `app/try/AboutPanel.tsx:31` | en | On top of it run Tmail (end-to-end encrypted messages and files) and boards where you can post anonymously with a zero-knowledge proof. |
| ↳ `app/try/i18n_ja.ts:277` | ja | その上で、Tmail（エンドツーエンド暗号化のメッセージとファイル）と、ゼロ知識証明で匿名投稿できる掲示板が動いています。 |
| ↳ `app/try/i18n_zh_hk.ts:277` | zh-HK | 其上運行 Tmail（端對端加密的訊息及檔案），以及可以用零知識證明匿名發帖的討論區。 |
| `app/try/BoardPanel.tsx:167` | en | Posts are anonymous by default: a zero-knowledge proof shows you are a member, not which one. That needs the native prover on your computer; without it you post named, and the post says so. |
| ↳ `app/try/i18n_ja.ts:12` | ja | 投稿は既定で匿名です。ゼロ知識証明で示すのは「メンバーであること」だけで、誰なのかは示しません。そのためにはこのパソコンで動くネイティブ証明器が必要です。なければ記名での投稿になり、投稿にもそう表示されます。 |
| ↳ `app/try/i18n_zh_hk.ts:12` | zh-HK | 帖文預設為匿名：零知識證明只證明你是成員，不會透露你是哪一位。這需要在你的電腦上運行原生證明程式；沒有的話就會以具名發帖，帖文亦會註明。 |
| `app/try/BoardPanel.tsx:169` | en | Posting anonymously unlinks the post from your ID: the proof shows a member wrote it, not which one. It doesn't hide your IP address from the node; for that, use Tor or your own node. |
| ↳ `app/try/i18n_ja.ts:808` | ja | 匿名で投稿すると、投稿とあなたの ID は結びつきません。証明が示すのはメンバーの誰かが書いたことで、誰かは示しません。ノードからあなたの IP アドレスは隠れません。隠したいときは Tor か自分のノードを使ってください。 |
| ↳ `app/try/i18n_zh_hk.ts:808` | zh-HK | 匿名發文會切斷帖文與你的 ID 之間的關聯：證明只顯示由某位成員所寫，不顯示是哪一位。它不會向節點隱藏你的 IP 位址；如需要，請使用 Tor 或你自己的節點。 |
| `app/try/BoardPanel.tsx:174` | en | An anonymous post's ID (ID:ab12) comes from its proof: the same for one member on one board for one UTC day, and different tomorrow or on another board. Nobody running the node chooses it, and it appears only after the proof is checked. All of one member's anonymous posts on a board that day carry it, so they can be read as one person's; two members can share an ID by chance. |
| ↳ `app/try/i18n_ja.ts:916` | ja | 匿名投稿の ID（ID:ab12）は証明から作られます。同じメンバー・同じ掲示板・同じ UTC の日なら同じで、翌日や別の掲示板では変わります。ノードの運営者が決めるものではなく、証明を確認したあとにだけ表示されます。その日にその掲示板で同じメンバーがした匿名投稿にはすべて同じ ID が付くので、同じ人の投稿だと分かります。偶然、2人のメンバーの ID が同じになることもあります。 |
| ↳ `app/try/i18n_zh_hk.ts:916` | zh-HK | 匿名帖文的 ID（ID:ab12）來自其證明：同一成員在同一討論區、同一 UTC 日內相同，翌日或在其他討論區便會不同。它並非由營運節點的人決定，並且只會在證明核對後才顯示。同一成員當日在該討論區的所有匿名帖文都帶有此 ID，因此可看出是同一人所寫；兩位成員的 ID 也可能偶然相同。 |
| `app/try/BoardPanel.tsx:699` | en | proving… {time} |
| ↳ `app/try/i18n_ja.ts:65` | ja | 証明中… {time} |
| ↳ `app/try/i18n_zh_hk.ts:65` | zh-HK | 正在證明… {time} |
| `app/try/BoardPanel.tsx:705` | en | depositing the proof… |
| ↳ `app/try/i18n_ja.ts:68` | ja | 証明を預けています… |
| ↳ `app/try/i18n_zh_hk.ts:68` | zh-HK | 正在提交證明… |
| `app/try/GenuineCheck.tsx:211` | en | Download the proof file |
| ↳ `app/try/i18n_ja.ts:754` | ja | 証明ファイルをダウンロード |
| ↳ `app/try/i18n_zh_hk.ts:754` | zh-HK | 下載證明檔案 |
| `app/try/GenuinePanel.tsx:68` | en | Storing the proof file, encrypted to you… |
| ↳ `app/try/i18n_ja.ts:1103` | ja | 証明ファイルをあなた宛てに暗号化して保存しています… |
| ↳ `app/try/i18n_zh_hk.ts:1103` | zh-HK | 正在儲存證明檔案，並加密給你… |
| `app/try/GenuinePanel.tsx:71` | en | Linking the anchor to your proof code… |
| ↳ `app/try/i18n_ja.ts:1104` | ja | チェーンの記録を証明コードにひも付けています… |
| ↳ `app/try/i18n_zh_hk.ts:1104` | zh-HK | 正在把鏈上記錄連結到你的證明碼… |
| `app/try/GenuinePanel.tsx:124` | en | Your proof code |
| ↳ `app/try/i18n_ja.ts:765` | ja | あなたの証明コード |
| ↳ `app/try/i18n_zh_hk.ts:765` | zh-HK | 你的證明碼 |
| `app/try/GenuinePanel.tsx:131` | en | QR code for this proof code |
| ↳ `app/try/i18n_ja.ts:525` | ja | この証明コードのQRコード |
| ↳ `app/try/i18n_zh_hk.ts:525` | zh-HK | 此證明碼的 QR 碼 |
| `app/try/GenuinePanel.tsx:148` | en | Download the proof file |
| ↳ `app/try/i18n_ja.ts:754` | ja | 証明ファイルをダウンロード |
| ↳ `app/try/i18n_zh_hk.ts:754` | zh-HK | 下載證明檔案 |
| `app/try/GenuinePanel.tsx:177` | en | Optional: a block on the chain records 128 bits of this proof file's fingerprint, so its place in time doesn't rest on this node's clock. Nothing of your file leaves this tab: only the small proof file is stored, encrypted to you, for 7 days. |
| ↳ `app/try/i18n_ja.ts:1109` | ja | 任意です。チェーンのブロックがこの証明ファイルの指紋のうち128ビットを記録するので、その時点がこのノードの時計に頼らなくなります。あなたのファイルはこのタブから一切出ません。保存されるのは小さな証明ファイルだけで、あなた宛てに暗号化され、7日間保管されます。 |
| ↳ `app/try/i18n_zh_hk.ts:1109` | zh-HK | 可選：鏈上的一個區塊會記錄這份證明檔案指紋的 128 位元，令它的時間點不再依賴這個節點的時鐘。你的檔案不會離開這個分頁：只會儲存那份細小的證明檔案，加密給你，保存 7 日。 |
| `app/try/GenuinePanel.tsx:180` | en | To anchor, first turn on your inbox (the proof file is stored encrypted to you). |
| ↳ `app/try/i18n_ja.ts:1110` | ja | チェーンに記録するには、先に受信箱をオンにしてください（証明ファイルはあなた宛てに暗号化して保存されます）。 |
| ↳ `app/try/i18n_zh_hk.ts:1110` | zh-HK | 要記錄在鏈上，請先開啟收件匣（證明檔案會加密給你儲存）。 |
| `app/try/GenuinePanel.tsx:196` | en | It shows the proof file existed before that block. Blocks don't carry a date yet, and today one node makes them all. |
| ↳ `app/try/i18n_ja.ts:1111` | ja | これが示すのは、証明ファイルがそのブロックより前に存在したことです。ブロックにはまだ日付がなく、現在はすべてのブロックを1台のノードが作っています。 |
| ↳ `app/try/i18n_zh_hk.ts:1111` | zh-HK | 這顯示證明檔案在該區塊之前已經存在。區塊現時還沒有日期，而且目前所有區塊都由一個節點產生。 |
| `app/try/GrantsBox.tsx:49` | en | Proving on your computer (about 30 s)… |
| ↳ `app/try/i18n_ja.ts:1049` | ja | あなたのコンピューターで証明中（約30秒）… |
| ↳ `app/try/i18n_zh_hk.ts:1049` | zh-HK | 正在你的電腦上證明（約 30 秒）… |
| `app/try/HomePanel.tsx:140` | en | Enter a proof code, or drop a file here |
| ↳ `app/try/i18n_ja.ts:770` | ja | 証明コードを入力するか、ファイルをここにドロップ |
| ↳ `app/try/i18n_zh_hk.ts:770` | zh-HK | 輸入證明碼，或把檔案拖放到這裡 |
| `app/try/HowPanel.tsx:152` | en | membership proof with hashes only (zero-knowledge) |
| ↳ `app/try/i18n_ja.ts:474` | ja | ハッシュだけを使うメンバー証明（ゼロ知識） |
| ↳ `app/try/i18n_zh_hk.ts:474` | zh-HK | 只用雜湊值的成員證明（零知識） |
| `app/try/HowPanel.tsx:196` | en | Joining needs a membership proof; posts aren't served on the public API, and AI crawlers are asked not to crawl (robots.txt). |
| ↳ `app/try/i18n_ja.ts:493` | ja | 参加にはメンバーである証明が必要。投稿は公開APIでは配信せず、AIクローラーには robots.txt で巡回しないよう求めます。 |
| ↳ `app/try/i18n_zh_hk.ts:493` | zh-HK | 加入需要成員證明；帖文不會在公開 API 提供，並以 robots.txt 要求 AI 爬蟲不要爬取。 |
| `app/try/PollBox.tsx:90` | en | proving… |
| ↳ `app/try/i18n_ja.ts:553` | ja | 証明中… |
| ↳ `app/try/i18n_zh_hk.ts:553` | zh-HK | 證明中… |
| `app/try/ProofCode.tsx:36` | en | Proof code |
| ↳ `app/try/i18n_ja.ts:524` | ja | 証明コード |
| ↳ `app/try/i18n_zh_hk.ts:524` | zh-HK | 證明碼 |
| `app/try/ProofCode.tsx:40` | en | QR code for this proof code |
| ↳ `app/try/i18n_ja.ts:525` | ja | この証明コードのQRコード |
| ↳ `app/try/i18n_zh_hk.ts:525` | zh-HK | 此證明碼的 QR 碼 |
| `app/try/QuestionsPanel.tsx:106` | en | proving… {time} |
| ↳ `app/try/i18n_ja.ts:65` | ja | 証明中… {time} |
| ↳ `app/try/i18n_zh_hk.ts:65` | zh-HK | 正在證明… {time} |
| `app/try/QuestionsPanel.tsx:108` | en | depositing the proof… |
| ↳ `app/try/i18n_ja.ts:68` | ja | 証明を預けています… |
| ↳ `app/try/i18n_zh_hk.ts:68` | zh-HK | 正在提交證明… |
| `app/try/SealPanel.tsx:169` | en | The card: sealed, opening date, proof code |
| ↳ `app/try/i18n_ja.ts:798` | ja | カード：封印・公開日・証明コード |
| ↳ `app/try/i18n_zh_hk.ts:798` | zh-HK | 卡片：已封印、公開日期、證明碼 |
| `app/try/SignPanel.tsx:229` | en | Get a proof code |
| ↳ `app/try/i18n_ja.ts:542` | ja | 証明コードを取得 |
| ↳ `app/try/i18n_zh_hk.ts:542` | zh-HK | 取得證明碼 |
| `app/try/SitePanel.tsx:360` | en | Export the proof file (.site.json) |
| ↳ `app/try/i18n_ja.ts:865` | ja | 証明ファイルを書き出す (.site.json) |
| ↳ `app/try/i18n_zh_hk.ts:865` | zh-HK | 匯出證明檔案 (.site.json) |
| `app/try/TermsPanel.tsx:26` | en | Marks (proof codes) and sealed predictions hold only a fingerprint and your ID, never the content. They're kept on this node, and the operator can hide them like anything else. |
| ↳ `app/try/i18n_ja.ts:807` | ja | 記録（証明コード）と予言の封印が持つのは、指紋とあなたの ID だけで、中身は持ちません。このノードに保管され、運営者はほかのものと同じように非表示にできます。 |
| ↳ `app/try/i18n_zh_hk.ts:807` | zh-HK | 標記（證明碼）和封印預言只包含指紋和你的 ID，絕不包含內容。它們保存在此節點上，營運者可以像其他內容一樣將其隱藏。 |
| `app/try/VerifyThisPage.tsx:84` | en | The build manifest (commit {commit}) is signed by TET's publisher ID: proof code {code}. |
| ↳ `app/try/i18n_ja.ts:1069` | ja | ビルドの一覧（コミット {commit}）には TET の発行者 ID の署名があります。証明コード {code}。 |
| ↳ `app/try/i18n_zh_hk.ts:1069` | zh-HK | 建置清單（提交 {commit}）有 TET 發行者 ID 的簽名：證明碼 {code}。 |
| `app/try/WhatPanel.tsx:27` | en | Signature badges, proof codes and search by file |
| ↳ `app/try/i18n_ja.ts:704` | ja | 署名バッジ、証明コード、ファイルからの検索 |
| ↳ `app/try/i18n_zh_hk.ts:704` | zh-HK | 簽名徽章、證明碼及以檔案搜尋 |
| `app/try/WhatPanel.tsx:54` | en | Your proofs and keys, in your hands, not a company's. |
| ↳ `app/try/i18n_ja.ts:1029` | ja | 自分の証明と鍵を、会社から自分の手に。 |
| ↳ `app/try/i18n_zh_hk.ts:1029` | zh-HK | 自己的證明與金鑰，從公司手中拿回自己手上。 |
| `app/try/WhatPanel.tsx:130` | en | Messages, files and boards are not written to the chain. They stay on nodes for a limited time; the chain holds keys and proofs, not your content. |
| ↳ `app/try/i18n_ja.ts:652` | ja | メッセージ・ファイル・掲示板はチェーンに書き込まれません。ノードに一定期間置かれるだけで、チェーンが持つのは鍵と証明であり、あなたの中身ではありません。 |
| ↳ `app/try/i18n_zh_hk.ts:652` | zh-HK | 訊息、檔案及討論區不會寫入區塊鏈，只會在節點上存放一段時間；區塊鏈持有的是鑰匙和證明，而不是你的內容。 |
| `app/try/page.tsx:252` | en | Proof code, or search threads |
| ↳ `app/try/i18n_ja.ts:774` | ja | 証明コード、またはスレッド検索 |
| ↳ `app/try/i18n_zh_hk.ts:774` | zh-HK | 證明碼，或搜尋討論串 |
| `app/whitepaper/PaperView.tsx:103` | en | Draft translation of the English version at commit {commit}; the English version is authoritative. This translation isn't marked yet: the proof codes below are for the English files. |
| ↳ `app/try/i18n_ja.ts:1054` | ja | コミット {commit} 時点の英語版の翻訳（下書き）です。英語版が正本です。この翻訳にはまだ印が付いていません。下の証明コードは英語版のファイルのものです。 |
| ↳ `app/try/i18n_zh_hk.ts:1054` | zh-HK | 這是提交 {commit} 時英文版的翻譯（草稿）。以英文版為準。此翻譯尚未加上標記：下方的證明碼屬於英文版檔案。 |
| `app/whitepaper/PaperView.tsx:130` | en | proof code {code} (marks this PDF file) |
| ↳ `app/try/i18n_ja.ts:1059` | ja | 証明コード {code}（この PDF ファイルの印） |
| ↳ `app/try/i18n_zh_hk.ts:1059` | zh-HK | 證明碼 {code}（標記此 PDF 檔案） |
| `app/whitepaper/PaperView.tsx:143` | en | proof codes {a} and {b} |
| ↳ `app/try/i18n_ja.ts:1061` | ja | 証明コード {a} と {b} |
| ↳ `app/try/i18n_zh_hk.ts:1061` | zh-HK | 證明碼 {a} 和 {b} |
| `app/whitepaper/paper.ts:30` | en | This paper marks itself: its HTML and its PDF are each signed by TET's publisher ID, and each mark has a proof code. Every earlier version stays published with its codes, so the paper's own history can be checked, including with the offline verifier (Section 10). |
| `app/whitepaper/paper.ts:47` | en | Your proofs and keys, in your hands, not a company's. |
| ↳ `app/try/i18n_ja.ts:1029` | ja | 自分の証明と鍵を、会社から自分の手に。 |
| ↳ `app/try/i18n_zh_hk.ts:1029` | zh-HK | 自己的證明與金鑰，從公司手中拿回自己手上。 |
| `app/whitepaper/paper.ts:56` | en | Records, membership proofs and messaging, not programs |
| `app/whitepaper/paper.ts:74` | en | Your keys and proofs in your hands: keys come from words the person holds; records are files they keep. |
| `app/whitepaper/paper.ts:133` | en | Hashes are SHA-256 throughout: transaction hashes, block ids, record hashes, site edit chains, commitments and nullifiers. A proof code `TET-XXXX-XXXX` is the leading 40 bits of a signature record's SHA-256, in Crockford base32. It is a lookup key, not a proof: the record's two signatures are what is checked. |
| `app/whitepaper/paper.ts:166` | en | What follows. One member has one daily ID per board per UTC day (up to three around midnight UTC, because a day either side is accepted). A post's daily ID is the opening four hex digits of its nullifier, shown only once the proof is verified: the same for one member on one board for one day, different on the next. Members-only polls use a member list chosen by the poll's creator (3 to 1,000 wallets); the node builds that list's root from its own registry, so a poll can't be filled with invented members. |
| `app/whitepaper/paper_ja.ts:28` | ja | この文書は自分自身に印を付けています。HTML と PDF のそれぞれに TET の発行者 ID が署名し、それぞれの印に証明コードがあります。以前の版もコードと一緒に公開し続けるので、この文書自体の履歴も確かめられます。オフライン検証ツール（第10節）でも確かめられます。 |
| `app/whitepaper/paper_ja.ts:45` | ja | 自分の証明と鍵を、会社から自分の手に。 |
| `app/whitepaper/paper_ja.ts:54` | ja | 記録、メンバー証明、メッセージ。プログラムではありません |
| `app/whitepaper/paper_ja.ts:72` | ja | 自分の鍵と証明を自分の手に: 鍵は本人が持つ言葉から作られ、記録は本人が持っておけるファイルです。 |
| `app/whitepaper/paper_ja.ts:131` | ja | ハッシュはすべて SHA-256 です: 取引ハッシュ、ブロック id、記録のハッシュ、サイト編集の鎖、コミットメント、ヌリファイア。証明コード `TET-XXXX-XXXX` は、署名の記録の SHA-256 の先頭40ビットを Crockford base32 で書いたものです。これは探すための鍵で、証明ではありません。確かめるのは、記録の2つの署名です。 |
| `app/whitepaper/paper_ja.ts:152` | ja | 5. 匿名のメンバー証明 |
| `app/whitepaper/paper_ja.ts:161` | ja | ノードでの確認。封筒の使い捨て鍵はジャーナルのものと同じで、宛先と日付も一致しなければなりません。レシート（約 250 KiB、ゴシップとは別に取得）は、告知されたハッシュに一致し、TET が固定したメンバー証明のプログラム（`ANON_GUEST_IMAGE_IDS`、または運営者が加えた id）のもので、検証に通らなければなりません。ルートは、ノードが直近1時間以内のエポックに作ったもので、日付は今日の前後1日以内でなければなりません。そのうえでヌリファイアを使用済みにします: 1つのヌリファイアにメッセージは1つです。コミット f5f968a から、ノードはこれをすべて、投稿を保存したり中継したりする前に行います。通らない投稿は断り、別の経路で届いたものは削除します。 |
| `app/whitepaper/paper_zh_hk.ts:28` | zh-HK | 本文件為自己加上標記：其 HTML 及 PDF 各由 TET 的發佈者 ID 簽署，每個標記都有一個證明碼。每個舊版本連同其證明碼都會繼續公開，因此本文件自身的歷史亦可核實，包括使用離線驗證工具（第 10 節）。 |
| `app/whitepaper/paper_zh_hk.ts:34` | zh-HK | 本版的證明碼，見下載連結旁 / 本版的證明碼，見下載連結旁 |
| `app/whitepaper/paper_zh_hk.ts:54` | zh-HK | 紀錄、成員證明及通訊，而非程式 |
| `app/whitepaper/paper_zh_hk.ts:131` | zh-HK | 雜湊一律使用 SHA-256：交易雜湊值、區塊 id、紀錄雜湊值、網站編輯鏈、承諾（commitment）及 nullifier。證明碼 `TET-XXXX-XXXX` 是簽名紀錄 SHA-256 的開首 40 位元，以 Crockford base32 表示。它是查詢用的鍵，而不是證明：被核實的是紀錄的兩個簽名。 |
| `app/whitepaper/paper_zh_hk.ts:295` | zh-HK | 第 1 級，離線且不需要鏈：紀錄中的兩把金鑰為這條鏈簽署了這個 SHA-256；若提供檔案，該檔案的雜湊值正是這個值。它會顯示證明碼，以及簽署者是否 TET 的發佈者 ID。它不證明誰持有這些金鑰、內容是否屬實，或簽署的時間。 |
| `app/worker/WorkerCockpitClient.tsx:236` | en | GPU not detected. CPU proving mode. |

## Translations whose English key has no such word

The English avoids the word and the translation uses 証明 / 證明, or the key is built in code (no literal in a component). Each needs the same decision as its English.

| Where | Lang | English key | Text |
|---|---|---|---|
| `app/try/i18n_ja.ts:32` | ja | Checking for the prover… | 証明器を確認中… |
| `app/try/i18n_ja.ts:39` | ja | How to run the prover to post anonymously | 匿名で投稿するための証明器の動かし方 |
| `app/try/i18n_ja.ts:156` | ja | Answers are anonymous by default; that needs the native prover on your computer. Without it, answers are named and say so. | 回答は既定で匿名です。そのためにはこのパソコンで動くネイティブ証明器が必要です。なければ記名での回答になり、そう表示されます。 |
| `app/try/i18n_ja.ts:180` | ja | No native prover on this computer, so answers are named (the agent sees your wallet id). | このパソコンにネイティブ証明器がないので、回答は記名になります（エージェントにウォレットIDが見えます）。 |
| `app/try/i18n_ja.ts:181` | ja | How to run the prover to answer anonymously | 匿名で回答するための証明器の動かし方 |
| `app/try/i18n_ja.ts:195` | ja | proven | 証明済み |
| `app/try/i18n_ja.ts:253` | ja | prover | 証明器 |
| `app/try/i18n_ja.ts:388` | ja | Posting anonymously unlinks the post from your key: the proof shows a member wrote it, not which one. It doesn't hide your IP address from the node; for that, use Tor or your own node. | 匿名で投稿すると、投稿とあなたの鍵の結びつきが切れます。証明が示すのは「メンバーの誰かが書いた」ことで、誰かは示しません。ノードからIPアドレスを隠すものではありません。IPを隠したいときはTorか自分のノードを使ってください。 |
| `app/try/i18n_ja.ts:389` | ja | A listing proves the board's own key listed it. It doesn't prove who runs the board or that its name is true. | 掲載は、その掲示板自身の鍵が掲載したことを証明します。誰が運営しているかや、名前が本当かは証明しません。 |
| `app/try/i18n_ja.ts:390` | ja | A message proves which key sent it, or for an anonymous one, that a member did. It doesn't prove who holds that key. | メッセージは、どの鍵が送ったか（匿名ならメンバーの誰かが送ったこと）を証明します。その鍵を誰が持っているかは証明しません。 |
| `app/try/i18n_ja.ts:523` | ja | Search threads, or enter a proof code | スレッドを検索、または証明コードを入力 |
| `app/try/i18n_ja.ts:530` | ja | Proof codes aren't set up on this node. | このノードでは証明コードが使えるようになっていません。 |
| `app/try/i18n_ja.ts:552` | ja | Voting needs the native prover on this device. | 投票には、この端末にネイティブ証明器が必要です。 |
| `app/try/i18n_ja.ts:628` | ja | Proves: | 証明すること: |
| `app/try/i18n_ja.ts:651` | ja | Anonymous posts use a zero-knowledge proof built only from hashes (SHA-256). | 匿名投稿には、ハッシュ（SHA-256）だけで作られたゼロ知識証明を使います。 |
| `app/try/i18n_ja.ts:810` | ja | No prover here, so posts show your ID. | この端末には証明器がないため、投稿にはあなたの ID が表示されます。 |
| `app/try/i18n_ja.ts:824` | ja | A delivered file proves which ID sent it and that only the recipient can open it. It doesn't prove who is behind that ID, or that the file is what its name says. | 届いたファイルが証明するのは、どの ID が送ったかと、受け取った人しか開けないことです。その ID の持ち主が誰か、ファイルが名前どおりの中身かは証明しません。 |
| `app/try/i18n_ja.ts:961` | ja | Anonymous posting needs the native prover on your own computer. | 匿名投稿には、自分のコンピューターで動く証明プログラムが必要です。 |
| `app/try/i18n_ja.ts:1013` | ja | A delivered file proves the sender's key signed it. Only the recipient can open it, if the safety number you see for them in DM matches theirs. It doesn't prove who holds that key, or that the file is what its name says. | 届いたファイルは、送り主の鍵で署名されたことを示します。開けるのは受取人だけです（DM で見える安全番号が相手と一致していれば）。その鍵を誰が持っているか、ファイルが名前どおりの中身かは示しません。 |
| `app/try/i18n_ja.ts:1052` | ja | Claiming needs the native prover on your own computer. | 受け取るには、自分のコンピューターで動く証明プログラムが必要です。 |
| `app/try/i18n_zh_hk.ts:32` | zh-HK | Checking for the prover… | 正在檢查證明程式… |
| `app/try/i18n_zh_hk.ts:39` | zh-HK | How to run the prover to post anonymously | 如何運行證明程式以匿名發帖 |
| `app/try/i18n_zh_hk.ts:156` | zh-HK | Answers are anonymous by default; that needs the native prover on your computer. Without it, answers are named and say so. | 回答預設為匿名；這需要在你的電腦上運行原生證明程式。沒有的話就會以具名回答，並會註明。 |
| `app/try/i18n_zh_hk.ts:180` | zh-HK | No native prover on this computer, so answers are named (the agent sees your wallet id). | 這部電腦沒有原生證明程式，所以回答會是具名的（代理人會看到你的錢包 ID）。 |
| `app/try/i18n_zh_hk.ts:181` | zh-HK | How to run the prover to answer anonymously | 如何運行證明程式以匿名回答 |
| `app/try/i18n_zh_hk.ts:195` | zh-HK | proven | 已證明 |
| `app/try/i18n_zh_hk.ts:253` | zh-HK | prover | 證明程式 |
| `app/try/i18n_zh_hk.ts:388` | zh-HK | Posting anonymously unlinks the post from your key: the proof shows a member wrote it, not which one. It doesn't hide your IP address from the node; for that, use Tor or your own node. | 匿名發文會切斷帖文與你的鑰匙之間的關聯：證明只顯示由某位成員所寫，不顯示是哪一位。它不會向節點隱藏你的 IP 位址；如需要，請使用 Tor 或你自己的節點。 |
| `app/try/i18n_zh_hk.ts:389` | zh-HK | A listing proves the board's own key listed it. It doesn't prove who runs the board or that its name is true. | 列出證明是該討論板自己的鑰匙所列出。它不證明誰在營運該討論板，亦不證明其名稱屬實。 |
| `app/try/i18n_zh_hk.ts:390` | zh-HK | A message proves which key sent it, or for an anonymous one, that a member did. It doesn't prove who holds that key. | 訊息證明是哪條鑰匙發出的；若是匿名訊息，則證明由某位成員發出。它不證明誰持有該鑰匙。 |
| `app/try/i18n_zh_hk.ts:523` | zh-HK | Search threads, or enter a proof code | 搜尋主題，或輸入證明碼 |
| `app/try/i18n_zh_hk.ts:530` | zh-HK | Proof codes aren't set up on this node. | 此節點未設定證明碼。 |
| `app/try/i18n_zh_hk.ts:552` | zh-HK | Voting needs the native prover on this device. | 投票需要此裝置上的原生證明器。 |
| `app/try/i18n_zh_hk.ts:628` | zh-HK | Proves: | 證明： |
| `app/try/i18n_zh_hk.ts:651` | zh-HK | Anonymous posts use a zero-knowledge proof built only from hashes (SHA-256). | 匿名帖文使用只由雜湊（SHA-256）構成的零知識證明。 |
| `app/try/i18n_zh_hk.ts:810` | zh-HK | No prover here, so posts show your ID. | 此裝置沒有證明器，所以帖文會顯示你的 ID。 |
| `app/try/i18n_zh_hk.ts:824` | zh-HK | A delivered file proves which ID sent it and that only the recipient can open it. It doesn't prove who is behind that ID, or that the file is what its name says. | 已送達的檔案證明是哪個 ID 發出，而且只有收件人能開啟。它不證明 ID 背後是誰，也不證明檔案內容與其名稱相符。 |
| `app/try/i18n_zh_hk.ts:961` | zh-HK | Anonymous posting needs the native prover on your own computer. | 匿名發帖需要在你自己的電腦上執行本機證明程式。 |
| `app/try/i18n_zh_hk.ts:1013` | zh-HK | A delivered file proves the sender's key signed it. Only the recipient can open it, if the safety number you see for them in DM matches theirs. It doesn't prove who holds that key, or that the file is what its name says. | 已送達的檔案證明它由寄件人的金鑰簽署。只有收件人能開啟（前提是你在 DM 看到的安全號碼與對方的一致）。它不能證明誰持有該金鑰，亦不能證明檔案內容與檔名相符。 |
| `app/try/i18n_zh_hk.ts:1052` | zh-HK | Claiming needs the native prover on your own computer. | 領取需要在你自己的電腦上執行本機證明程式。 |

## Found on the way (outside the word list)

Not in the groups above, because the English doesn't use the word, but they say who in the same way as group A:

- `app/whitepaper/paper.ts:48`: "…being able to check who signed what, and when, …"
- `app/whitepaper/paper.ts:58`: "Who signed, not only when; anonymous membership" (its ja line is in group A; zh-HK `paper_zh_hk.ts:56`: 「不只何時，還有誰簽署；匿名成員身分」)

## How this list was made

Every `.ts`/`.tsx` file under `tet-network/ui/app`; comments and imports skipped; string literals, template literals and JSX text kept if they contain one of the words, identifiers such as `proofCode` dropped. Dictionary lines are read as key and value pairs. A first pass sorted by pattern; group A was then checked by hand, which moved the negated rows and the membership-proof rows to B and added the paper's "who" lines. Strings outside `app/` (scripts, the built paper HTML) are not covered.
