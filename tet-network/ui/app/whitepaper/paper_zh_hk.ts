/**
 * TET 技術文件的香港繁體中文譯本（草稿）。與英文版 `paper.ts` 結構相同：相同的節 id、相同數量的
 * 段落、項目及表格行，以及相同的 `sources`。`paper_guard` 會核對結構與用字規則。
 * 英文版為正本。英文版有改動時，須同時修改此譯本並更新 TRANSLATION_OF。
 */

import type { Section } from "./paper";
export { WRITTEN_AGAINST, SEEDS_RUN } from "./paper";

/** 此譯本所依據的英文版 commit。 */
export const TRANSLATION_OF = "341c941f7b801f595c0c5e07c78d9c4a219053cf";
export const TRANSLATION_NOTE = "這是 commit 341c941 時英文版的翻譯。英文版為正本。";

export const TITLE = "TET 技術文件";
export const SUBTITLE = "第 2 版 · 測試網 v0.2，按程式碼現況";
export const DATE = "2026-10-10";

export const ABSTRACT =
  "自己的證明與金鑰，從公司手中拿回自己手上。TET 是一個公開測試網，用來核實誰在何時簽署了甚麼：每宗交易及每份已簽署的紀錄都帶有兩個簽名，Ed25519 及 ML-DSA-44；成員可憑 RISC Zero 成員證明匿名發帖；訊息及檔案以 X25519 及 CRYSTALS-Kyber-768（第三輪）作端對端加密，金鑰及寄件人都在瀏覽器內核實。本文件描述程式碼在上述 commit 時的實際行為，包括它保護不到的地方；第 11 及第 13 節是關於計劃的部分。";

