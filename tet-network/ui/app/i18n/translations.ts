export type Lang = "en" | "jp";

export type TKey =
  // nav
  | "nav.publicPortal"
  | "nav.createWallet"
  | "nav.home"
  | "nav.understand"
  | "nav.builders"
  | "nav.whitepaper"
  | "nav.discord"
  | "nav.contact"
  | "nav.login"
  | "nav.language"
  // home
  // participate
  // docs portal (participate)
  // understand
  | "understand.title"
  | "understand.sub"
  | "understand.nodeKicker"
  | "understand.nodeTitle"
  | "understand.nodeBody"
  | "understand.glowLabel"
  | "understand.whatTitle"
  | "understand.whatBody"
  | "understand.differenceTitle"
  | "understand.difference1Title"
  | "understand.difference1Body"
  | "understand.difference2Title"
  | "understand.difference2Body"
  | "understand.difference3Title"
  | "understand.difference3Body"
  | "understand.prose.basicsTitle"
  | "understand.prose.basicsBody1"
  | "understand.prose.basicsBody2"
  | "understand.prose.authTitle"
  | "understand.prose.authBody1"
  | "understand.prose.authBody2"
  | "understand.prose.procTitle"
  | "understand.prose.procBody1"
  | "understand.prose.procBody2"
  | "understand.prose.consTitle"
  | "understand.prose.consBody1"
  | "understand.prose.consBody2"
  | "understand.onThisPage"
  | "understand.navBasics"
  | "understand.navAuthorization"
  | "understand.navProcessing"
  | "understand.navConsensus"
  | "understand.tldrTitle"
  | "understand.tldrP1"
  | "understand.tldrP2"
  | "understand.tldrP3"
  | "understand.ctaTitle"
  | "understand.ctaBody"
  | "understand.ctaParticipate"
  | "understand.ctaGithub"
  | "understand.ctaGithubUrl"
  | "understand.flowTitle"
  | "understand.flowBox1Title"
  | "understand.flowBox1Desc"
  | "understand.flowBox2Title"
  | "understand.flowBox2Desc"
  | "understand.flowFastTitle"
  | "understand.flowFastDesc"
  | "understand.flowDisputeTitle"
  | "understand.flowDisputeDesc"
  | "understand.layerClientTitle"
  | "understand.layerClientSub"
  | "understand.arrowSignedRequest"
  | "understand.layerEdgeTitle"
  | "understand.layerEdgeSub"
  | "understand.arrowDispute"
  | "understand.arrowFastPath"
  | "understand.layerCourtTitle"
  | "understand.layerCourtSub"
  | "understand.layerSettleTitle"
  | "understand.layerSettleSub"
  | "understand.compareLegacyKicker"
  | "understand.compareLegacyTitle"
  | "understand.compareLegacyBody"
  | "understand.compareTetKicker"
  | "understand.compareTetTitle"
  | "understand.compareTetBody"
  | "understand.atGlance"
  | "understand.atGlance991Title"
  | "understand.atGlance991Sub"
  | "understand.atGlancePqcTitle"
  | "understand.atGlancePqcSub"
  | "understand.atGlanceEdgeTitle"
  | "understand.atGlanceEdgeSub"
  | "understand.sectionComputeKicker"
  | "understand.sectionComputeTitle"
  | "understand.sectionComputeP1"
  | "understand.sectionComputeP2"
  | "understand.section991Kicker"
  | "understand.section991Title"
  | "understand.section991P1"
  | "understand.section991P2"
  | "understand.sectionWhyKicker"
  | "understand.sectionWhyTitle"
  | "understand.sectionWhyP1"
  | "understand.sectionWhyP2"
  | "understand.sectionPqcKicker"
  | "understand.sectionPqcTitle"
  | "understand.sectionPqcP1"
  | "understand.sectionPqcP2"
  | "understand.nextTitle"
  | "understand.nextBody"
  | "understand.nextCta"
  | "understand.nextTip"
  | "understand.whyTitle"
  | "understand.whySub"
  | "understand.whyAudienceUsersTitle"
  | "understand.whyAudienceUsersSub"
  | "understand.whyUsersP1"
  | "understand.whyUsersP2"
  | "understand.whyUsersP3"
  | "understand.whyAudienceBizTitle"
  | "understand.whyAudienceBizSub"
  | "understand.whyBizP1"
  | "understand.whyBizP2"
  | "understand.whyBizP3"
  // setup
  | "setup.headerTitle"
  | "setup.headerSub"
  | "setup.homeLink"
  | "setup.recoveryTitle"
  | "setup.generating"
  | "setup.step2Kicker"
  | "setup.step2Body"
  | "setup.step2Checkbox"
  | "setup.step3Kicker"
  | "setup.step3Body"
  | "setup.tosLabel"
  | "setup.tosDocTitle"
  | "setup.tosDocPreamble"
  | "setup.tos1_1Title"
  | "setup.tos1_1Body"
  | "setup.tos1_2Title"
  | "setup.tos1_2Body"
  | "setup.tos1_3Title"
  | "setup.tos1_3Body"
  | "setup.tos1_4Title"
  | "setup.tos1_4Body"
  | "setup.tosRequiredErr"
  | "setup.pinPlaceholder"
  | "setup.createBtn"
  | "setup.working"
  | "setup.footerNote"
  | "setup.errPrefix"
  | "setup.errBackup"
  | "setup.errPhraseNotReady"
  | "setup.errPqcNotReady"
  | "setup.errPinFormat"
  // os

