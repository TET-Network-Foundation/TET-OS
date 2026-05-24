# TET NETWORK
## 流動的なP2P計算・エネルギーリソースプロトコル
## AIネイティブ・ソブリン・レイヤー1

**Version:** Genesis Draft v1.0  
**Date:** 2026-04-28  
**Author:** Steve  
**Title:** Founder-Architect, TET Network Project  
**Contact:** yizhenxianshi@gmail.com  

**Status:** Canonical whitepaper (repository root). Supersedes [`archive/WHITEPAPER_v0_economic.md`](archive/WHITEPAPER_v0_economic.md).  
**Manuscript:** [`GENESIS_V1.md`](GENESIS_V1.md) (identical body below).

---

## 1. Preamble

The current cloud infrastructure is not an immutable reality. It is a historical accident — a temporary monopoly of capital over human intelligence, sustained by switching costs and institutional inertia rather than technical superiority.

The contradiction is structural. AI, the most consequential technology of this era, runs almost entirely on compute resources owned by four corporations. Those corporations set the price of intelligence. This is not a market. It is a tollbooth.

TET Network is an architectural response to that structure. The central premise — *compute is energy* — is not new. What is new is the conclusion drawn from it: if compute and energy are interchangeable, then every device that consumes electricity is a potential mining node, an inference provider, and a participant in a sovereign computing grid. Traditional blockchains impose a single consensus rule on all participants. Forcing a smartphone to compete under the same rules as an A100 cluster is not decentralization — it is decentralization theater that produces the same capital-intensive oligopoly as before.

Context-Aware Adaptive Consensus (CAAC) removes that constraint. The chain adapts to the hardware. GPU farms run Proof of Compute. Smartphones run Proof of Relay. The protocol unifies both under a single economic model without demanding identical capabilities.

This paper defines the complete architecture. Implementation requires engineers who can operate at the intersection of distributed systems, applied cryptography, and ML infrastructure. If the design contains flaws, they should be discovered in technical critique — not on a deployed mainnet.

---

## 2. Abstract and Executive Summary

Current AI infrastructure operates on a trust model that concentrates risk. A handful of platform operators control access, pricing, and availability. The resulting opaque censorship, high intermediation costs, and correlated failure risks are not accidents. They are structurally unavoidable in centralized systems.

TET Network is a post-quantum, AI-native sovereign Layer-1 designed to replace that trust model with mathematical guarantees. The architecture is defined by four properties:

- **Context-Aware Adaptive Consensus (CAAC):** The protocol dynamically assigns each node an optimal validation role based on its hardware profile. High-performance GPU clusters run Proof of Compute; edge devices run Proof of Relay. Hardware heterogeneity is not a defect — it is a design feature.

- **Universal Miner Inclusion:** By adapting consensus to the environment, TET removes the hardware barrier that limited PoW and PoS participation to capital-rich actors. Any device with network connectivity and a power source is a valid participant.

- **Thermodynamic Efficiency:** No compute cycle in TET is spent on abstract puzzles. Every watt processed by a PoC node is used to solve a real AI inference task. Energy consumption scales directly with economic output.

- **Post-Quantum Security:** ML-DSA (FIPS 204 / Dilithium) is implemented as the base-layer signature scheme from genesis, providing mathematical resistance to Shor's algorithm without a migration event.

---

## 3. The Structural Failure of Homogeneous Consensus

Every major Layer-1 protocol currently in operation assumes that all nodes compete under identical rules. In Proof of Work, this produces ASIC centralization — a hardware arms race that converges on a small set of industrial operators who can amortize manufacturing cost. Proof of Stake replaces hardware with capital but preserves the monopoly structure — only entities capable of posting the minimum stake enter the validator set.

Neither model spends its compute on external utility. Bitcoin's SHA-256 hashing, Ethereum's former Ethash, and their successors produce only the cryptographic proofs that secure their ledgers. The energy expenditure is real; the economic output beyond consensus is zero.

This paper calls the pattern **Consensus Decay** — the gradual concentration of network dominance into a small hierarchy of actors, whether the scarce resource is hardware or capital. TET addresses Consensus Decay at the protocol layer by decoupling the consensus mechanism from a single hardware requirement and redirecting the underlying computational work to externally useful AI inference.

---

## 4. Core Innovation: Context-Aware Adaptive Consensus (CAAC)

CAAC is a protocol-level mechanism that evaluates each connecting node's physical capabilities and network context, then assigns it an optimal validation role. The design principle is simple — the chain adapts to the hardware, not the reverse.

