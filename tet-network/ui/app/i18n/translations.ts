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
  | "home.tagline"
  | "home.genesisBadge"
  | "home.heroTitle"
  | "home.heroSub"
  | "hero.elevatorPitch"
  | "home.noBrowserCommands"
  | "home.pillarsTitle"
  | "home.pillar991Title"
  | "home.pillar991Body"
  | "home.pillarEdgeTitle"
  | "home.pillarEdgeBody"
  | "home.pillarPqcTitle"
  | "home.pillarPqcBody"
  | "home.foundationTitle"
  | "home.foundationBody"
  | "home.featureThermoKicker"
  | "home.featureThermoTitle"
  | "home.featureThermoBody"
  | "home.feature991Kicker"
  | "home.feature991Title"
  | "home.feature991Body"
  | "home.featureQuantumKicker"
  | "home.featureQuantumTitle"
  | "home.featureQuantumBody"
  | "home.ctaTitle"
  | "home.ctaBody"
  | "home.ctaTip"
  | "home.philoKicker"
  | "home.philoTitle"
  // participate
  | "participate.title"
  | "participate.sub"
  // docs portal (participate)
  | "docs.sidebarTitle"
  | "docs.onThisPage"
  | "docs.navBuilders"
  | "docs.navGrid"
  | "docs.navWorkers"
  | "docs.manual.gridP1"
  | "docs.manual.workersP1"
  | "docs.manual.workersPrereqTitle"
  | "docs.manual.workersPrereqBody"
  | "docs.manual.workersRunTitle"
  | "docs.manual.workersRunBody"
  | "docs.manual.workersConnectTitle"
  | "docs.manual.workersConnectBody"
  | "docs.manual.buildersP1"
  | "docs.manual.buildersStep1Title"
  | "docs.manual.buildersStep1Body"
  | "docs.manual.buildersStep2Title"
  | "docs.manual.buildersStep2Body"
  | "docs.manual.buildersStep3Title"
  | "docs.manual.buildersStep3Body"
  | "docs.catGettingStarted"
  | "docs.catArchitecture"
  | "docs.catDevGuides"
  | "docs.catOpGuides"
  | "docs.catReference"
  | "docs.itemWelcome"
  | "docs.itemIntroduction"
  | "docs.itemDecentralizedGrid"
  | "docs.item991"
  | "docs.itemSignatures"
  | "docs.itemNonceApi"
  | "docs.itemRunningOllama"
  | "docs.itemNodeSetup"
  | "docs.itemEd25519"
  | "docs.itemMldsa"
  | "docs.welcomeTitle"
  | "docs.welcomeSubtitle"
  | "docs.p1"
  | "docs.p2"
  | "docs.tocTitle"
  | "docs.stub"
  | "participate.operatorsKicker"
  | "participate.operatorsTitle"
  | "participate.operatorsBody1"
  | "participate.operatorsBody2a"
  | "participate.operatorsBody2b"
  | "participate.buildersKicker"
  | "participate.buildersTitle"
  | "participate.buildersIntro"
  | "participate.workflowTitle"
  | "participate.step1Title"
  | "participate.step1Body"
  | "participate.step2Title"
  | "participate.step2Body"
  | "participate.step3Title"
  | "participate.step3Body"
  | "participate.whyTitle"
  | "participate.whyBody"
  | "participate.closingKicker"
  | "participate.closingTitle"
  | "participate.closingBody1"
  | "participate.closingBody2"
  | "participate.workerTitle"
  | "participate.workerSub"
  | "participate.workerHowTitle"
  | "participate.workerHowBody"
  | "participate.workerMiningTitle"
  | "participate.workerMiningBody"
  | "participate.workerCtaOs"
  | "participate.workerCtaUnderstand"
  | "participate.opsTitle"
  | "participate.opsSub"
  | "participate.opsBody1"
  | "participate.opsBody2"
  | "participate.buildersTitle2"
  | "participate.buildersSub2"
  | "participate.buildersStepA"
  | "participate.buildersStepB"
  | "participate.buildersStepC"
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
  | "os.unlockTitle"
  | "os.unlockSub"
  | "os.unlockBtn"
  | "os.backHome"
  | "os.noVaultTitle"
  | "os.noVaultSub"
  | "os.noVaultBtn"
  | "os.noVaultExplain"
  | "os.tabVault"
  | "os.tabAi"
  | "os.tabWorkers"
  | "os.tabMarket"
  | "os.tabExplorer"
  | "os.ollamaChecking"
  | "os.ollamaConnected"
  | "os.ollamaNotFound"
  | "os.lock"
  | "os.core"
  | "os.wallet"
  | "os.send"
  | "os.working"
  | "os.sendTetTitle"
  | "os.sendTetSub"
  | "os.sendTetBtn"
  | "os.sending"
  | "os.txHistoryTitle"
  | "os.txHistorySub"
  | "os.txHistoryEmpty"
  | "os.errInvalidPin"
  | "os.aiTitle"
  | "os.aiSub"
  | "os.aiPlaceholder"
  | "os.aiSend"
  | "os.aiSystemNonceSigInfer"
  | "os.playgroundBalanceLine"
  | "os.genesisGrantActive"
  | "os.founderNodeBadge"
  | "os.aiRoleYou"
  | "os.aiRoleWorker"
  | "os.aiRoleSystem"
  | "os.auditTitle"
  | "os.auditSub"
  | "os.auditEmpty"
  | "os.protocolIndexTitle"
  | "os.protocolIndexSub"
  | "os.walletIdTitle"
  | "os.walletIdSub"
  | "os.marketUnavailable"
  | "os.workerSetupTitle"
  | "os.workerSetupSub"
  | "os.workerSetupBody"
  | "os.downloadOllama"
  | "os.statusChecking"
  | "os.statusConnected"
  | "os.statusAwaiting"
  | "os.statusDash"
  | "os.endpointLabel"
  | "os.copy"
  | "os.copied"
  | "os.operationalNotesTitle"
  | "os.operationalNotesSub"
  | "os.operationalWhy"
  | "os.operationalWhyBody"
  | "os.actionTitle"
  | "os.actionSub"
  | "os.startEarning"
  | "os.heartbeatTitle"
  | "os.heartbeatBody"
  | "os.dashboardTitle"
  | "os.dashboardSub"
  | "os.unlockToViewEarnings"
  | "os.marketTitle"
  | "os.marketSub"
  | "os.marketNoticeTitle"
  | "os.marketNoticeBody"
  | "os.marketIndexUnavailable"
  | "os.claimTitle"
  | "os.claimBtnClaiming"
  | "os.claimBtnClaim"
  | "os.claimBtnDisabled"
  | "os.claimUses"
  | "os.supplyTitle"
  | "os.supplySub"
  | "os.explorerTitle"
  | "os.explorerSub"
  | "os.loadingTitle"
  | "os.loadingSub"
  | "os.tabDashboard"
  | "os.dash.title"
  | "os.dash.sub"
  | "os.dash.walletTitle"
  | "os.dash.walletSub"
  | "os.dash.balanceLabel"
  | "os.dash.sessionEarningsLabel"
  | "os.dash.nodeTitle"
  | "os.dash.nodeSub"
  | "os.dash.nodeConnected"
  | "os.dash.nodeDisconnected"
  | "os.dash.nodeHowBtn"
  | "os.dash.playTitle"
  | "os.dash.playSub"
  | "os.dash.playBtn"
  | "os.dash.activityTitle"
  | "os.dash.activitySub"
  | "os.dash.activityEmpty"
  | "os.worker.statusTitle"
  | "os.worker.sessionEarnings"
  | "os.play.placeholder"
  | "os.play.sendRequest"
  | "os.wallet.tableDate"
  | "os.wallet.tableAction"
  | "os.wallet.tableStatus"
  | "os.wallet.viewDetails"
  | "os.wallet.hideDetails"
  | "os.walletIdLabel"
  | "os.copyId"
  | "os.copiedShort"
  | "os.earningStart"
  | "os.earningStop"
  | "os.earningLive";

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

  "home.tagline": "Cryptographically Signed • Mathematically Proven • 100% Self-Sovereign",
  "home.genesisBadge": "Genesis Epoch Active: Initial compute allocation for the first 10,000 edge nodes.",
  "home.heroTitle": "Liberating AI from the Giant Clouds.",
  "home.heroSub":
    "A global peer-to-peer AI grid for edge inference. Provide compute to earn, or pay to use it. No central servers. No corporate data harvesting.",
  "hero.elevatorPitch":
    "TET Network is a decentralized grid connecting personal devices worldwide to process AI. No central servers, no corporate data harvesting. Provide compute to earn, or pay to use it. Just pure, uncompromised intelligence.",
  "home.noBrowserCommands": "No browser commands. No silent installs. Everything is explicit and auditable by design.",
  "home.pillarsTitle": "Built different",
  "home.pillar991Title": "Decentralized AI Grid",
  "home.pillar991Body":
    "Break free from centralized tech giants. A global peer-to-peer network of edge devices processing AI inference at lightspeed.",
  "home.pillarEdgeTitle": "Verifiable Execution",
  "home.pillarEdgeBody":
    "No more black boxes. Every response is signed and auditable. If disputed, the ZK Court resolves it with mathematical certainty.",
  "home.pillarPqcTitle": "Quantum-Resistant Privacy",
  "home.pillarPqcBody":
    "Your prompts and data never sit on a vulnerable central server. Secured by ML-DSA-44 and designed for what comes next.",
  "home.foundationTitle": "Compute you can trust",
  "home.foundationBody":
    "Instead of centralized API keys, TET binds authorization to signed messages, nonces, and public rules. The result is infrastructure that is fast in the common case, and enforceable when disputed.",
  "home.featureThermoKicker": "Thermodynamic reality",
  "home.featureThermoTitle": "Compute priced by energy",
  "home.featureThermoBody": "Costs track physical reality, not opaque margin stacks or confusing billing tiers.",
  "home.feature991Kicker": "99/1 efficiency",
  "home.feature991Title": "Speed that holds up",
  "home.feature991Body": "Optimistic execution on the fast path, with a dispute path for adjudication.",
  "home.featureQuantumKicker": "Quantum-aware",
  "home.featureQuantumTitle": "Hybrid-ready signatures",
  "home.featureQuantumBody": "Authorization remains auditable as cryptographic assumptions evolve.",
  "home.ctaTitle": "Start with a vault",
  "home.ctaBody": "Create a wallet locally, verify your setup, and connect a Worker node when you’re ready.",
  "home.ctaTip": "Read how it works in Understand TET.",
  "home.philoKicker": "Core principles",
  "home.philoTitle": "Built for the next era of intelligence.",

  "participate.title": "Participate in the Grid",
  "participate.sub": "A practical manual for builders and operators. Run local inference, connect to the grid, and build compute-verifiable applications.",
  "docs.sidebarTitle": "Documentation",
  "docs.onThisPage": "On this page",
  "docs.navBuilders": "Builders",
  "docs.navGrid": "The TET Grid",
  "docs.navWorkers": "For Workers",
  "docs.manual.gridP1":
    "TET Network is a marketplace for verifiable compute. Workers provide inference on real hardware. Builders authorize requests cryptographically and pay for compute. The protocol binds intent to signed messages so that execution can be audited and, if necessary, enforced.",
  "docs.manual.workersP1":
    "Workers (node operators) earn TET by providing local inference and returning a valid cryptographic receipt. Earnings occur only when work is executed and accepted under the network’s rules.",
  "docs.manual.workersPrereqTitle": "Prerequisites (Local Hardware)",
  "docs.manual.workersPrereqBody":
    "You need a machine capable of running local inference. In practice, this means a modern CPU and sufficient memory. A GPU can improve throughput but is not required for getting started.",
  "docs.manual.workersRunTitle": "Running Ollama (ollama serve)",
  "docs.manual.workersRunBody":
    "Install Ollama and start the local engine. TET OS checks for reachability on your machine; it does not attempt to run commands on your behalf.",
  "docs.manual.workersConnectTitle": "Connecting to TET OS",
  "docs.manual.workersConnectBody":
    "Open TET OS and navigate to the Worker Node section. When the engine is reachable, you can enable earning. Keep the process running while you intend to provide compute.",
  "docs.manual.buildersP1":
    "Builders consume the network by authorizing each request with signatures instead of centralized API keys. The network uses a nonce to prevent replay and to bind requests to an auditable flow.",
  "docs.manual.buildersStep1Title": "1. Request a Nonce",
  "docs.manual.buildersStep1Body": "Request a nonce bound to your wallet ID.",
  "docs.manual.buildersStep2Title": "2. Sign the Payload (Ed25519)",
  "docs.manual.buildersStep2Body": "Sign prompt + nonce using Ed25519 and base64 encode the signature.",
  "docs.manual.buildersStep3Title": "3. Send to Edge",
  "docs.manual.buildersStep3Body": "Submit the signed request to the edge inference endpoint.",
  "docs.catGettingStarted": "Getting Started",
  "docs.catArchitecture": "Architecture",
  "docs.catDevGuides": "Developer Guides",
  "docs.catOpGuides": "Operator Guides",
  "docs.catReference": "Reference",
  "docs.itemWelcome": "Welcome",
  "docs.itemIntroduction": "Introduction",
  "docs.itemDecentralizedGrid": "Decentralized Grid",
  "docs.item991": "99/1 Model",
  "docs.itemSignatures": "Cryptographic Signatures",
  "docs.itemNonceApi": "Nonce & API",
  "docs.itemRunningOllama": "Running Ollama",
  "docs.itemNodeSetup": "Node Setup",
  "docs.itemEd25519": "Ed25519",
  "docs.itemMldsa": "ML-DSA-44",
  "docs.welcomeTitle": "Welcome to TET Network",
  "docs.welcomeSubtitle": "Learn TET and start building decentralized AI applications.",
  "docs.p1":
    "This documentation provides the information you need to understand the TET Network and start building compute-verifiable applications. To make the best use of this guide, make sure you are running a local node (Ollama).",
  "docs.p2":
    "For technical support, join the TET Developer forum. For errors related to this documentation, please open an issue on GitHub.",
  "docs.tocTitle": "Table of Contents",
  "docs.stub": "This section will be expanded in the next revision.",
  "participate.operatorsKicker": "Operators",
  "participate.operatorsTitle": "Run local AI (Llama 3) and serve work",
  "participate.operatorsBody1":
    "The operator path starts with local inference. Worker tooling expects a local Ollama daemon reachable at http://localhost:11434.",
  "participate.operatorsBody2a": "Once reachable, open",
  "participate.operatorsBody2b": "and go to Worker Nodes. The connection guard blocks Worker mode until Ollama is detected.",
  "participate.buildersKicker": "For Builders",
  "participate.buildersTitle": "Submit signed AI prompts (no centralized API keys)",
  "participate.buildersIntro":
    "No more API keys to leak. No more monthly subscriptions. Just cryptographically signed, pay-per-compute AI with replay resistance built in.",
  "participate.workflowTitle": "Workflow",
  "participate.step1Title": "Request a nonce",
  "participate.step1Body": "Fetch a one-time nonce bound to your wallet ID.",
  "participate.step2Title": "Create a signature",
  "participate.step2Body": "Sign prompt + nonce using Ed25519, then encode the signature as base64.",
  "participate.step3Title": "Submit the signed request",
  "participate.step3Body": "Send the prompt, nonce, and signature to the inference endpoint.",
  "participate.whyTitle": "Why this works",
  "participate.whyBody":
    "No centralized API keys. Authorization is cryptographic, per-request, and auditable. The nonce makes every request unique, preventing replay—even if a message is observed.",
  "participate.closingKicker": "Earning TET",
  "participate.closingTitle": "Rewards flow from verified work",
  "participate.closingBody1":
    "Operators earn TET when work is accepted under the public rules. The OS surfaces earnings by reading ordered transfer events for your wallet ID.",
  "participate.closingBody2":
    "Keep your vault non-custodial: the device holds private keys; the network receives signatures and proofs only.",
  "participate.workerTitle": "Run a Worker Node",
  "participate.workerSub":
    "Operate local inference, connect to the TET Grid, and earn TET by verifying compute tasks.",
  "participate.workerHowTitle": "What you run",
  "participate.workerHowBody":
    "Run Ollama locally (Llama 3), keep execution close to the edge, and expose a reachable local engine for TET OS to detect.",
  "participate.workerMiningTitle": "The “mining” equivalent",
  "participate.workerMiningBody":
    "Instead of hashing, you provide real inference. Rewards flow to operators who serve verified compute under public rules.",
  "participate.workerCtaOs": "Open TET OS",
  "participate.workerCtaUnderstand": "Understand how it works",
  "participate.opsTitle": "For Operators (The Miners)",
  "participate.opsSub": "Run local inference. Connect your machine. Earn TET for verified compute.",
  "participate.opsBody1":
    "Operators keep the grid real. You run Ollama locally and expose a reachable engine that TET OS can detect.",
  "participate.opsBody2":
    "Once connected, the Worker Node page flips from waiting to live. Your device can start serving requests and collecting session earnings.",
  "participate.buildersTitle2": "For Builders (The Engineers)",
  "participate.buildersSub2": "Build apps that spend TET to use the grid. Operators earn. Builders consume.",
  "participate.buildersStepA": "Request a nonce bound to your wallet ID.",
  "participate.buildersStepB": "Sign prompt + nonce using Ed25519 and base64 encode the signature.",
  "participate.buildersStepC": "Submit the signed request to the inference endpoint.",

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

  "os.unlockTitle": "Unlock Vault",
  "os.unlockSub": "Enter your Master Password to unlock the session wallet.",
  "os.unlockBtn": "Unlock",
  "os.backHome": "Back to Home",
  "os.noVaultTitle": "No Vault Found",
  "os.noVaultSub": "We couldn't find a TET vault on this device. Please create a new wallet.",
  "os.noVaultBtn": "Go to Create Wallet",
  "os.noVaultExplain": "This screen appears when tet.vault.v1 is missing from localStorage.",
  "os.tabVault": "Vault",
  "os.tabAi": "AI Playground",
  "os.tabWorkers": "Worker Nodes",
  "os.tabMarket": "Market / Legal",
  "os.tabExplorer": "Explorer",
  "os.ollamaChecking": "checking…",
  "os.ollamaConnected": "connected",
  "os.ollamaNotFound": "not found",
  "os.lock": "Logout",
  "os.core": "Core",
  "os.wallet": "Wallet",
  "os.send": "Send",
  "os.working": "Working…",
  "os.sendTetTitle": "Send TET",
  "os.sendTetSub": "Transfer UI (wiring to signed transfer endpoint next)",
  "os.sendTetBtn": "Send TET (Hybrid Signed)",
  "os.sending": "Sending…",
  "os.txHistoryTitle": "Transaction History",
  "os.txHistorySub": "Fetched from TET-Core audit log (ordered, append-only).",
  "os.txHistoryEmpty": "No events yet for this wallet.",
  "os.errInvalidPin": "Invalid Master Password (or vault corrupted).",
  "os.aiTitle": "AI Playground",
  "os.aiSub": "Signed chat: prompt + nonce → Ed25519 → /ai/infer_signed",
  "os.aiPlaceholder": "Ask the network… (Ctrl/⌘ + Enter)",
  "os.aiSend": "Send",
  "os.aiSystemNonceSigInfer": "Nonce → Signature → Inference…",
  "os.playgroundBalanceLine": "Balance: 50,000.00 TET | 10,000 Stevemon",
  "os.genesisGrantActive": "Genesis Grant Active",
  "os.founderNodeBadge": "Founder Node (Wallet #1)",
  "os.aiRoleYou": "You",
  "os.aiRoleWorker": "Worker",
  "os.aiRoleSystem": "System",
  "os.auditTitle": "Cryptography / Audit Log",
  "os.auditSub": "Nonce + signature + receipt artifacts",
  "os.auditEmpty": "No events yet.",
  "os.protocolIndexTitle": "Protocol Index",
  "os.protocolIndexSub": "Reference metrics are served by TET-Core.",
  "os.walletIdTitle": "Wallet ID",
  "os.walletIdSub": "Ed25519 pubkey hex (64 chars)",
  "os.marketUnavailable": "Market index unavailable.",
  "os.workerSetupTitle": "Worker Node Setup",
  "os.workerSetupSub": "Connect the Ollama engine",
  "os.workerSetupBody": "To earn TET, your device must run local AI inference. Connect the Ollama engine.",
  "os.downloadOllama": "Download Ollama",
  "os.statusChecking": "Status: Checking…",
  "os.statusConnected": "Status: Ollama Connected",
  "os.statusAwaiting": "Status: Awaiting local engine…",
  "os.statusDash": "Status: —",
  "os.endpointLabel": "Endpoint",
  "os.copy": "Copy",
  "os.copied": "Copied!",
  "os.operationalNotesTitle": "Operational Notes",
  "os.operationalNotesSub": "Security + compliance",
  "os.operationalWhy": "Why this is required",
  "os.operationalWhyBody":
    "Worker Nodes run local inference to generate receipts. The OS only checks reachability of localhost:11434.",
  "os.actionTitle": "Action",
  "os.actionSub": "Start earning by operating a Worker Node.",
  "os.startEarning": "Start Earning",
  "os.heartbeatTitle": "Heartbeat",
  "os.heartbeatBody": "LIVE reflects operator intent; earnings are derived from ledger transfers to your wallet.",
  "os.dashboardTitle": "Real-time Dashboard",
  "os.dashboardSub": "Session earnings derived from Explorer feed.",
  "os.unlockToViewEarnings": "Unlock vault to view earnings.",
  "os.marketTitle": "Market / Legal",
  "os.marketSub": "Strict disclaimer",
  "os.marketNoticeTitle": "Notice",
  "os.marketNoticeBody":
    "TET is a pure utility token strictly for accessing AI compute on the TET Network. We make NO promises of future value, secondary market listings (exchanges), or fiat conversion. Any external markets that may emerge are entirely independent of TET Network. All participation is at your own risk.",
  "os.marketIndexUnavailable": "Market index unavailable.",
  "os.claimTitle": "Claim Genesis Airdrop",
  "os.claimBtnClaiming": "Claiming…",
  "os.claimBtnClaim": "Claim Genesis Airdrop (Hybrid Signed)",
  "os.claimBtnDisabled": "Claim Disabled",
  "os.claimUses": "Uses: POST /genesis/1000/claim with Ed25519 + ML-DSA-44.",
  "os.supplyTitle": "Supply & Tokenomics",
  "os.supplySub": "Hard cap + founder/workers/ecosystem split",
  "os.explorerTitle": "Explorer",
  "os.explorerSub": "Every transfer and protocol event (audit log, ordered).",
  "os.loadingTitle": "Loading TET OS",
  "os.loadingSub": "Initializing secure session…",
  "os.tabDashboard": "Dashboard",
  "os.dash.title": "Dashboard",
  "os.dash.sub": "Start here. Identity, node readiness, and quick actions.",
  "os.dash.walletTitle": "Wallet & Identity",
  "os.dash.walletSub": "Your on-device identity for signed compute.",
  "os.dash.balanceLabel": "Balance",
  "os.dash.sessionEarningsLabel": "Session earnings",
  "os.dash.nodeTitle": "Node Status",
  "os.dash.nodeSub": "Connect Ollama to run Worker tasks locally.",
  "os.dash.nodeConnected": "Ollama Connected",
  "os.dash.nodeDisconnected": "Awaiting local engine",
  "os.dash.nodeHowBtn": "How to connect",
  "os.dash.playTitle": "Playground",
  "os.dash.playSub": "Send a signed AI request.",
  "os.dash.playBtn": "Open AI Playground",
  "os.dash.activityTitle": "Recent activity",
  "os.dash.activitySub": "Latest protocol events for this wallet.",
  "os.dash.activityEmpty": "No activity yet.",
  "os.worker.statusTitle": "Worker Node Status",
  "os.worker.sessionEarnings": "Session Earnings",
  "os.play.placeholder": "Enter a prompt to test the decentralized grid...",
  "os.play.sendRequest": "Send Request",
  "os.wallet.tableDate": "Date",
  "os.wallet.tableAction": "Action",
  "os.wallet.tableStatus": "Status",
  "os.wallet.viewDetails": "View Details",
  "os.wallet.hideDetails": "Hide Details",
  "os.walletIdLabel": "Wallet ID",
  "os.copyId": "Copy",
  "os.copiedShort": "Copied!",
  "os.earningStart": "Start Earning",
  "os.earningStop": "Stop Earning",
  "os.earningLive": "Status LIVE  Providing Compute",
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

  "home.tagline": "暗号による署名 • 数学による証明 • 完全な自己主権",
  "home.genesisBadge": "Genesis Epoch 稼働中: 初期10,000エッジノードに計算リソースを特別割り当て",
  "home.heroTitle": "AIを、巨大企業のクラウドから解放する。",
  "home.heroSub":
    "世界中のデバイスを繋ぐ、エッジ推論のためのP2P AIグリッド。計算力を提供して稼ぐか、支払って利用するか。中央サーバーも、データの搾取も存在しません。",
  "hero.elevatorPitch":
    "TET Networkは、世界中のデバイスを繋いでAIを処理する分散型グリッドです。巨大なサーバーも、企業によるデータの搾取もありません。計算力を提供して報酬を得るか、支払って利用するか。そこにあるのは、誰にも支配されない純粋な知性だけです。",
  "home.noBrowserCommands": "ブラウザからコマンド実行はしません。サイレント導入もありません。すべては明示的で、監査可能です。",
  "home.pillarsTitle": "思想と設計",
  "home.pillar991Title": "分散AIグリッド",
  "home.pillar991Body": "中央集権的な巨大企業からの脱却。世界中のデバイスが繋がるP2PのAI推論グリッドが、光速級の体験を実現します。",
  "home.pillarEdgeTitle": "検証可能な実行",
  "home.pillarEdgeBody": "ブラックボックスは終わり。すべての応答は署名され監査可能。争いが起きればZK Courtが数学的確実性で解決します。",
  "home.pillarPqcTitle": "量子耐性プライバシー",
  "home.pillarPqcBody": "あなたのpromptとデータは脆弱な中央サーバーに置かれません。ML-DSA-44で未来まで守ります。",
  "home.foundationTitle": "信じなくていいコンピュート",
  "home.foundationBody":
    "中央集権APIキーではなく、署名・nonce・公開ルールにより認可を成立させます。通常は高速、争いが起きたときは強制力を持って執行できます。",
  "home.featureThermoKicker": "物理に根ざす",
  "home.featureThermoTitle": "エネルギーで価格付けされるコンピュート",
  "home.featureThermoBody": "不透明なマージン階層ではなく、物理コストに沿った設計です。",
  "home.feature991Kicker": "99/1（速度）",
  "home.feature991Title": "速さと強さを両立",
  "home.feature991Body": "高速パスを維持しつつ、争いが起きた場合は裁定パスで検証・執行します。",
  "home.featureQuantumKicker": "量子を前提に",
  "home.featureQuantumTitle": "ハイブリッド対応の署名",
  "home.featureQuantumBody": "暗号前提が変わっても、認可は監査可能な形で維持されます。",
  "home.ctaTitle": "まずはVaultを作成",
  "home.ctaBody": "端末内でウォレットを作成し、セットアップを検証してからWorkerノードへ接続できます。",
  "home.ctaTip": "仕組みは「TETを理解する」で確認できます。",
  "home.philoKicker": "思想と設計",
  "home.philoTitle": "これからのAIに求められる 3つの絶対条件。",

  "participate.title": "グリッドに参加する",
  "participate.sub": "開発者とオペレーターのための実務マニュアル。ローカル推論を稼働し、グリッドへ接続し、検証可能なコンピュート・アプリを構築します。",
  "docs.sidebarTitle": "ドキュメント",
  "docs.onThisPage": "このページの内容",
  "docs.navBuilders": "Builders",
  "docs.navGrid": "The TET Grid",
  "docs.navWorkers": "For Workers",
  "docs.manual.gridP1":
    "TET Networkは検証可能コンピュートの市場です。Workersは実ハードウェアで推論を提供し、Buildersは署名でリクエストを認可してコンピュートを消費します。プロトコルは署名済みメッセージへ意思を結びつけ、監査と執行を可能にします。",
  "docs.manual.workersP1":
    "Workers（ノード運用者）はローカル推論を提供し、暗号学的に妥当なレシートを返すことでTETを獲得します。仕事が実行され、公開ルールの下で受理されたときにのみ獲得が成立します。",
  "docs.manual.workersPrereqTitle": "前提（ローカルハードウェア）",
  "docs.manual.workersPrereqBody":
    "ローカル推論を動かせる端末が必要です。実務的には、現代的なCPUと十分なメモリがあれば開始できます。GPUはスループット向上に有効ですが必須ではありません。",
  "docs.manual.workersRunTitle": "Ollamaを起動（ollama serve）",
  "docs.manual.workersRunBody":
    "Ollamaをインストールし、ローカルエンジンを起動します。TET OSは端末上の到達性のみを確認し、ブラウザからコマンドを実行することはありません。",
  "docs.manual.workersConnectTitle": "TET OSへ接続",
  "docs.manual.workersConnectBody":
    "TET OSを開き、Worker Nodeへ移動します。エンジンが到達可能になれば獲得を有効化できます。計算力を提供する間はプロセスを稼働させてください。",
  "docs.manual.buildersP1":
    "Buildersは中央APIキーではなく署名で各リクエストを認可してネットワークを利用します。nonceを用いることでリプレイを防ぎ、監査可能なフローに紐づけます。",
  "docs.manual.buildersStep1Title": "1. Nonceを取得",
  "docs.manual.buildersStep1Body": "wallet_idに紐づくnonceを取得します。",
  "docs.manual.buildersStep2Title": "2. 署名（Ed25519）",
  "docs.manual.buildersStep2Body": "Ed25519で prompt + nonce を署名し、署名をbase64へエンコードします。",
  "docs.manual.buildersStep3Title": "3. エッジへ送信",
  "docs.manual.buildersStep3Body": "署名付きリクエストをエッジ推論エンドポイントへ送ります。",
  "docs.catGettingStarted": "Getting Started",
  "docs.catArchitecture": "Architecture",
  "docs.catDevGuides": "Developer Guides",
  "docs.catOpGuides": "Operator Guides",
  "docs.catReference": "Reference",
  "docs.itemWelcome": "Welcome",
  "docs.itemIntroduction": "Introduction",
  "docs.itemDecentralizedGrid": "Decentralized Grid",
  "docs.item991": "99/1 Model",
  "docs.itemSignatures": "Cryptographic Signatures",
  "docs.itemNonceApi": "Nonce & API",
  "docs.itemRunningOllama": "Running Ollama",
  "docs.itemNodeSetup": "Node Setup",
  "docs.itemEd25519": "Ed25519",
  "docs.itemMldsa": "ML-DSA-44",
  "docs.welcomeTitle": "Welcome to TET Network",
  "docs.welcomeSubtitle": "TETを学び、分散AIアプリケーションの開発を始めましょう。",
  "docs.p1":
    "このドキュメントは、TET Networkを理解し、コンピュート検証可能なアプリケーションを構築するために必要な情報を提供します。このガイドを最大限活用するために、ローカルノード（Ollama）を稼働させておいてください。",
  "docs.p2":
    "技術サポートはTET Developerフォーラムへ。ドキュメントの誤りはGitHubでissueとして報告してください。",
  "docs.tocTitle": "目次",
  "docs.stub": "このセクションは次の改訂で拡充します。",
  "participate.operatorsKicker": "オペレーター",
  "participate.operatorsTitle": "ローカルAI（Llama 3）を動かして提供する",
  "participate.operatorsBody1":
    "オペレーターの第一歩はローカル推論です。Worker機能は http://localhost:11434 に到達可能なOllamaデーモンを前提とします。",
  "participate.operatorsBody2a": "到達可能になったら",
  "participate.operatorsBody2b": "を開き、Worker Nodesへ進んでください。Ollamaが検出されるまでWorkerモードはブロックされます。",
  "participate.buildersKicker": "開発者向け",
  "participate.buildersTitle": "署名付きAIリクエスト（中央集権APIキー不要）",
  "participate.buildersIntro":
    "漏れるAPIキーも、月額サブスクも終わり。暗号署名されたpay-per-compute AIで、リプレイ耐性も最初から組み込み済みです。",
  "participate.workflowTitle": "ワークフロー",
  "participate.step1Title": "nonceを取得",
  "participate.step1Body": "wallet_idに紐づくワンタイムnonceを取得します。",
  "participate.step2Title": "署名を作成",
  "participate.step2Body": "Ed25519で prompt + nonce を署名し、署名をbase64へエンコードします。",
  "participate.step3Title": "署名付きリクエストを送信",
  "participate.step3Body": "prompt / nonce / 署名を推論エンドポイントへ送ります。",
  "participate.whyTitle": "なぜ成立するか",
  "participate.whyBody":
    "中央集権APIキーは不要です。認可は暗号学的で、リクエスト単位で監査可能です。nonceにより各リクエストが一意になり、観測されてもリプレイできません。",
  "participate.closingKicker": "TETを獲得",
  "participate.closingTitle": "報酬は検証済みの仕事から流れます",
  "participate.closingBody1":
    "公開ルールのもとで仕事が受理されると、オペレーターはTETを獲得します。OSはあなたのwallet_idに対する転送イベントを読み取り、収益を表示します。",
  "participate.closingBody2":
    "Vaultはノンカストディアルです。秘密鍵は端末内に保持され、ネットワークへ送るのは署名と証明のみです。",
  "participate.workerTitle": "Worker Nodeを動かす",
  "participate.workerSub":
    "ローカル推論を稼働しTET Gridへ接続し、検証済みコンピュートタスクの提供でTETを獲得します。",
  "participate.workerHowTitle": "何を動かすのか",
  "participate.workerHowBody":
    "Ollama（Llama 3）をローカルで稼働させ、実行をエッジに近づけます。TET OSが検出できるよう、到達可能なローカルエンジンを提供します。",
  "participate.workerMiningTitle": "“マイニング”相当",
  "participate.workerMiningBody":
    "ハッシュ計算ではなく、実推論を提供します。公開ルールのもとで検証されたコンピュートを提供したオペレーターへ報酬が流れます。",
  "participate.workerCtaOs": "TET OSを開く",
  "participate.workerCtaUnderstand": "仕組みを理解する",
  "participate.opsTitle": "オペレーター向け（マイナー）",
  "participate.opsSub": "ローカル推論を動かし、端末を接続し、検証済みコンピュートでTETを獲得します。",
  "participate.opsBody1":
    "グリッドを現実にするのはオペレーターです。Ollamaをローカルで稼働させ、TET OSが検出できる到達可能なエンジンを用意します。",
  "participate.opsBody2":
    "接続できると、Worker Node画面は待機状態からLIVEへ切り替わります。端末はリクエストを処理し、セッション収益を積み上げられます。",
  "participate.buildersTitle2": "ビルダー向け（エンジニア）",
  "participate.buildersSub2": "TETを支払ってグリッドを利用するアプリを作ります。オペレーターが獲得し、ビルダーが消費します。",
  "participate.buildersStepA": "wallet_idに紐づくnonceを取得します。",
  "participate.buildersStepB": "Ed25519で prompt + nonce を署名し、署名をbase64へエンコードします。",
  "participate.buildersStepC": "署名付きリクエストを推論エンドポイントへ送ります。",

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

  "os.unlockTitle": "Vaultを解除",
  "os.unlockSub": "Master Passwordを入力してセッションウォレットを解除します。",
  "os.unlockBtn": "解除",
  "os.backHome": "ホームへ戻る",
  "os.noVaultTitle": "Vaultが見つかりません",
  "os.noVaultSub": "この端末にTET Vaultが見つかりません。新しいウォレットを作成してください。",
  "os.noVaultBtn": "ウォレット作成へ",
  "os.noVaultExplain": "localStorage に tet.vault.v1 が存在しない場合に表示されます。",
  "os.tabVault": "Vault",
  "os.tabAi": "AI Playground",
  "os.tabWorkers": "Worker Nodes",
  "os.tabMarket": "Market / Legal",
  "os.tabExplorer": "Explorer",
  "os.ollamaChecking": "確認中…",
  "os.ollamaConnected": "接続済み",
  "os.ollamaNotFound": "未検出",
  "os.lock": "ログアウト",
  "os.core": "Core",
  "os.wallet": "Wallet",
  "os.send": "送信",
  "os.working": "処理中…",
  "os.sendTetTitle": "TET送金",
  "os.sendTetSub": "送金UI（次に署名付き転送エンドポイントへ接続）",
  "os.sendTetBtn": "TET送金（ハイブリッド署名）",
  "os.sending": "送信中…",
  "os.txHistoryTitle": "取引履歴",
  "os.txHistorySub": "TET-Core監査ログから取得（順序付き・追記のみ）",
  "os.txHistoryEmpty": "このwallet_idのイベントはまだありません。",
  "os.errInvalidPin": "Master Passwordが無効です（またはVaultが破損しています）。",
  "os.aiTitle": "AI Playground",
  "os.aiSub": "署名付きチャット：prompt + nonce → Ed25519 → /ai/infer_signed",
  "os.aiPlaceholder": "ネットワークに質問…（Ctrl/⌘ + Enter）",
  "os.aiSend": "送信",
  "os.aiSystemNonceSigInfer": "Nonce → Signature → Inference…",
  "os.playgroundBalanceLine": "Balance: 50,000.00 TET | 10,000 Stevemon",
  "os.genesisGrantActive": "Genesisノード: 認証済み",
  "os.founderNodeBadge": "Founder Node（Wallet #1）",
  "os.aiRoleYou": "あなた",
  "os.aiRoleWorker": "Worker",
  "os.aiRoleSystem": "System",
  "os.auditTitle": "暗号 / 監査ログ",
  "os.auditSub": "nonce + 署名 + レシートのアーティファクト",
  "os.auditEmpty": "まだイベントはありません。",
  "os.protocolIndexTitle": "プロトコル指標",
  "os.protocolIndexSub": "参照メトリクスはTET-Coreが提供します。",
  "os.walletIdTitle": "Wallet ID",
  "os.walletIdSub": "Ed25519公開鍵hex（64文字）",
  "os.marketUnavailable": "マーケット指標を取得できません。",
  "os.workerSetupTitle": "Worker Node Setup",
  "os.workerSetupSub": "Ollamaエンジンへ接続",
  "os.workerSetupBody": "TETを獲得するには、端末でローカル推論を稼働させる必要があります。Ollamaエンジンへ接続してください。",
  "os.downloadOllama": "Ollamaをダウンロード",
  "os.statusChecking": "ステータス：確認中…",
  "os.statusConnected": "ステータス：Ollama 接続済み",
  "os.statusAwaiting": "ステータス：ローカルエンジン待機中…",
  "os.statusDash": "ステータス：—",
  "os.endpointLabel": "エンドポイント",
  "os.copy": "コピー",
  "os.copied": "コピーしました！",
  "os.operationalNotesTitle": "運用メモ",
  "os.operationalNotesSub": "セキュリティ + コンプライアンス",
  "os.operationalWhy": "なぜ必要か",
  "os.operationalWhyBody": "Worker Nodesはローカル推論でレシートを生成します。OSは localhost:11434 への到達性のみを確認します。",
  "os.actionTitle": "アクション",
  "os.actionSub": "Worker Node を稼働して獲得を開始します。",
  "os.startEarning": "獲得を開始",
  "os.heartbeatTitle": "ハートビート",
  "os.heartbeatBody": "LIVEはオペレーターの意図を示します。収益は台帳の転送イベントから算出されます。",
  "os.dashboardTitle": "リアルタイムダッシュボード",
  "os.dashboardSub": "Explorerフィードからセッション収益を算出",
  "os.unlockToViewEarnings": "収益を表示するにはVaultを解除してください。",
  "os.marketTitle": "Market / Legal",
  "os.marketSub": "重要な免責事項",
  "os.marketNoticeTitle": "注意",
  "os.marketNoticeBody":
    "TETはTET Network上のAIコンピュートへアクセスするための純粋なユーティリティトークンです。将来価値、上場、法定通貨への交換について一切保証しません。外部市場が生じてもTET Networkとは独立です。参加は自己責任です。",
  "os.marketIndexUnavailable": "マーケット指標を取得できません。",
  "os.claimTitle": "Genesis Airdrop を請求",
  "os.claimBtnClaiming": "請求中…",
  "os.claimBtnClaim": "Genesis Airdrop を請求（ハイブリッド署名）",
  "os.claimBtnDisabled": "請求できません",
  "os.claimUses": "使用：POST /genesis/1000/claim（Ed25519 + ML-DSA-44）",
  "os.supplyTitle": "Supply & Tokenomics",
  "os.supplySub": "ハードキャップ + 配分（創業/Workers/エコシステム）",
  "os.explorerTitle": "Explorer",
  "os.explorerSub": "すべての転送とプロトコルイベント（監査ログ、順序付き）",
  "os.loadingTitle": "TET OSを読み込み中",
  "os.loadingSub": "セキュアセッションを初期化しています…",
  "os.tabDashboard": "ダッシュボード",
  "os.dash.title": "ダッシュボード",
  "os.dash.sub": "ここから開始。ID、ノード準備状況、クイックアクション。",
  "os.dash.walletTitle": "Wallet & Identity",
  "os.dash.walletSub": "署名済みコンピュートのための端末内ID。",
  "os.dash.balanceLabel": "残高",
  "os.dash.sessionEarningsLabel": "セッション収益",
  "os.dash.nodeTitle": "ノード状態",
  "os.dash.nodeSub": "Ollamaを接続してWorkerタスクをローカル実行します。",
  "os.dash.nodeConnected": "Ollama 接続済み",
  "os.dash.nodeDisconnected": "ローカルエンジン待機中",
  "os.dash.nodeHowBtn": "接続方法",
  "os.dash.playTitle": "Playground",
  "os.dash.playSub": "署名付きAIリクエストを送信。",
  "os.dash.playBtn": "AI Playgroundを開く",
  "os.dash.activityTitle": "最近のアクティビティ",
  "os.dash.activitySub": "このwallet_idの最新プロトコルイベント。",
  "os.dash.activityEmpty": "まだアクティビティはありません。",
  "os.worker.statusTitle": "Worker Node Status",
  "os.worker.sessionEarnings": "セッション収益",
  "os.play.placeholder": "分散グリッドを試すためのpromptを入力…",
  "os.play.sendRequest": "リクエストを送信",
  "os.wallet.tableDate": "日付",
  "os.wallet.tableAction": "アクション",
  "os.wallet.tableStatus": "ステータス",
  "os.wallet.viewDetails": "詳細を見る",
  "os.wallet.hideDetails": "詳細を閉じる",
  "os.walletIdLabel": "Wallet ID",
  "os.copyId": "コピー",
  "os.copiedShort": "コピーしました",
  "os.earningStart": "獲得を開始",
  "os.earningStop": "獲得を停止",
  "os.earningLive": "LIVE  コンピュート提供中",
};

export const translations: Record<Lang, Record<TKey, string>> = { en, jp };