const en: Record<TKey, string> = {
  "nav.publicPortal": "Public portal",
  "nav.createWallet": "Create Wallet",
  "nav.home": "Home",
  "nav.understand": "Understand TET",
  "nav.builders": "For Builders",
  "nav.whitepaper": "Whitepaper (Draft)",
  "nav.discord": "Discord",
  "nav.contact": "Contact Us",
  "nav.login": "Login",
  "nav.language": "Language",



  "understand.title": "Understand TET",
  "understand.sub":
    "This is not an API wrapper. It is a decentralized replacement for AWS: a peer-to-peer compute grid where inference can be authorized, audited, and enforced by cryptography.",
  "understand.nodeKicker": "Node network",
  "understand.nodeTitle": "99% Edge Workers → 1% ZK Court",
  "understand.nodeBody":
    "Most requests route to fast, local inference. Disputes escalate to a small, enforceable court path that can prove execution against public rules.",
  "understand.glowLabel": "glow  worker graph",
  "understand.whatTitle": "What actually is TET",
  "understand.whatBody":
    "It is a decentralized AI grid that replaces giant cloud servers (like AWS) with a global network of personal computers. You can either provide compute power to EARN, or pay to USE the grid. No central control, no data harvesting.",
  "understand.differenceTitle": "The Core Difference",
  "understand.difference1Title": "No API Wrappers",
  "understand.difference1Body":
    "Many AI projects still rely on centralized infrastructure. TET is designed around local hardware: operators run inference engines (such as Ollama) on their own machines to power the grid.",
  "understand.difference2Title": "Signatures over API Keys",
  "understand.difference2Body":
    "Instead of centralized API keys, TET authorizes requests at the protocol boundary using cryptographic signatures (Ed25519) and a unique nonce per request.",
  "understand.difference3Title": "A Proof of Compute",
  "understand.difference3Body":
    "TET is an accounted unit for verifiable work. Value flows when execution is proven and accepted under the network’s public rules.",

  "understand.prose.basicsTitle": "The Basics of TET",
  "understand.prose.basicsBody1":
    "You don’t need to understand the math to use TET. The system is built to feel simple: you either provide compute and earn, or you pay to use the grid.",
  "understand.prose.basicsBody2":
    "If AWS is a single corporation running giant data centers, TET is a peer-to-peer network of personal computers running the same kind of work—without a central owner.",
  "understand.prose.authTitle": "Authorization - Cryptographic Signatures",
  "understand.prose.authBody1":
    "Most SaaS systems rely on API keys. TET replaces that model with local private keys controlled by the user.",
  "understand.prose.authBody2":
    "Each request can be authorized by an Ed25519 signature (and, when required, a quantum-resistant ML-DSA-44 signature), proving intent without trusting a central server.",
  "understand.prose.procTitle": "Processing - Edge Inference",
  "understand.prose.procBody1":
    "The actual AI work happens at the edge. Worker Nodes run local inference engines—such as Ollama—to execute models on real hardware.",
  "understand.prose.procBody2":
    "This keeps execution close to the machine doing the work. It’s not a thin wrapper around a central API; it is compute performed on local devices.",
  "understand.prose.consTitle": "Consensus - The 99/1 Model",
  "understand.prose.consBody1":
    "TET does not mine inference the way blockchains mine transactions. AI workloads are too heavy for every participant to repeat the same computation.",
  "understand.prose.consBody2":
    "Instead, the network runs optimistically (the 99%) for speed, and escalates only during disputes (the 1%) to a ZK Court path for mathematical enforcement under public rules.",
  "understand.onThisPage": "On this page",
  "understand.navBasics": "The Basics",
  "understand.navAuthorization": "Authorization",
  "understand.navProcessing": "Processing",
  "understand.navConsensus": "Consensus",
  "understand.tldrTitle": "TL;DR: In Plain English",
  "understand.tldrP1":
    "Imagine if instead of one giant corporation (like AWS or Google) owning all the AI servers, millions of personal computers around the world worked together to process AI.",
  "understand.tldrP2": "TET is that network.",
  "understand.tldrP3":
    "If you have a computer, you can earn money by letting it process AI tasks. If you are an app developer, you can pay the network to run AI without your data ever being trapped in a central corporate server.",
  "understand.ctaTitle": "Next Steps",
  "understand.ctaBody":
    "Ready to run a node, build an application, or dive into the open-source GitHub repositories? Read the practical manual.",
  "understand.ctaParticipate": "Participate in the Grid →",
  "understand.ctaGithub": "Explore Nexus-Core on GitHub →",
  "understand.ctaGithubUrl": "https://github.com/Nexus-Network-Foundation/nexus-core",
  "understand.flowTitle": "Technical Flow",
  "understand.flowBox1Title": "Signed Request",
  "understand.flowBox1Desc": "Builder signs prompt + nonce via Ed25519.",
  "understand.flowBox2Title": "Local Inference",
  "understand.flowBox2Desc":
    "Worker node (Ollama) processes data locally and generates a cryptographic receipt.",
  "understand.flowFastTitle": "Optimistic Settlement",
  "understand.flowFastDesc": "Receipt accepted. TET value transferred instantly.",
  "understand.flowDisputeTitle": "ZK Court Verification",
  "understand.flowDisputeDesc":
    "Dispute escalated. Cryptographic proof verified against public network rules.",
  "understand.layerClientTitle": "Builder / Application",
  "understand.layerClientSub": "Generates Ed25519 signature + nonce.",
  "understand.arrowSignedRequest": "↓ Signed Request",
  "understand.layerEdgeTitle": "Edge Worker (Ollama Node)",
  "understand.layerEdgeSub": "Executes local inference. Generates cryptographic receipt.",
  "understand.arrowDispute": "↓ Dispute / Fallback (1%)",
  "understand.arrowFastPath": "→ Fast Path (99%)",
  "understand.layerCourtTitle": "ZK Court (Enforcement)",
  "understand.layerCourtSub": "Verifies proof against public rules.",
  "understand.layerSettleTitle": "Optimistic Settlement",
  "understand.layerSettleSub": "Instant TET transfer.",
  "understand.compareLegacyKicker": "Legacy Consensus (Bitcoin / Ethereum)",
  "understand.compareLegacyTitle": "100% Redundant Global Consensus",
  "understand.compareLegacyBody":
    "Every node re-executes the exact same transaction. Highly secure for simple payments, but impossible for heavy AI workloads.",
  "understand.compareTetKicker": "TET Architecture",
  "understand.compareTetTitle": "Optimistic Edge + ZK Enforcement",
  "understand.compareTetBody":
    "Inference runs natively on ONE local node. The network only verifies via ZK Court during a dispute. Infrastructure speed with verifiable security.",
  "understand.atGlance": "In short",
  "understand.atGlance991Title": "Security model",
  "understand.atGlance991Sub": "Optimistic execution + dispute path",
  "understand.atGlancePqcTitle": "Post-quantum",
  "understand.atGlancePqcSub": "Hybrid-ready authorization",
  "understand.atGlanceEdgeTitle": "Edge compute",
  "understand.atGlanceEdgeSub": "Local inference + verifiable receipts",
  "understand.sectionComputeKicker": "TET (Compute Index)",
  "understand.sectionComputeTitle": "The unit of accounted compute",
  "understand.sectionComputeP1":
    "TET is how the network accounts for compute. Instead of API keys and centralized quotas, authorization is per-request and cryptographically signed, with nonces preventing replay.",
  "understand.sectionComputeP2":
    "A signed request binds intent to concrete inputs (prompt, nonce, model, and policy). That makes compute measurable, attributable, and audit-friendly—without handing control to a central gatekeeper.",
  "understand.section991Kicker": "99/1 Efficiency Model",
  "understand.section991Title": "Fast path + dispute path",
  "understand.section991P1":
    "Most of the time, the network stays on the fast path (the “99”). If signatures, nonces, and policy checks pass, results can be accepted quickly.",
  "understand.section991P2":
    "The remaining “1” is enforcement: if a result is disputed, the request can escalate to a ZK Court path that proves or rejects contested execution against public rules.",
  "understand.sectionWhyKicker": "Why it matters",
  "understand.sectionWhyTitle": "Why 99/1 instead of 100% redundant execution",
  "understand.sectionWhyP1":
    "Bitcoin and Ethereum are designed around global verification where every full participant re-executes (or re-verifies) the same state transitions. That model is robust for payments and smart contracts, but it’s not practical for AI inference workloads.",
  "understand.sectionWhyP2":
    "TET Network uses 99/1: the common case is infrastructure speed, and the exceptional case escalates to a dispute path enforced by a ZK Court. The goal is to keep the fast path fast while preserving public enforcement.",
  "understand.sectionPqcKicker": "ML-DSA-44 Quantum Resistance",
  "understand.sectionPqcTitle": "Post-quantum identity for authorization",
  "understand.sectionPqcP1":
    "TET uses ML-DSA-44 as a post-quantum signature primitive for authorization. Keys are derived locally and never leave the device; only signatures and public keys are transmitted.",
  "understand.sectionPqcP2":
    "In hybrid mode, the system can require both a classical signature and an ML-DSA-44 signature over the same message, so breaking either scheme alone is insufficient to forge authorization.",
  "understand.nextTitle": "Next: run a Worker node",
  "understand.nextBody": "Operator participation is designed to be explicit and local-first. The OS checks only for a reachable engine on your machine.",
  "understand.nextCta": "Open TET OS",
  "understand.nextTip": "Tip: keep accents intentional—yellow is reserved for primary actions and glow in dark sections.",
  "understand.whyTitle": "Why TET?",
  "understand.whySub": "Built for real-world AI: privacy, auditability, and infrastructure-grade latency.",
  "understand.whyAudienceUsersTitle": "For AI Users",
  "understand.whyAudienceUsersSub": "Privacy-first compute without subscriptions or lock-in.",
  "understand.whyUsersP1": "Run local inference where possible. Your prompts and data stay on your device by default.",
  "understand.whyUsersP2": "No $20/mo subscriptions: pay-per-compute is explicit, auditable, and aligned with actual usage.",
  "understand.whyUsersP3": "Uncensored local execution: your device enforces your preferences, not a centralized vendor policy layer.",
  "understand.whyAudienceBizTitle": "For AI Builders / Businesses",
  "understand.whyAudienceBizSub": "Eliminate API key liability and prove what was executed.",
  "understand.whyBizP1": "Zero centralized API key exposure: authorization is cryptographic, per-request, and nonce-scoped.",
  "understand.whyBizP2": "Auditable execution: signed requests create a verifiable trail of intent; disputes can escalate to a ZK Court path.",
  "understand.whyBizP3": "Infrastructure-level latency: keep the fast path fast with 99/1, while preserving enforceability when contested.",

  "setup.headerTitle": "Create your TET Vault",
  "setup.headerSub":
    "Write down your 12-word post-quantum recovery phrase. This is the only way to recover your funds if you lose your device.",
  "setup.homeLink": "Home",
  "setup.recoveryTitle": "Your recovery phrase (12 words)",
  "setup.generating": "Generating…",
  "setup.step2Kicker": "Step 2 — Backup confirmation",
  "setup.step2Body": "You must confirm you have backed up the 12 words before setting a Master Password.",
  "setup.step2Checkbox": "I have backed up these 12 words securely.",
  "setup.step3Kicker": "Step 3 — Set a Master Password",
  "setup.step3Body": "Your Master Password encrypts the vault locally. It is never sent to the network.",
  "setup.tosLabel":
    "I agree to the Terms of Service. I understand TET is a utility infrastructure token, not a financial investment, and I am responsible for my own node compliance.",
  "setup.tosDocTitle": "Terms of Service (Key Clauses)",
  "setup.tosDocPreamble":
    "The following clauses are provided for clarity and should be read as part of the Terms of Service. By using TET OS and the network, you agree to them.",
  "setup.tos1_1Title": "1.1 Infrastructure Provider Status",
  "setup.tos1_1Body":
    "TET Network operates strictly as a decentralized infrastructure provider. Similar to a telecommunications carrier or a cloud hosting provider (e.g., AWS), we do not create, curate, or monitor the data processed through the grid.",
  "setup.tos1_2Title": "1.2 User-Generated Content & Liability",
  "setup.tos1_2Body":
    "All AI prompts, inputs, and generated outputs are the sole responsibility of the User (Builder and Worker). TET Foundation (or its current entities) shall not be held liable for any illegal, infringing, or harmful content generated using the network's compute resources.",
  "setup.tos1_3Title": "1.3 Indemnification",
  "setup.tos1_3Body":
    "Users agree to indemnify and hold harmless TET Network from any legal claims, damages, or liabilities arising from their use of the network, including but not limited to copyright infringement or violations of local laws.",
  "setup.tos1_4Title": "1.4 No Monitoring Obligation; As-Is",
  "setup.tos1_4Body":
    "Due to the decentralized nature of the network, TET cannot and does not monitor real-time inference. Users acknowledge that the network is an “as-is” and “as-available” resource used at their own risk.",
  "setup.tosRequiredErr": "Please agree to the Terms of Service to continue.",
  "setup.pinPlaceholder": "••••••",
  "setup.createBtn": "Encrypt & Create Vault",
  "setup.working": "Working…",
  "setup.footerNote":
    "Non-custodial: keys never leave your device. Losing your recovery phrase permanently locks your funds. The vault is stored in your browser storage under tet.vault.v1.",
  "setup.errPrefix": "Setup failed:",
  "setup.errBackup": "Please confirm you backed up your 12-word recovery phrase.",
  "setup.errPhraseNotReady": "Recovery phrase is not ready yet. Please wait.",
  "setup.errPqcNotReady": "PQC module not ready",
  "setup.errPinFormat": "Master Password must be at least 8 characters.",

};