### 4.1 High-Performance Nodes — Proof of Compute (PoC)

Nodes with sufficient processing capacity — data-center GPU clusters being the canonical case — are assigned the PoC role. These nodes process real AI inference tasks: matrix operations, attention computation, token generation. The network verifies their outputs through optimistic execution and zero-knowledge fraud proofs. TET rewards are issued in direct proportion to the verified thermodynamic energy delivered.

### 4.2 Edge Nodes — Proof of Relay (PoR) and PQC Verification

Constrained devices — smartphones, IoT hardware — are assigned the PoR role. They do not execute heavy inference. They sustain the network by routing data packets, maintaining state telemetry, and performing lightweight verification of post-quantum cryptographic signatures. Economic rewards scale with the work performed — smaller than PoC, but non-negligible, and accessible to any device with a data connection.

The two roles share a single ledger, a single token, and a single security model. CAAC is the routing layer that connects them.

---

## 5. Fluid Architecture and the Sovereign Runtime

TET Network instantiates the CAAC framework as an environment-adaptive chain — a **Fluid Chain**. The network rejects abstract benchmark scores. TET is the universal unit of both value and physical resource: 1 TET represents a deterministic, protocol-enforced quantity of verified AI computation or network-maintenance work.

### 5.1 The Sovereign Runtime

Ethereum measures computational steps with Gas — an abstract unit that prices execution without reference to external utility. TET prices execution directly in units of thermodynamic work. When a smart contract requests AI inference, the Sovereign Runtime routes the task to PoC nodes under an optimistic verification model. Nodes execute off the main thread and return a cryptographic commitment to the result. The main chain optimistically accepts the commitment during a challenge window. Disputes escalate to ZK-Court.

ZK-Court uses the RISC Zero or SP1 zkVM to replay the disputed execution and produce a verifiable proof. A commitment that fails verification triggers a 100% slash of the malicious node's staked TET. The cost of fraud is not a fine — it is confiscation.

### 5.2 Mathematical Model of Thermodynamic Work

The value of 1 TET is not arbitrary. It is a cryptographic proof of physical work. A node's expected reward $R$ over a time interval $T$ is calculated as:

$$R(T) = \frac{\sum_{i \in \text{verified\_tasks}(T)} \left[ \eta(W_i) \cdot C(t_i) \right]}{D(t)}$$

Where $\eta(W_i)$ is the verified thermodynamic output of task $i$, $C(t_i)$ is the network's compute price at time $t_i$, and $D(t)$ is the dynamic difficulty coefficient. This equation establishes the **Sovereign Peg** — the generation of intelligence is cryptographically bound to physical electricity.

---

## 6. Anatomy of a Fluid Transaction

A TET transaction represents either a value transfer or a request for physical AI computation. The transaction structure carries a **workload flag** — a single binary field that directs CAAC routing:

- **Flag = 0:** Standard value transfer. Verified by edge nodes via PoR. Low latency, minimal resource requirements.
- **Flag = 1:** AI inference or computation request. Routed exclusively to PoC high-performance nodes. Subject to ZK-Court dispute resolution.

The distinction is enforced at the protocol layer. Submitting a flag-1 transaction to an edge node is rejected by the routing logic — there is no path to cost reduction through misrouting.

## 7. Edge Clustering and Semantic Routing

Geographic distribution of compute resources provides censorship resistance but introduces physical network latency. Distributing a 50GB model weights file to every node that might receive an inference request is impractical. TET solves this with **Weight Locality**.

Nodes specialize and cache specific model families according to their hardware profile. When a user submits an inference request, the protocol routes the task to the nearest logical cluster that already holds the required model weights in memory. Data transfer overhead is reduced to inference inputs and outputs only, not the model itself. The latency of decentralized inference converges to that of centralized cloud providers — without sacrificing the decentralized trust model.

---

## 8. State Verification on Edge Devices

The "8 billion devices" objective — making every internet-connected device a valid network participant — requires that smartphones and IoT hardware can participate securely without storing terabytes of ledger history. TET achieves this through a multi-level Merkle tree structure.

PoC nodes store full state. PoR edge nodes operate as light clients — they download only block headers and verify the cryptographic proofs attached to them. To query a specific contract state or balance, an edge device fetches only the relevant Merkle branch. That proof is sufficient to mathematically confirm the validity of the data without holding the full chain. Edge node storage requirements are bounded by the header chain and a small local proof cache — well within the constraints of consumer hardware.

