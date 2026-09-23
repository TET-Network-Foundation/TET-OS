//! Tmail — Sovereign OS messaging (spec `docs/SOVEREIGN_OS_PHASE0_SPEC.md` §A.1).
//!
//! This module implements the **Basic E2EE** envelope protocol, its hybrid-signature verification,
//! the node-local store and the REST/gossip surface. **Burn-after-read** (S7-1) is supported:
//! `flags = { basic: true, burn_after_read: true, .. }`. Time-lock (S7-2) and Anonymous (S8) are
//! still rejected at verification.
//!
//! Design invariant: Tmail ciphertext is **never** written to the ledger — envelopes only travel over
//! libp2p gossip (`/tet/v1/tmail`) and a node-local TTL buffer ([`store::TmailStore`]).

pub mod envelope;
pub mod keys;
pub mod store;
