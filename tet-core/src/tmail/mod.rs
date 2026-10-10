//! Tmail — Sovereign OS messaging (spec `docs/SOVEREIGN_OS_PHASE0_SPEC.md` §A.1).
//!
//! This module implements the **Basic E2EE** envelope protocol, its hybrid-signature verification,
//! the node-local store and the REST/gossip surface. **Burn-after-read** (S7-1) and **time-lock**
//! (S7-2) are supported. Anonymous (S8) is still rejected at verification.
//!
//! Time-lock is **scheduled release, not an enforced lock** (spec §A.2.2 approach C, locked
//! decision #1): the ciphertext reaches relaying nodes at send time and cooperating nodes withhold
//! it until `release_at_ms`. See [`timelock`] for the limits that wording is carrying.
//!
//! Design invariant: Tmail ciphertext is **never** written to the ledger — envelopes only travel over
//! libp2p gossip (`/tet/v1/tmail`) and a node-local TTL buffer ([`store::TmailStore`]).

pub mod anon;
pub mod burn;
pub mod envelope;
pub mod keys;
pub mod poll;
pub mod shelter;
pub mod store;
pub mod timelock;
