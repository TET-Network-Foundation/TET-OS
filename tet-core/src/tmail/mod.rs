//! Tmail — Sovereign OS messaging (spec `docs/SOVEREIGN_OS_PHASE0_SPEC.md` §A.1).
//!
//! This module currently implements the **Basic E2EE** envelope protocol and its hybrid-signature
//! verification only (`flags = { basic: true, .. all false }`). Time-lock / Burn / Anonymous and the
//! node store / REST endpoints are added in later tasks.
//!
//! Design invariant: Tmail ciphertext is **never** written to the ledger — envelopes only travel over
//! libp2p gossip (`/tet/v1/tmail`) and a node-local TTL buffer ([`store::TmailStore`]).

pub mod envelope;
pub mod keys;
pub mod store;
