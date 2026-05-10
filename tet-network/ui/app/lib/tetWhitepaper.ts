/** TET Network v0.1 - in-app whitepaper (short). */
export const TET_WHITEPAPER_TITLE = "TET Network v0.1 - Thermodynamic Execution Tree";

export const TET_WHITEPAPER_FULL_TEXT = `TET Network v0.1 - Thermodynamic Execution Tree

TET Network converts AI demand into verifiable economic work.

An AI prompt enters TET-OS, is signed by the wallet with Ed25519 and ML-DSA over one canonical chain-bound payload, and is routed to worker infrastructure for execution. The ledger records workload intent, nonce lineage, burn accounting, worker settlement, and audit material under the same Thermodynamic Execution Tree.

Core invariants:
- Every state-changing action is bound to chain_id, genesis_hash, and a monotonic nonce.
- Ed25519 provides current ledger identity; ML-DSA provides a post-quantum authentication layer over the same bytes.
- Worker receipts and ZK-Court challenge paths make invalid compute economically punishable.
- Burn and reward accounting express physical compute as irreversible L1 pressure.

TET is not a chat UI. It is a thermodynamic L1 for decentralized AI routing, settlement, and punishment.`;