---

## 9. Thermodynamic Efficiency and Network Resilience

TET implements a **zero-waste compute model**. Every unit of energy consumed by a PoC node is allocated to an externally useful task. There are no abstract hash puzzles. The protocol does not burn electricity to prove it burned electricity.

Network resilience is a structural property of the two-tier architecture, not a designed safety feature. If major data centers or GPU clusters go offline — through hardware failure, regulatory action, or geopolitical events — the surrounding PoR edge nodes automatically maintain state propagation and routing. The network degrades in inference throughput but does not lose ledger continuity. Millions of geographically distributed light nodes, operated independently, provide redundancy that no centralized data center can match.

> This property is internally referred to as the **Cockroach Doctrine** — the network cannot be physically destroyed because there is no single physical location to kill.

---

## 10. Post-Quantum Security

ECDSA, the signature scheme protecting the majority of current blockchain assets, is vulnerable to Shor's algorithm on a sufficiently capable quantum computer. The timeline for that capability is uncertain, but the mathematical vulnerability is not. Migrating a deployed mainnet to a new signature scheme retroactively is a coordination problem with no clean solution.

TET implements **ML-DSA** (Module-Lattice-Based Digital Signature Algorithm, FIPS 204, standardized by NIST in 2024) as the base-layer signature scheme from genesis block zero. Private keys and on-chain assets are mathematically resistant to both classical and quantum computers from day one. There is no migration event, no opt-in period, and no legacy ECDSA compatibility layer to expand the attack surface.

---

## 11. Tokenomics: Genesis Allocation and Scarcity

Maximum total supply is fixed at **10,000,000,000 TET**. The allocation is hardcoded into the base layer and is not subject to governance modification.

### 11.1 Genesis Allocation

- **25% — Founders & Core Contributors:** Subject to a multi-year vesting schedule. No liquidity at genesis.
- **50% — Resource Mining Rewards:** Issued programmatically over decades to PoC and PoR nodes. Released by algorithm, controlled by no entity.
- **25% — Ecosystem Treasury:** Held in a decentralized smart contract. Allocated to AI infrastructure grants and network expansion via on-chain governance.

### 11.2 Deflationary Burn Mechanism

50% of all transaction fees, including AI inference costs, are permanently burned at settlement. As network demand grows, the burn rate grows with it. The supply curve becomes structurally deflationary under sustained use, with no protocol intervention required.

---

## 12. Applications on the Sovereign Fluid Grid

Just as Ethereum generalized state transitions to enable DeFi, TET generalizes thermodynamic computing. The application surface extends beyond decentralized inference to any system where autonomous, verifiable AI execution becomes a primitive.

### 12.1 Native AI-Powered Rollup-as-a-Service (RaaS)

Today, deploying a dedicated blockchain requires substantial engineering resources and ongoing operational cost. TET removes that barrier. A single transaction deploys a sovereign Layer-2 subchain anchored to TET-Core. These subchains are not ledgers with a compute layer bolted on — they are AI-native by design. The base-layer PoC network provides each subchain with a "cannot-be-evil" AI monitoring layer — autonomous smart contract auditing, anomaly detection, and blockspace optimization operate at infrastructure level rather than application level.

Deployment and operational costs are paid exclusively in TET, creating a sustained demand sink for the native asset.

### 12.2 Decentralized AI Inference Marketplace

Startups and researchers can route LLM queries through TET at a fraction of centralized cloud costs. Every inference result carries a cryptographic proof of correct execution, verifiable in ZK-Court without trusting the executing node.

### 12.3 Autonomous AI Agents — DAOs 2.0

Smart contracts can natively invoke PoC nodes running local AI models — analyzing on-chain data, executing trades, and initiating governance proposals, all without human intervention at each decision point. The AI execution layer is not an external oracle. It is part of the consensus model.

### 12.4 Quantum-Secure Financial Primitives

DeFi applications deployed on TET inherit ML-DSA security without additional configuration. As quantum capability advances, TET-native financial contracts remain mathematically sound while ECDSA-based chains face an existential migration event.

> ⚠️ **Future Work — Sections 12.5 through 12.7**
> 
> The following three sections describe long-term protocol primitives that are **not part of Phase 0 or Phase 1 implementation**. They represent architectural intent and research direction, not delivery commitments. Implementation depends on resolving open problems in federated learning, on-chain inference economics, and machine-to-machine settlement that are themselves active research areas.
>
> Readers evaluating TET against near-term technical milestones should treat sections 12.1–12.4 as the binding scope. Sections 12.5–12.7 describe what becomes possible once the base layer is operational.