export const SECTIONS: Section[] = [
  {
    id: "version",
    title: "0. 版本與更新紀錄",
    body: [
      { p: TRANSLATION_NOTE },
      { p: "第 2.0 版，日期 2026-10-10，按頁首所列的 commit 撰寫；範圍：公開測試網 v0.2。若這個 commit 有某些程式碼公開種子節點尚未運行，正文會註明。" },
      { p: "本文件為自己加上標記：其 HTML 及 PDF 各由 TET 的發佈者 ID 簽署，每個標記都有一個證明碼。每個舊版本連同其證明碼都會繼續公開，因此本文件自身的歷史亦可核實，包括使用離線驗證工具（第 10 節）。" },
      {
        table: {
          head: ["版本", "日期", "正文（HTML）", "PDF", "狀態"],
          rows: [
            ["1", "2026-10-09", "TET-418B-CFT2", "TET-QQGQ-B5MM", "已由第 2 版取代（保留檔案：tet-technical-paper-v1.*）"],
            ["2", "2026-10-10", "本版的證明碼，見下載連結旁", "本版的證明碼，見下載連結旁", "現行"],
          ],
        },
      },
    ],
    sources: ["tet-network/ui/app/whitepaper/marks.json", "tet-network/ui/scripts/paper_build.mjs"],
  },
  {
    id: "positioning",
    title: "1. 一個不屬於任何公司的公開證明層",
    body: [
      { p: "自己的證明與金鑰，從公司手中拿回自己手上。" },
      { p: "為何是現在：生成的文字、圖片及聲音都很廉價，因此能夠不依賴任何公司而核實誰在何時簽署了甚麼，比東西看來是否真實更重要。" },
      { p: "坦白說明的限制：遺失密語（12 個字），任何人都無法替你復原；而目前 TET 仍由一位營運者及一個出塊者運作（第 7 及第 13 節）。" },
      { p: "TET 的用途：提供關於誰、何時、甚麼的證明，任何人都可以在不信任任何公司的情況下核實，而且即使 TET 本身消失，仍然可以核實。以下是相鄰系統各自的用途，以及 TET 補充了甚麼、留給它們做甚麼：" },
      {
        table: {
          head: ["", "用途", "TET 補充的", "TET 留給它的"],
          rows: [
            ["Bitcoin", "貨幣；極難改寫的帳本", "已簽署的「誰、何時、甚麼」紀錄，採用混合式後量子簽名", "貨幣，以及比 TET 現時難改寫得多的時間戳記"],
            ["Ethereum", "在鏈上執行的程式", "紀錄、成員證明及通訊，而非程式", "智能合約"],
            ["C2PA", "由相機及編輯工具嵌入的憑證", "由人自行選擇，為任何檔案的雜湊值加上的標記，可離線核實", "來自拍攝裝置本身的來源證明"],
            ["OpenTimestamps", "錨定於 Bitcoin 的免費時間戳記", "不只何時，還有誰簽署；匿名成員身分", "更強的時間戳記（錨定於 Bitcoin）"],
            ["Passkeys", "防網絡釣魚的登入", "由你持有的字詞衍生的逐網站金鑰；僅成員模式（設計，第 11 節）", "平台同步及復原"],
            ["Signal", "成熟的端對端通訊", "與紀錄使用同一組金鑰的通訊；安全碼", "元數據保護，以及成熟、經審計的協定"],
            ["Tor", "隱藏網絡流量的來源", "在成員之中隱藏是哪位成員發帖", "隱藏網絡位址：TET 不會這樣做"],
          ],
        },
      },
    ],
    sources: ["tet-network/ui/app/try/WhatPanel.tsx", "docs/plans/PAPER_V2_OUTLINE.md"],
  },
  {
    id: "principles",
    title: "2. 原則",
    body: [
      { ul: [
        "核實，而非信任：每個簽名及證明都由讀者自己的頁面或工具核實，而非照單全收節點給的結果。",
        "你的金鑰與證明在你手上：金鑰來自當事人持有的字詞；紀錄是他們自己保存的檔案。",
        "每項功能都在功能旁邊說明它證明甚麼、不證明甚麼。",
        "弱點會公開：SECURITY.md 按類別列出已知限制及每個已修正的問題。",
      ] },
    ],
    sources: ["SECURITY.md", "docs/THREAT_MODEL.md"],
  },
  {
    id: "architecture",
    title: "3. 架構",
    body: [
      {
        p: "一個節點就是一個 Rust 執行檔 `TET-Core`。啟動時，它從環境變數讀取設定，開啟 libp2p 及 ML-DSA 金鑰庫，開啟帳本資料庫，若鏈是空的就建立創世狀態，還原記憶池，然後啟動三個 libp2p swarm（區塊平面、推理平面及帳本平面）、一個 swarm 健康監察程式、若設定了 `TET_AUTO_MINE` 則啟動出塊程式，以及 REST 伺服器（預設連接埠 5010）。",
      },
      {
        p: "每個節點的儲存是一個 sled 資料庫（`TET_DB_DIR`）。帳本把餘額、按高度及按 id 索引的區塊、正典鏈、重組用的還原紀錄、交易索引及待處理交易分別存放在不同的 tree。訊息、檔案、簽名登記冊、網站及營運者的隱藏名單存放在同一個資料庫，但位於帳本之外：它們不屬於狀態根，也不在鏈上。",
      },
      {
        p: "一個區塊（`BlockRecordV1`）記錄其高度、區塊 id、父區塊 id、出塊者 id、交易雜湊值及交易、狀態根及獎勵。其 id 是以下內容的 SHA-256：`TET_BLOCK_ID_V2|`、高度（u64，小端序）、`|parent=`、父區塊 id、`|state=`、狀態根、`|txs=`、以逗號連接的交易雜湊值，以及 `|producer=`、出塊者 id。沒有 Merkle 交易根，id 亦不包含時間戳記或簽名。狀態根是排序後各餘額行的 SHA-256：只涵蓋餘額。預設出塊時間是 10 秒；種子節點使用 12 秒。",
      },
      {
        p: "一宗交易是一個 `SignedTxEnvelopeV1`：交易本身（`TxV1`，為 `transfer`、`signer_link`、`founding_member_enroll`、`genesis_bridge`、`initial_airdrop`、`file_fee`、`worker_register`、`enterprise_inference`、`verify_zk_proof` 其中之一）、一個混合簽名及一份證明書（attestation）。其雜湊值是其綁定鏈的簽署訊息的 SHA-256（第 4 節）。自 commit 01d7192 起，交易必須由它所代表的錢包簽署；在接納交易、預覽區塊及套用區塊時都會檢查。記憶池最多容納 10,000 宗交易或 64 MiB，並會逐出手續費最低的交易。",
      },
      {
        p: "區塊平面使用 TCP 配合 Noise 及 Yamux、嚴格模式並要求簽名訊息的 gossipsub、Kademlia、identify 及 mDNS。gossip 主題：`/tet/v1/blocks`、`/tet/v1/txs`、`/tet/v1/tmail`、`/tet/v1/files/announce`、`/tet/v1/ai-workload`。請求–回應協定負責傳送鏈的問候、追趕區段（最多 100 個區塊或 8 MiB）、按 id 取得的單一區塊、匿名成員資料及檔案擷取。若 swarm 的事件迴圈停頓 180 秒，監察程式會以狀態碼 70 結束程序，讓其監管程式重新啟動它。",
      },
      {
        p: "在公開模式（`TET_PUBLIC_API`）下，REST 伺服器只回應允許清單上的路徑：鏈狀態及瀏覽器讀取、簽名登記冊、網站、Tmail、Files 及匿名成員相關路徑。管理路徑只在本機迴路上回應。每個用戶端位址有各自的權杖桶：每秒 10 次讀取（突發 40 次）及每分鐘 20 次寫入（突發 10 次），另加每日上載配額。",
      },
    ],
    sources: [
      "tet-core/src/main.rs",
      "tet-core/src/ledger.rs",
      "tet-core/src/consensus.rs",
      "tet-core/src/protocol.rs",
      "tet-core/src/p2p.rs",
      "tet-core/src/sync.rs",
      "tet-core/src/swarm_health.rs",
      "tet-core/src/rest/public_api.rs",
      "tet-core/src/rest/state.rs",
    ],
  },
  {
    id: "cryptography",
    title: "4. 密碼學",
    body: [
      {
        p: "每個已簽署的物件都帶有混合簽名：對同一組位元組的一個 Ed25519 簽名及一個 ML-DSA 簽名，兩者都必須通過驗證。Ed25519 使用 `ed25519-dalek` 2.2。ML-DSA（FIPS 204）使用 `dilithium-rs` 0.2.0，這是一個由單一維護者負責、沒有公開第三方審計的 crate；節點把 NIST 的 ACVP ML-DSA-44 金鑰產生及簽名驗證測試向量收錄為測試。ML-DSA 簽署是確定性的：其隨機數是 `tet:mldsa44-signing-rnd:v1` 與訊息合併後的 SHA-256。",
      },
      {
        p: "領域分隔。大部分物件簽署一個以 `|` 連接的字串，字串以命名該物件的標籤開頭並綁定鏈：交易是 `tet tx v1|chain_id=…|genesis_hash=…|mldsa=…|tx=…`；Tmail 信封是 `tet tmail envelope v1|chain_id=…|genesis_hash=…|msg_id=…|…|payload_sha256=…|mldsa_pk=…`；網站編輯是 `tet site edit v1|…`。為某條鏈或某類物件簽的名，不會被驗證為另一條鏈或另一類物件。這些字串沒有長度前綴。簽名紀錄及代理載荷使用 PAE（DSSE 式的預先認證編碼，有長度前綴）：`PAE(\"tet agent payload v1\", [chain_id, genesis_hash, payloadType, payload])`，載荷類型包括 `application/vnd.tet.sha256`（檔案的雜湊值）、`tet sig publish v1`（簽署者同意公開某份紀錄）及 `tet agent manifest v1`。自 commit bea1e45 起，通訊金鑰登記亦使用 PAE，領域為 `tet tmail key v2`（第 6 節）。",
      },
      {
        p: "ML-DSA 等級。新金鑰一律為 ML-DSA-44。簽名紀錄、代理載荷及示範節點的手續費贊助只接受 ML-DSA-44（1312 位元組的金鑰、2420 位元組的簽名）。交易、Tmail、網站及檔案仍然接受等級 44、65 或 87 的金鑰，按其長度判斷。",
      },
      {
        p: "現時的錢包 ID。錢包來自 12 個（或 24 個）BIP39 字詞。Ed25519 私鑰是 BIP39 種子的開首 32 位元組（空白密碼短語，沒有衍生路徑），錢包 ID 是 Ed25519 公鑰的十六進位表示。ML-DSA 金鑰來自同一個種子：以 info `tet:pqc:mldsa44-seed:v1` 進行 HKDF-SHA256，得出一個用於確定性金鑰產生的 32 位元組種子。錢包 ID 只承諾 Ed25519 金鑰：ML-DSA 金鑰並沒有綁定到它。把兩把金鑰都綁定（`wallet_id_v2`）是 Phase 1 的改動（第 13 節）；在此之前，簽名中後量子的一半並不能把它與錢包綁在一起（SECURITY.md）。",
      },
      {
        p: "雜湊一律使用 SHA-256：交易雜湊值、區塊 id、紀錄雜湊值、網站編輯鏈、承諾（commitment）及 nullifier。證明碼 `TET-XXXX-XXXX` 是簽名紀錄 SHA-256 的開首 40 位元，以 Crockford base32 表示。它是查詢用的鍵，而不是證明：被核實的是紀錄的兩個簽名。",
      },
      {
        p: "在瀏覽器中，Ed25519 使用 `@noble/ed25519` 及 `@noble/curves`；ML-DSA 使用 `tet-pqc-wasm`，即編譯成 WebAssembly 的同一個 `dilithium-rs`。頁面自行核實紀錄及信封：它重建被簽署的位元組，固定 ML-DSA-44 的大小，並按從節點讀取（或由讀者自行輸入）的 鏈 ID 及創世雜湊值驗證兩個簽名。測試會檢查節點、WebAssembly 模組及瀏覽器從同一組字詞衍生出相同的金鑰。",
      },
    ],
    sources: [
      "tet-core/src/wallet.rs",
      "tet-core/src/quantum_shield.rs",
      "tet-core/src/fips204_vectors.rs",
      "tet-core/src/agent.rs",
      "tet-core/src/sigs.rs",
      "tet-core/src/rest/helpers.rs",
      "tet-pqc-wasm/src/lib.rs",
      "tet-network/ui/app/lib/proof_code.ts",
      "tet-network/ui/app/lib/ed25519_tet.ts",
      "SECURITY.md",
    ],
  },
  {
    id: "anonymous",
    title: "5. 匿名成員身分",
    body: [
      {
        p: "加入。成員以一份由其錢包簽署的紀錄登記一個承諾，即 `tet-anon-v1` 與一個 32 位元組成員秘密合併後的 SHA-256。該秘密由錢包的字詞衍生（HKDF-SHA256，info `tet-anon-member-v1`），從不離開成員的裝置。登記免費，登記冊只存於各節點本地，不在鏈上。節點每 60 秒開始一個新的時段（epoch）；登記從下一個時段起生效。成員組成一棵深度 20 的 Merkle 樹（最多 1,048,576 片葉），按錢包 id 排序，父節點為 `SHA-256(\"tet-node-v1\" ‖ left ‖ right)`。",
      },
      {
        p: "證明。一個 RISC Zero zkVM guest（risc0-zkvm 3.0.5）只使用 SHA-256，證明證明者知道一個秘密，而該秘密的承諾是某個根之下的一片葉。其公開輸出（journal，類型 `TAM1`）包括根、一個 nullifier、一把用來簽署帖文的一次性 Ed25519 金鑰、收件方（一個討論區或一個人）及 UTC 日期。nullifier 是 `SHA-256(\"tet-null-v1\" ‖ secret ‖ receiver ‖ day)`，日期以小端序 u64 表示，值為 `sent_at_ms / 86,400,000`。證明程式在成員自己的電腦上運行（127.0.0.1:9945），因為它會接收秘密。",
      },
      {
        p: "節點上的檢查。信封的一次性金鑰必須是 journal 中的那一把，其收件方及日期必須相符。收據（約 250 KiB，與 gossip 分開擷取）的雜湊值必須與公佈的值相符，必須來自 TET 固定的成員程式（`ANON_GUEST_IMAGE_IDS`，或營運者加入的 id），並通過驗證。根必須是節點在過去一小時內為某個時段建立、而日期與今天相差不超過一日的根。然後 nullifier 被佔用：每個 nullifier 只能用於一則訊息。自 commit f5f968a 起，節點會在儲存或轉發帖文之前完成以上所有檢查；未通過的帖文會被拒絕，經其他途徑到達的則會被刪除。",
      },
      {
        p: "由此可知。一位成員在每個討論區、每個 UTC 日只有一個每日 ID（在 UTC 午夜前後最多三個，因為前後各一日都會被接受）。帖文的每日 ID 是其 nullifier 的開首四個十六進位數字，只在證明通過驗證後才顯示：同一成員在同一討論區同一日相同，翌日則不同。僅限成員的投票使用由發起人選定的成員名單（3 至 1,000 個錢包）；節點從自己的登記冊建立該名單的根，因此投票不能用虛構的成員填滿。",
      },
      {
        p: "快速發帖（此 commit 已有；種子節點尚未運行）。一則證明通過驗證的帖文，會為該討論區及該 UTC 日登記其一次性金鑰；同一成員當日稍後的帖文不帶證明，以該金鑰簽署，因此會即時出現。當日開首那則帖文仍需約 30 秒產生證明。節點只在相應的登記帖文仍在核實期間，暫時保留未登記的 gossip 帖文；每個每日 ID 在一個討論區最多保留 20 則帖文；為每把金鑰控制節奏（一次 5 則，然後每 3 秒 1 則，每日 200 則）；投票則絕不接受沒有證明的帖文（一個證明，一張選票）。",
      },
      {
        p: "限制。成員的匿名範圍是其節點見過的登記者；在現時的測試網上，這個集合很小，匿名程度亦然。登記免費，因此這個集合目前沒有抗女巫攻擊的能力。節點看得到發帖者的 IP 位址及時間。",
      },
    ],
    sources: [
      "methods/guest/src/main.rs",
      "nexus-protocol/src/lib.rs",
      "prover/host/src/main.rs",
      "tet-core/src/tmail/anon.rs",
      "tet-core/src/tmail/store.rs",
      "tet-core/src/tmail/poll.rs",
      "tet-core/src/tmail/envelope.rs",
      "tet-network/ui/app/lib/anon_tree.mjs",
      "tet-network/ui/app/lib/board.mjs",
      "docs/plans/FAST_ANON_POSTING.md",
    ],
  },
  {
    id: "tmail",
    title: "6. 通訊：Tmail 及 Files",
    body: [
      {
        p: "金鑰交換使用 X25519 加 CRYSTALS-Kyber-768 第三輪，這並不是 FIPS 203 的 ML-KEM：兩者的位元組並不相容。節點使用 `pqcrypto-kyber` 0.8.1，瀏覽器使用 `crystals-kyber-js` 1.1.2（配合 `x25519-dalek` 2 及 `@noble/curves`）。名為 `mlkem_*` 的欄位是這些 Kyber 第三輪金鑰的舊名稱。把兩個平面都轉到 FIPS 203 ML-KEM-768 是 Phase 1 的項目。",
      },
      {
        p: "加密。每則訊息，寄件人都會產生一把新的 X25519 金鑰，以及對收件人金鑰的一次新的 Kyber 封裝；以 info `tet-e2ee-hybrid-v1` 對兩個共享秘密進行 HKDF-SHA256，得出一把 32 位元組的金鑰，用於 ChaCha20-Poly1305，nonce 為 12 位元組。通訊金鑰來自錢包的字詞（HKDF 標籤 `tet-tmail-x25519-v1` 及 `tet-tmail-mlkem-v1`），並以錢包按 PAE `tet tmail key v2` 簽署的登記發佈；節點不接受其他形式。",
      },
      {
        p: "在瀏覽器中核實（自 commit bea1e45 起，2026-10-10 部署）。加密訊息或檔案之前，頁面會擷取收件人的登記，並檢查兩個簽名都屬於收件人的錢包；舊式或未簽署的登記會被拒絕，並提示「請對方開啟 TET 一次以重新登記」。顯示寄件人之前，頁面會核實寄件人的簽名；偽造的不會顯示。每段對話都會顯示一個安全碼，即由雙方金鑰得出的 20 位數字：兩個畫面上的數字相同，代表中間沒有人替換過金鑰。",
      },
      {
        p: "信封由寄件人的錢包簽署；若是匿名帖文，則由其證明中的一次性金鑰簽署。簽名涵蓋訊息 id、旗標、寄件人、收件人、發佈時間、手續費及密文的 SHA-256。閱後即焚是由寄件人或收件人簽署的請求，要求合作的節點刪除該訊息：盡力而為，並非密碼學上的抹除。時間鎖是一個已簽署的發佈時間，在此之前合作的節點會扣留密文；任何持有收件人金鑰及密文的人都可以提早閱讀。",
      },
      {
        p: "保留期。訊息預設保留 7 日，最長 30 日；記名寄件人在每段對話保留最新 5 則，收件人保留最新 100 則匿名訊息（投票的所有選票），總共 50,000 則訊息。檔案使用相同的金鑰交換（HKDF 的 info 為 `tet-file-v1`），檔名、類型及內容分別加密；程式碼的預設是每個檔案 5 MB 及 30 日，示範節點則設定為 100 MB 及 7 日。",
      },
      {
        p: "節點看得到的：收件人、寄件人的錢包（或 `anonymous` 及一次性金鑰）、時間、旗標、大小，以及匿名帖文的 journal。它只持有密文，也沒有解密的途徑；只要雙方的安全碼相符，而所用的頁面是誠實的，就只有兩人能閱讀訊息。",
      },
    ],
    sources: [
      "tet-core/src/e2ee.rs",
      "tet-core/src/tmail/envelope.rs",
      "tet-core/src/tmail/keys.rs",
      "tet-core/src/tmail/burn.rs",
      "tet-core/src/tmail/timelock.rs",
      "tet-core/src/tmail/store.rs",
      "tet-core/src/files/mod.rs",
      "tet-core/src/files/storage.rs",
      "tet-network/ui/app/lib/tmail_e2ee.ts",
      "tet-network/ui/app/lib/tmail_keys.ts",
      "tet-network/ui/app/lib/files_e2ee.ts",
      "tet-network/ui/app/lib/key_trust.ts",
      "tet-network/ui/package.json",
    ],
  },
  {
    id: "consensus",
    title: "7. 現時的共識",
    body: [
      {
        p: "TET 現時只有一個出塊者。按明確設定（`TET_VALIDATOR_IDS`），赫爾辛基的種子節點是唯一的驗證者；另一個種子節點及其他節點都跟隨它。程式碼支援多個驗證者之間的領導者選舉，但只有一個驗證者時，領導者永遠是同一個節點。單一出塊者可以審查、重排或延遲交易，並決定何時出塊。",
      },
      {
        p: "跟隨節點只會在以下情況套用區塊：高度接續其鏈、出塊者在其驗證者集合中並且是預期的領導者、父區塊相符、沒有重複的交易、區塊 id 可以重新計算出來、獎勵正確，以及套用前後的狀態根都相符。以上每一項跟隨節點都可以自行重新計算，因此出塊者無法令跟隨節點接受無效的餘額變動。",
      },
      {
        p: "區塊目前未有出塊者簽名，區塊中的出塊者 id 是一個未簽署的字串。現時認證區塊來源的是出塊者的 libp2p 身分：跟隨節點固定出塊者的 PeerId（`TET_PRODUCER_PEERS`）。gossip 方面，嚴格模式的 gossipsub 會認證訊息作者；同步方面（追趕區段及按 id 擷取的區塊），跟隨節點只從受信任的節點取得區塊，即其固定的出塊者或其營運者列出的中繼節點。唯一的出塊者除非其營運者指定，否則不從任何節點取得區塊。出塊者簽名會在 Phase 1 加入（第 13 節）。",
      },
      {
        p: "分叉時，只會轉向累計權重嚴格較大的鏈；否則保留本地的鏈。出塊時間是出塊者時鐘上的計時器，而歸屬鎖定在套用區塊時以本地時鐘比較：掛鐘時間是共識的輸入之一（SECURITY.md）。",
      },
    ],
    sources: ["tet-core/src/consensus.rs", "tet-core/src/p2p.rs", "tet-core/src/sync.rs", "tet-core/src/ledger.rs", "SECURITY.md"],
  },
  {
    id: "threats",
    title: "8. 威脅模型",
    body: [
      { p: "完整的模型見 docs/THREAT_MODEL.md；以下為摘要：" },
      { p: "代他人的錢包行事：交易必須由它所代表的錢包簽署。現時這代表其 Ed25519 金鑰，因為錢包 ID 就是 Ed25519 公鑰，而 ML-DSA 金鑰並沒有綁定到它；在 `wallet_id_v2` 綁定兩把金鑰（Phase 1）之前，抗量子保護並不完整；綁定之後，偽造交易將需要同時破解 Ed25519 及 ML-DSA-44。" },
      {
        table: {
          head: ["範疇", "狀態", "由誰負責", "做法"],
          rows: [
            ["網絡（公共 Wi-Fi、DNS）", "部分", "TET（TLS）、使用者", "使用 HSTS 的 HTTPS；簽名及通訊金鑰在瀏覽器內核實"],
            ["受管理的裝置（學校、僱主）", "不在範圍內", "裝置的擁有者", "管理員看得到一切；頁面會說明"],
            ["DDoS", "部分", "TET 營運者", "按位址限制；單一營運者可被壓垮"],
            ["裝置惡意軟件、鍵盤記錄器、擴充功能", "不在範圍內", "使用者的裝置", "金鑰只以加密形式儲存，記住的 ID 會自動上鎖"],
            ["所提供的頁面被替換", "部分：最大的缺口", "TET 營運者；日後為擴充功能或應用程式", "只允許本來源指令碼的 CSP、沒有第三方程式碼、在 Next.js 產生 SRI 之處使用 SRI（現時涵蓋部分程式塊）；計劃：由發佈者簽署的建置清單"],
            ["節點提供錯誤的金鑰", "已防範", "TET（頁面程式碼）", "登記及寄件人在瀏覽器內核實；安全碼"],
            ["網絡釣魚、助記詞騙局", "部分", "TET（用字、來源綁定）、使用者", "固定語句：只在復原畫面要求輸入字詞；登入綁定來源（設計）"],
            ["重放、跨協定重用", "已防範", "TET", "每類簽名各有綁定鏈的 PAE 領域；一次性挑戰（設計）"],
            ["量子", "部分", "TET（Phase 1）", "混合簽名；Kyber 第三輪金鑰交換；在 wallet_id_v2 之前錢包 id 只綁定 Ed25519"],
            ["供應鏈", "部分", "TET 維護者", "鎖定檔、不執行安裝指令碼、Actions 以 SHA 固定、程式碼擁有者"],
            ["遺失字詞", "按設計不在範圍內", "使用者", "任何人都無法替你復原；每個使用字詞的畫面都會說明"],
          ],
        },
      },
      { p: "截至此 commit 的設計規則：綁定來源的一次性挑戰、逐網站金鑰及獨立的 `tet signin v1` 領域（用 TET 登入：已設計，未建置）；以淺白文字預覽，不使用短訊、電郵或推送批准；CSP 及沒有第三方程式碼，SRI 只屬部分；金鑰只在記憶體中，加密保管庫配合強度檢查及自動上鎖；三句固定語句；供應鏈固定；外來文字一律視為資料；security.txt。任何模型或測試都涵蓋不到的部分，會透過 Phase 2 的外部審計及私下報告處理（SECURITY.md）。" },
    ],
    sources: ["docs/THREAT_MODEL.md", "tet-network/ui/next.config.ts", "tet-network/ui/app/lib/device_store.ts", "tet-network/ui/app/try/ContinueBlock.tsx"],
  },
  {
    id: "history",
    title: "9. 已知弱點及安全歷史",
    body: [
      { p: "SECURITY.md 是公開的清單，與程式碼一起保存。現時已知的限制包括：未經審計；簽名軟件仍然年輕；兩個種子節點及一個出塊者；出塊者曾經停頓（33 小時，附事後檢討）；身分綁定只建基於 Ed25519；區塊以 PeerId 而非出塊者簽名認證；匿名性按其構造本來就弱；部分餘額寫入不經共識；掛鐘時間是共識的輸入；無效的零知識收據會被拒絕但不會受罰；以及測試網使用開發用的 鏈 ID。" },
      { p: "已修正的問題，按類別列出（細節存放於私人儲存庫）：" },
      { ul: [
        "桌面版的匿名模式可能發出記名訊息（在 PR #17 之前已修正）。",
        "交易不一定要由它所代表的錢包簽署（2026-10-08 已修正並部署；鏈上沒有這樣的交易）。",
        "證明未通過驗證的匿名帖文仍可能被保留及轉發（2026-10-09 已修正並部署）。",
        "鏈同步期間收到的區塊沒有按固定的出塊者檢查（2026-10-09 已修正並部署）。",
        "未經核實的匿名帖文可能把已核實的帖文擠出討論區（2026-10-09 已修正並部署）。",
        "頁面信任節點提供的通訊金鑰（2026-10-10 已修正並部署）。",
      ] },
      { p: "如要報告漏洞，請按照 SECURITY.md 私下報告，不要在公開的 issue 中提出。" },
    ],
    sources: ["SECURITY.md", "docs/postmortems/2026-10-04-producer-wedge-33h.md"],
  },
  {
    id: "verify-without-tet",
    title: "10. 不靠 TET 也能核實",
    body: [
      { p: "一個獨立的驗證工具（一個 HTML 檔案及一個單檔命令列工具），在讀者自己的裝置上核實紀錄，不向任何伺服器發出請求（此 commit 已有；隨示範節點公開）。它內嵌了驗證程式碼及 TET 的 ML-DSA WebAssembly；其內容安全政策禁止一切連線，並有測試在停用網絡的情況下執行它。" },
      { p: "第 1 級，離線且不需要鏈：紀錄中的兩把金鑰為這條鏈簽署了這個 SHA-256；若提供檔案，該檔案的雜湊值正是這個值。它會顯示證明碼，以及簽署者是否 TET 的發佈者 ID。它不證明誰持有這些金鑰、內容是否屬實，或簽署的時間。" },
      { p: "第 2 級，計劃中：在鏈的副本中位於區塊 N。在區塊帶有出塊者簽名之前（Phase 1），這只能檢查副本本身是否一致；讀者須把其鏈頂與獨立來源比較。" },
      { p: "驗證工具的兩個檔案本身亦由發佈者 ID 加上標記，其 SHA-256 在旁公開。" },
    ],
    sources: ["tet-network/ui/app/lib/offline_verify.mjs", "tet-network/ui/scripts/build_offline_verifier.mjs", "tet-network/ui/public/verify/tet-verify.html"],
  },
  {
    id: "sign-in",
    title: "11. 用 TET 登入（已設計，未建置）",
    body: [
      { p: "任何網站都可以加入的第二重驗證，以及僅成員模式。此 commit 只有設計。" },
      { ul: [
        "挑戰包含發出請求的來源、一個 nonce 及有效期；只可使用一次，而簽署程式只會在返回的來源就是挑戰的來源時才簽署。",
        "逐網站金鑰由字詞及來源衍生，因此兩個網站無法憑金鑰把同一個人連結起來。",
        "簽名使用獨立的 PAE 領域 `tet signin v1`，因此登入簽名永遠不會是有效的交易或紀錄，反之亦然。",
        "僅成員模式只透露「群組 X 的一位成員已登入」；固定的逐網站化名是一個選項，網站必須說明。",
        "TET 或任何節點上都沒有密碼或密碼雜湊值；不使用短訊、電郵驗證碼或推送批准；每次簽署前都有淺白文字預覽；重複請求設有冷卻時間。",
        "限制會寫在每個登入畫面上：如遺失密語（12 個字），任何人都無法替你復原帳戶。",
      ] },
    ],
    sources: ["docs/plans/SIGN_IN_WITH_TET.md"],
  },
  {
    id: "shelter",
    title: "12. 庇護所及人類空間",
    body: [
      { p: "庇護所（此 commit 已有；種子節點尚未運行）是僅限成員的空間：成員經面對面邀請或引薦加入，帖文以端對端加密傳給成員，閱讀需要成員簽署的請求，帖文亦從不轉發到其他節點。成員以暱稱發帖，暱稱旁會顯示一個無人能自選的成員編號；亦可在庇護所自己的成員集合內匿名發帖。" },
      { p: "它證明的：每則帖文都由一位獲引薦的成員撰寫，而這個空間不會提供給爬蟲。它不證明的：沒有使用 AI。「不要在這裡張貼由 AI 撰寫的文字」這條規則是成員之間的承諾，不是過濾器。" },
    ],
    sources: ["docs/plans/SHELTER.md", "tet-core/src/tmail/shelter.rs"],
  },
  {
    id: "roadmap",
    title: "13. 路線圖",
    body: [
      { p: "Phase 0 是現時的測試網。Phase 1 是新的創世，目標為 2027 年第一季：這是以季度公佈的目標，不是承諾；若有變動，會公開變動。Phase 1 的項目現時都沒有在測試網上運行。" },
      {
        table: {
          head: ["改動", "作用", "狀態"],
          rows: [
            ["V3 區塊標頭", "出塊者的時間戳記由有長度前綴（PAE）的區塊 id 涵蓋。", "已在 Phase 1 分支建置"],
            ["出塊者簽名", "專用的混合出塊者金鑰簽署每個區塊 id；驗證者在創世中列明。", "已在 Phase 1 分支建置"],
            ["逐平面金鑰", "區塊、推理及帳本平面各用獨立的 libp2p 身分。", "已在 Phase 1 分支建置"],
            ["`wallet_id_v2`", "錢包 ID 同時承諾兩把金鑰；每個錢包 id 都會改變。", "已設計，未建置"],
            ["轉到 FIPS 203 ML-KEM-768", "兩個加密平面都從 Kyber 第三輪轉到最終標準。", "未開始"],
          ],
        },
      },
      { p: "Phase 2 至 10 是願景，沒有日期。其中兩個是令第 1 節完全成立的前提：Phase 2，外部安全審計；以及 Phase 3，多於一個出塊者。在此之前，在 `wallet_id_v2` 之前抗量子保護並不完整，而 TET 由一位營運者運作。" },
    ],
    sources: ["docs/PHASE_1_GENESIS_SPEC.md", "docs/QUEUE.md", "tet-network/ui/app/try/WhatPanel.tsx"],
  },
  {
    id: "not",
    title: "14. TET 不是甚麼",
    body: [
      { ul: [
        "不是貨幣：測試網的單位是練習用單位，不能兌換成金錢。",
        "不是智能合約平台。",
        "不提供 IP 私隱：節點看得到位址及時間；請使用 Tor 或自己的節點。",
        "不是公司，亦尚未去中心化：現時只有一位營運者及一個出塊者。",
        "不是主網：測試網的創世包含一個創辦人錢包，以一年懸崖期鎖定（`TET_FOUNDER_CLIFF_MS`），以及一個收取測試手續費的庫房位址（`TET_TREASURY_ADDRESS`）。這條鏈永遠不會成為主網；主網的供應量及分配尚未決定。",
      ] },
    ],
    sources: ["SECURITY.md", "tet-network/ui/app/try/WhatPanel.tsx", "tet-core/src/genesis.rs", "tet-core/src/ledger.rs"],
  },
];
