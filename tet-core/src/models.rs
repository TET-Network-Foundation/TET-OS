use crate::files::FileEnvelopeV1;
use crate::protocol::SignedTxEnvelopeV1;
use crate::tmail::envelope::TmailEnvelopeV1;
use serde::{Deserialize, Serialize};

/// Network-wide state sync events carried over libp2p gossipsub.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum NetworkEvent {
    /// A mined block containing zero or more signed transactions.
    ///
    /// Receiver nodes should apply it idempotently (per-tx) without re-broadcast.
    BlockMined {
        block_height: u64,
        block_id: String,
        #[serde(default)]
        parent_block_id: Option<String>,
        producer_id: String,
        base_reward_micro: u64,
        compute_reward_micro: u64,
        total_reward_micro: u64,
        state_root: String,
        txs: Vec<SignedTxEnvelopeV1>,
    },

    /// A ledger transfer that has been executed on a remote node.
    ///
    /// Receiver nodes should apply it **idempotently** (keyed by `tx_hash`) without re-broadcast.
    TransferExecuted {
        tx_hash: String,
        from_wallet: String,
        to_wallet: String,
        amount_micro: u64,
        fee_bps: u64,
    },

    /// Admin faucet credit observed on another node (pool → user).
    ///
    /// Remote receivers debit [`crate::ledger::WALLET_SYSTEM_WORKER_POOL`] and credit `to_wallet`,
    /// keyed by `event_id` for idempotency (typically the originating node's audit hash hex).
    FaucetExecuted {
        event_id: String,
        to_wallet: String,
        amount_micro: u64,
    },

    /// A pending (not-yet-mined) signed transaction broadcast to peers so that
    /// any producer node can include it in a block.
    ///
    /// Receivers MUST verify the envelope and enqueue it into their local mempool
    /// only — this event never mutates the ledger directly. Replaces the legacy
    /// signature-less `LedgerGossip::TransferAnnounce` notify (which peers ignored).
    TxBroadcast {
        env: SignedTxEnvelopeV1,
    },

    /// A Tmail Basic E2EE envelope gossiped to peers (spec §A.1).
    ///
    /// Tmail is **off-ledger**: receivers MUST verify the hybrid signature and may buffer the
    /// envelope for the receiver (node-local TTL store, next task), but it never mutates the
    /// ledger and is never re-broadcast on receipt.
    TmailGossip {
        envelope: TmailEnvelopeV1,
    },

    /// A File Sharing announce envelope gossiped to peers (spec `PHASE_0_FILE_SHARING_SPEC.md` §6).
    ///
    /// Off-ledger, mirroring [`NetworkEvent::TmailGossip`]: receivers MUST verify the hybrid
    /// signature and may buffer the envelope metadata (node-local store), but it never mutates the
    /// ledger and is never re-broadcast on receipt. The encrypted body is **not** carried here — it
    /// is pulled separately (REST `GET /files/fetch/:file_id`).
    FileAnnounce {
        envelope: FileEnvelopeV1,
    },
}
