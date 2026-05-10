## TET Litepaper (1-Page Executive Summary)

### Mission
TET is a decentralized, censorship-resistant AI supercomputer network: a global compute mesh where anyone can supply hardware and anyone can buy inference/compute—without centralized gatekeepers.

### The TET Economy (Peg)
- **Unit**: TET is the network’s accounting unit for paying for compute.
- **Peg**: **1 TET = 1 CHF** (protocol-defined peg claim for launch communication).
- **Supply discipline**: Minting is bounded by a hard cap and audited on-ledger; transfers are fee-metered to sustain protocol operations.

### Roles
- **Workers**
  - Register and provide CPU/GPU compute.
  - Earn TET for verified work (proofs and protocol rules enforce accounting and caps).
- **Users**
  - Spend TET to access AI/compute APIs.
  - Can source TET via the network’s peer-to-peer marketplace instead of traditional banks.

### The Quantum-Proof P2P DEX (No Banks)
To bypass fiat rails and minimize censorship risk, TET ships a **P2P orderbook DEX**:
- **Maker/Taker order book**: makers post orders; takers fill them.
- **TET-only escrow**: protocol escrows TET atomically; external stablecoin settlement happens off-ledger.
- **Quantum Gate**: escrow release requires **hybrid signatures (Ed25519 + ML-DSA/Dilithium2)**.
- **Non‑repudiation**: the escrow release signature **commits the external payment proof** (e.g., Solana USDC `txid`) so neither party can later deny the agreed settlement.
- **Safety**: timeouts automatically refund escrow if settlement does not complete.