### 12.5 Neural State Transitions — World Brain

During idle periods, PoC nodes contribute spare compute to continuous federated fine-tuning of a globally shared, open-source base model. The chain's cryptographic state itself becomes a living neural network — tamper-resistant, censorship-resistant, and continuously refined by privacy-preserving real-time telemetry from edge nodes worldwide. The model belongs to the protocol. No corporation can revoke access to it.

### 12.6 Sentient Assets — Smart Contracts 2.0

By integrating Neural State Transitions into the runtime, contract logic is no longer restricted to deterministic if-then rules. Developers can deploy assets with embedded inference — sovereign wallets that analyze transaction context to block social engineering attacks, digital entities that autonomously negotiate their own market value based on real-time ecosystem data. The asset itself reasons about its environment.

### 12.7 TET Agent-Gate — The Invisible Machine-to-Machine Economy

The era of human-facing CAPTCHAs is ending. Modern vision models defeat them easily. The future of web security and data access control depends on physical economic friction (cost) imposed on mass-deployed autonomous AI swarms (bot fleets). However, introducing this friction must not degrade human user experience (UX). Ultimate infrastructure is **transparent (invisible)**.

TET Agent-Gate is an autonomous M2M (machine-to-machine) API gateway. It is not aimed at human-facing websites — it protects the backends that AI agents, LLMs, and automated systems traverse. Its implementation is defined by three technical pillars:

1. **Invisible UX via Sovereign OS:** Human users never interact with the TET network directly. A local autonomous AI embedded in the user's OS operates entirely in the background, automatically consuming minute fractions of TET (e.g., 0.000001 stevemon) to access gated APIs and high-performance compute resources.

2. **Micropayments via State Channels:** To avoid main-chain latency and gas overhead, autonomous AIs open probabilistic state channels (off-chain) with gatekeeper nodes. Millions of access requests and negotiations occur in milliseconds, with only their net balance settled once daily on the TET Layer-1.

3. **Hardware-Enclave PoR:** Rather than generating compute-heavy ZK proofs at every interaction, TET Agent-Gate leverages consumer device secure enclaves (Apple Secure Enclave, ARM TrustZone). This provides an instant, unforgeable cryptographic proof of physical device presence without measurable impact on battery life or latency.

TET becomes the foundational settlement layer of the AI economy. A fluid, invisible grid where machines negotiate, pay, and verify each other at the speed of light.

---

## 13. Development Roadmap

- **Phase 0 — The Inference Wedge:** Launch of a refined, highly optimized LLM inference marketplace targeting edge nodes. The protocol establishes a baseline energy-to-compute ratio using a standardized Llama-3 model. No consensus layer yet — this phase validates the economic model.

- **Phase 1 — CAAC Implementation:** Full deployment of Context-Aware Adaptive Consensus. The network begins autonomously classifying nodes into PoC and PoR roles based on real-time hardware telemetry. ZK-Court dispute resolution becomes active.

- **Phase 2 — Post-Quantum Fluid Grid:** Full ML-DSA signature integration. The network reaches complete fluid distribution — AI requests are dynamically routed across a global quantum-resistant matrix of up to 8 billion devices. Federated learning and sentient asset primitives go live.

---

## 14. Threat Model and Cryptographic Defenses

### 14.1 Lazy Evaluation — Computation Spoofing

A malicious PoC node may attempt to save power by submitting fabricated inference results without executing the task. ZK-Court defends against this. During the challenge window, any watcher can initiate a RISC Zero or SP1 zkVM execution trace against the node's submitted commitment. A trace that contradicts the commitment triggers a 100% slash of the node's staked TET. The attack has a fixed, non-recoverable cost — its expected value is permanently negative.

### 14.2 Hardware Spoofing — Sybil Attacks

A node may attempt to disguise low-tier hardware as a high-end GPU to claim larger PoC rewards. TET mitigates this through **probabilistic hardware fingerprinting** — the protocol issues non-deterministic micro-tasks that exploit timing characteristics specific to actual hardware execution. The response profile is an unforgeable cryptographic proof of the physical hardware layer. Emulation cannot reproduce the timing signature of genuine silicon.

### 14.3 The Mathematics of Economic Finality