const jp: Record<TKey, string> = {
  "nav.publicPortal": "公開ポータル",
  "nav.createWallet": "ウォレット作成",
  "nav.home": "ホーム",
  "nav.understand": "TETを理解する",
  "nav.builders": "開発者向け",
  "nav.whitepaper": "ホワイトペーパー（草案）",
  "nav.discord": "Discord",
  "nav.contact": "お問い合わせ",
  "nav.login": "ログイン",
  "nav.language": "言語",



  "understand.title": "TETを理解する",
  "understand.sub":
    "これはAPIラッパーではありません。AWSの分散代替としてのP2Pコンピュート・グリッドです。推論は暗号で認可され、監査でき、必要なら公開ルールの下で執行できます。",
  "understand.nodeKicker": "ノードネットワーク",
  "understand.nodeTitle": "99% Edge Workers → 1% ZK Court",
  "understand.nodeBody":
    "多くのリクエストは高速なローカル推論へルーティングされます。争いが起きた場合のみ、公開ルールに対して実行を証明できるZK Courtへエスカレートします。",
  "understand.glowLabel": "glow  worker graph",
  "understand.whatTitle": "TETとは一体何か",
  "understand.whatBody":
    "TET Networkは、AWSのような巨大クラウドサーバーの代わりに、世界中のパーソナルコンピュータを繋いでAI処理を実行する分散型AIグリッドです。計算力を提供して獲得することも、支払って利用することもできます。中央の支配もなく、データの搾取もありません。",
  "understand.differenceTitle": "一般的なトークンとの決定的な違い",
  "understand.difference1Title": "AWSラッパーからの脱却",
  "understand.difference1Body":
    "多くのAIプロジェクトは依然として中央集権インフラに依存しています。TETはローカルハードウェアを前提に設計され、オペレーターが自分のPCで推論エンジン（Ollama等）を動かしてグリッドを支えます。",
  "understand.difference2Title": "APIキーではなく暗号署名を",
  "understand.difference2Body":
    "中央のAPIキーではなく、暗号署名（Ed25519）とリクエストごとのnonceで、プロトコル境界で認可します。",
  "understand.difference3Title": "投機ではなく、コンピュートの証明",
  "understand.difference3Body":
    "TETは検証可能な仕事のための計上単位です。実行が証明され、公開ルールの下で受理されたときに価値が流れます。",

  "understand.prose.basicsTitle": "TETの基本事項",
  "understand.prose.basicsBody1":
    "数式を理解する必要はありません。TETは、提供して獲得するか、支払って利用するか——その2つが自然に成立するよう設計されています。",
  "understand.prose.basicsBody2":
    "AWSが巨大企業のデータセンターで動く仕組みだとすれば、TETは個人のPCがP2Pでつながり、同種の仕事を担う仕組みです。中央の所有者はいません。",
  "understand.prose.authTitle": "認可 - 暗号署名",
  "understand.prose.authBody1":
    "多くのSaaSはAPIキーに依存します。TETはその代わりに、利用者が保持するローカル秘密鍵を前提にします。",
  "understand.prose.authBody2":
    "各リクエストはEd25519署名（必要に応じて量子耐性のML-DSA-44署名）で認可でき、中央サーバーを信頼せずに意思を数学的に証明できます。",
  "understand.prose.procTitle": "処理 - エッジ推論",
  "understand.prose.procBody1":
    "AIの実処理はエッジで起きます。Worker NodeはOllama等のローカル推論エンジンを動かし、実ハードウェア上でモデルを実行します。",
  "understand.prose.procBody2":
    "それは中央APIの薄いラッパーではなく、ローカルデバイスで行われるコンピュートです。",
  "understand.prose.consTitle": "合意 - 99/1モデルとZK Court",
  "understand.prose.consBody1":
    "TETは、ブロックチェーンがトランザクションを採掘するのと同じやり方で推論を“採掘”しません。AIは全員が同じ計算を繰り返すには重すぎます。",
  "understand.prose.consBody2":
    "そこで、通常は楽観的に（99%）速度を優先し、争いが起きたときだけ（1%）ZK Courtへエスカレートして、公開ルールの下で数学的に執行します。",
  "understand.onThisPage": "このページの内容",
  "understand.navBasics": "基本事項",
  "understand.navAuthorization": "認可",
  "understand.navProcessing": "処理",
  "understand.navConsensus": "合意",
  "understand.tldrTitle": "TL;DR（平易に言うと）",
  "understand.tldrP1":
    "もしAIサーバーが、AWSやGoogleのような一社の巨大企業に独占されるのではなく、世界中の何百万台ものパソコンが協力してAI処理を担うとしたら。",
  "understand.tldrP2": "TETは、そのためのネットワークです。",
  "understand.tldrP3":
    "あなたがPCを持っているなら、AIタスク処理に参加して収益化できます。アプリ開発者なら、中央の企業サーバーにデータを閉じ込めることなく、ネットワークに支払ってAIを動かせます。",
  "understand.ctaTitle": "次のステップ",
  "understand.ctaBody":
    "ノードを動かす、アプリを作る、オープンソースのGitHubを追う——次は実務マニュアルへ。",
  "understand.ctaParticipate": "グリッドに参加する →",
  "understand.ctaGithub": "Nexus-Core をGitHubで見る →",
  "understand.ctaGithubUrl": "https://github.com/Nexus-Network-Foundation/nexus-core",
  "understand.flowTitle": "技術フロー",
  "understand.flowBox1Title": "署名済みリクエスト",
  "understand.flowBox1Desc": "Builderは prompt + nonce をEd25519で署名します。",
  "understand.flowBox2Title": "エッジ推論",
  "understand.flowBox2Desc":
    "Workerノード（Ollama）がローカルで推論を実行し、暗号学的なレシートを生成します。",
  "understand.flowFastTitle": "楽観的承認",
  "understand.flowFastDesc": "レシートが受理され、TETの価値移転が即時に成立します。",
  "understand.flowDisputeTitle": "ゼロ知識裁定",
  "understand.flowDisputeDesc":
    "争いが発生した場合のみエスカレートし、公開ルールに対して暗号学的証明を検証します。",
  "understand.layerClientTitle": "Builder / Application",
  "understand.layerClientSub": "Ed25519署名とnonceを生成します。",
  "understand.arrowSignedRequest": "↓ 署名済みリクエスト",
  "understand.layerEdgeTitle": "Edge Worker（Ollama Node）",
  "understand.layerEdgeSub": "ローカル推論を実行し、暗号学的レシートを生成します。",
  "understand.arrowDispute": "↓ 争い / フォールバック（1%）",
  "understand.arrowFastPath": "→ 高速パス（99%）",
  "understand.layerCourtTitle": "ZK Court（執行）",
  "understand.layerCourtSub": "公開ルールに対して証明を検証します。",
  "understand.layerSettleTitle": "楽観的承認",
  "understand.layerSettleSub": "即時にTETが移転します。",
  "understand.compareLegacyKicker": "従来型コンセンサス（Bitcoin / Ethereum）",
  "understand.compareLegacyTitle": "100%冗長なグローバルコンセンサス",
  "understand.compareLegacyBody":
    "全ノードが同じ処理を再実行します。単純な決済には強い一方で、重いAIワークロードには不可能に近い。",
  "understand.compareTetKicker": "TETアーキテクチャ",
  "understand.compareTetTitle": "楽観的エッジ + ZK執行",
  "understand.compareTetBody":
    "推論は単一ノードでネイティブ速度のまま実行されます。ネットワークがZK Courtで検証するのは争いが起きたときだけ。インフラ速度と検証可能なセキュリティを両立します。",
  "understand.atGlance": "要点",
  "understand.atGlance991Title": "セキュリティモデル",
  "understand.atGlance991Sub": "楽観実行 + 裁定パス",
  "understand.atGlancePqcTitle": "ポスト量子",
  "understand.atGlancePqcSub": "ハイブリッド対応の認可",
  "understand.atGlanceEdgeTitle": "エッジコンピュート",
  "understand.atGlanceEdgeSub": "ローカル推論 + 検証可能レシート",
  "understand.sectionComputeKicker": "TET（Compute Index）",
  "understand.sectionComputeTitle": "計上されるコンピュートの単位",
  "understand.sectionComputeP1":
    "TETはネットワークがコンピュートを計上するための単位です。APIキーや中央のクォータではなく、リクエスト単位の署名とnonceで認可し、リプレイを防ぎます。",
  "understand.sectionComputeP2":
    "署名済みリクエストは、（prompt / nonce / model / policy など）具体的な入力に意思を結びつけます。これにより、中央のゲートキーパーなしで、計測・帰属・監査の土台ができます。",
  "understand.section991Kicker": "99/1 Efficiency Model",
  "understand.section991Title": "高速パス + 裁定パス",
  "understand.section991P1":
    "ほとんどの時間は高速パス（99）で動きます。署名・nonce・ポリシーのチェックを満たす限り、結果は素早く受理されます。",
  "understand.section991P2":
    "残りの（1）は執行層です。結果が争われたときだけ、公開ルールに対して実行を証明/否定できるZK Courtへエスカレーションします。",
  "understand.sectionWhyKicker": "なぜ重要か",
  "understand.sectionWhyTitle": "なぜ100%冗長実行ではなく99/1なのか",
  "understand.sectionWhyP1":
    "BitcoinやEthereumは、全参加者が同じ状態遷移を再実行/再検証する設計です。支払いには強い一方、AI推論のようなワークロードには現実的ではありません。",
  "understand.sectionWhyP2":
    "TET Networkは99/1を採用します。通常はインフラ速度、例外時のみZK Courtで執行します。高速性を保ちながら、公開ルールによる強制力を確保します。",
  "understand.sectionPqcKicker": "ML-DSA-44 Quantum Resistance",
  "understand.sectionPqcTitle": "認可のためのポスト量子ID",
  "understand.sectionPqcP1":
    "TETは認可の署名プリミティブとしてML-DSA-44を用います。鍵は端末内で生成され外部へ出ません。送信されるのは署名と公開鍵だけです。",
  "understand.sectionPqcP2":
    "ハイブリッドでは、同一メッセージに古典署名とML-DSA-44署名の両方を要求できます。どちらか片方だけが破られても偽造できません。",
  "understand.nextTitle": "次に：Workerノードを動かす",
  "understand.nextBody": "オペレーター参加は明示的でローカルファーストです。OSはあなたの端末上のエンジン到達性のみを確認します。",
  "understand.nextCta": "TET OSを開く",
  "understand.nextTip": "ヒント：黄色は主要アクションと、ダーク面のグロー表現に限定します。",
  "understand.whyTitle": "なぜTETか？",
  "understand.whySub": "現実のAI利用のために設計：プライバシー、監査可能性、インフラ級のレイテンシ。",
  "understand.whyAudienceUsersTitle": "AIユーザー向け",
  "understand.whyAudienceUsersSub": "サブスクやロックインに頼らない、プライバシーファーストのコンピュート。",
  "understand.whyUsersP1": "可能な限りローカル推論。promptやデータはデフォルトで端末内に留まります。",
  "understand.whyUsersP2": "月額$20のサブスク不要。pay-per-compute は明示的で監査可能、実利用に整合します。",
  "understand.whyUsersP3": "ローカル実行は検閲されません。中央集権ベンダーのポリシーではなく、あなたの端末設定が優先されます。",
  "understand.whyAudienceBizTitle": "AIビルダー / 事業者向け",
  "understand.whyAudienceBizSub": "APIキーの負債をなくし、“何が実行されたか” を証明する。",
  "understand.whyBizP1": "中央集権APIキー露出ゼロ。認可は暗号学的で、リクエスト単位・nonceスコープです。",
  "understand.whyBizP2": "監査可能な実行：署名済みリクエストが意思の証跡を残し、争いはZK Courtへエスカレーションできます。",
  "understand.whyBizP3": "インフラ級レイテンシ：99/1で高速パスを維持しつつ、争いが起きたときの執行可能性を確保します。",

  "setup.headerTitle": "TETウォレットを作成",
  "setup.headerSub":
    "復元フレーズ（12単語）を書き留めてください。端末を失った場合、これが資産を復元する唯一の方法です。",
  "setup.homeLink": "ホーム",
  "setup.recoveryTitle": "復元フレーズ（12単語）",
  "setup.generating": "生成中…",
  "setup.step2Kicker": "ステップ2 — バックアップ確認",
  "setup.step2Body": "Master Passwordを設定する前に、12単語をバックアップしたことを確認してください。",
  "setup.step2Checkbox": "この12単語を安全にバックアップしました。",
  "setup.step3Kicker": "ステップ3 — Master Passwordを設定",
  "setup.step3Body": "Master Passwordは端末内でVaultを暗号化します。ネットワークへ送信されることはありません。",
  "setup.tosLabel":
    "利用規約に同意します。TETは投資対象ではなく、ユーティリティとしてのインフラトークンであることを理解しています。また、ノード運用のコンプライアンスは自己責任で行います。",
  "setup.tosDocTitle": "利用規約（重要条項）",
  "setup.tosDocPreamble":
    "以下は、利用規約の中でも特に重要な条項を明確化のために抜粋したものです。TET OSおよびネットワークを利用することで、これらに同意したものとみなされます。",
  "setup.tos1_1Title": "1.1 インフラ提供者としての位置づけ",
  "setup.tos1_1Body":
    "TET Networkは分散型のインフラ提供者としてのみ機能します。通信事業者やクラウドホスティング（例：AWS）と同様に、グリッド上で処理されるデータを作成・選別・監視しません。",
  "setup.tos1_2Title": "1.2 ユーザー生成コンテンツと責任",
  "setup.tos1_2Body":
    "AIのプロンプト、入力、生成出力はすべてユーザー（BuilderおよびWorker）の責任です。TET Foundation（または現時点の関連主体）は、ネットワークの計算資源を用いて生成された違法・権利侵害・有害なコンテンツについて一切の責任を負いません。",
  "setup.tos1_3Title": "1.3 補償（Indemnification）",
  "setup.tos1_3Body":
    "ユーザーは、著作権侵害や各地域法令違反を含む（ただしこれに限られない）ネットワーク利用に起因する請求、損害、責任から、TET Networkを補償し、免責することに同意します。",
  "setup.tos1_4Title": "1.4 監視義務なし・現状有姿（As-Is）",
  "setup.tos1_4Body":
    "ネットワークが分散型であるため、TETはリアルタイム推論を監視できず、また監視しません。ユーザーは、本ネットワークが「現状有姿」かつ「提供可能な範囲」で提供され、自己責任で利用する資源であることを承認します。",
  "setup.tosRequiredErr": "続行するには利用規約へ同意してください。",
  "setup.pinPlaceholder": "••••••",
  "setup.createBtn": "暗号化してVaultを作成",
  "setup.working": "処理中…",
  "setup.footerNote":
    "ノンカストディアル：鍵は端末外へ出ません。復元フレーズを失うと資産は永久にロックされます。Vaultはブラウザストレージの tet.vault.v1 に保存されます。",
  "setup.errPrefix": "セットアップ失敗：",
  "setup.errBackup": "復元フレーズ（12単語）をバックアップしたことを確認してください。",
  "setup.errPhraseNotReady": "復元フレーズの準備ができていません。少し待ってください。",
  "setup.errPqcNotReady": "PQCモジュールの準備ができていません",
  "setup.errPinFormat": "Master Passwordは8文字以上で入力してください。",

};

export const translations: Record<Lang, Record<TKey, string>> = { en, jp };