TET enforces a **cost-of-corruption model** in which the economic cost of a Byzantine attack reliably exceeds its potential gain. The slashable collateral $S$ is defined as:

$$S = \lambda \cdot R_{\text{expected}}$$

Because $S > R_{\text{expected}}$, the expected value of any feasible attack is permanently locked at a negative number. The protocol does not need to trust nodes — it only requires that they act as rational economic agents. This is a weaker, more reliable assumption.

---

## 15. Conclusion

The structural flaws of modern Layer-1 architecture are not implementation bugs. They are design choices — homogeneous consensus that concentrates power, energy expenditure with no external utility, cryptographic assumptions that cannot survive quantum hardware, and an implicit requirement of substantial capital for meaningful participation.

TET Network addresses each at the protocol layer. Context-Aware Adaptive Consensus dismantles the hardware monopoly. The Sovereign Runtime redirects energy consumption into economically useful AI inference. ML-DSA delivers quantum-resistant security from genesis. The two-tier node model extends participation to every device on Earth.

The result is not an incremental improvement over existing chains. It is a different kind of infrastructure — fluid, autonomous, sovereign — for a world in which artificial intelligence compute and physical energy are treated as universal resources, permissionlessly accessible and mathematically protected.

---

## 16. A Call to Builders

The architecture is complete. Translating it into a production codebase is an engineering problem — not a research problem. But it is not trivial. Core contributors with demonstrated expertise in the following domains are sought:

- **Systems Programming:** Rust. Low-level networking, memory-safety-critical consensus code.
- **Decentralized Networking:** libp2p. Peer discovery, NAT traversal, protocol multiplexing at scale.
- **Applied Cryptography:** zkVM development (RISC Zero, SP1), ML-DSA implementation, ZK fraud proof construction.
- **Distributed Machine Learning:** Federated learning, quantized inference, model weight distribution across heterogeneous hardware.

No résumés required. If this architecture contains inefficiencies, or if a better mechanism exists, identify it, describe it precisely, and send your technical critique to:

**yizhenxianshi@gmail.com** *(Subject: Core Builder Application)*

The first block of the global resource grid will not be mined by credential, but by those who understand why this architecture is correct — and can prove where it is not.

---

## 17. References

### Core Consensus and Cryptoeconomics
[1] Nakamoto, S. (2008). *Bitcoin: A Peer-to-Peer Electronic Cash System.*  
[2] Buterin, V. (2014). *Ethereum: A Next-Generation Smart Contract and Decentralized Application Platform.*  
[3] Sompolinsky, Y., & Zohar, A. (2015). *Secure High-Rate Transaction Processing in Bitcoin.* Financial Cryptography and Data Security.  
[4] Buterin, V., & Griffith, V. (2017). *Casper the Friendly Finality Gadget.* Ethereum Foundation.

### Zero-Knowledge and Post-Quantum Cryptography
[5] Ben-Sasson, E., Chiesa, A., et al. (2014). *SNARKs for C: Verifying Program Executions Succinctly and in Zero Knowledge.* CRYPTO 2013.  
[6] RISC Zero Team. (2023). *RISC Zero: A Zero-Knowledge Virtual Machine for General Purpose Computing.*  
[7] Succinct Labs. (2024). *SP1: A Next-Generation zkVM for High-Performance Proof Generation.*  
[8] NIST. (2024). *FIPS 204: Module-Lattice-Based Digital Signature Standard (ML-DSA).*

### Decentralized AI and Network Layer
[9] Borzunov, A., et al. (2022). *Petals: Collaborative Inference and Fine-tuning of Large Models.* arXiv:2209.01188.  
[10] Rao, Y. (2021). *Bittensor: A Peer-to-Peer Intelligence Market.*  
[11] AI@Meta. (2024). *Llama 3 Model Card.* Meta AI Research.  
[12] Protocol Labs. (2019). *libp2p: A Modular Network Stack for Peer-to-Peer Applications.*

### Thermodynamics and Hardware Security
[13] McMahan, B., et al. (2017). *Communication-Efficient Learning of Deep Networks from Decentralized Data.* AISTATS 2017.  
[14] Landauer, R. (1961). *Irreversibility and Heat Generation in the Computing Process.* IBM Journal of Research and Development.  
[15] Bennett, C. H. (1982). *The Thermodynamics of Computation.*  
[16] Suh, G. E., & Devadas, S. (2007). *Physical Unclonable Functions for Device Authentication and Secret Key Generation.* DAC 2007.

---

*End of Genesis Draft v1.0*
