//! Scheduled release (spec §A.2.2 approach **C**, locked decision #1).
//!
//! # What this is, and what it is not
//!
//! A sender sets `release_at_ms` inside the signed §A.1.3 pre-image. Until that moment,
//! `GET /tmail/inbox` lists the message — sender, timestamps, the release time, a `locked` marker —
//! but **withholds the `e2ee` block**, so a cooperating node serves no ciphertext early.
//!
//! That is the entire mechanism, and it is worth being blunt about its limits:
//!
//! - The ciphertext is gossiped at send time and sits in every relaying node's store from then on.
//!   Withholding is a **policy** those nodes apply to their own API, not a property of the message.
//! - The decryption key is the receiver's, not the network's. The node never decrypts (there is no
//!   `/tmail/decrypt` route; decryption is client-side). Anyone holding the receiver's keys who can
//!   see the ciphertext — a peer's operator, someone who captured the gossip — can read it
//!   immediately.
//! - A node running modified code simply serves it.
//!
//! So this is **scheduled release, not an enforced lock**. The spec is explicit about this
//! (§A.2.2 item 3, risk **R6**), and [`TMAIL_TIME_LOCK_DISCLOSURE`] is the wording that must
//! travel with it anywhere a user can see it.
//!
//! Real enforcement is Phase 0.1: the optional `time_lock_stake_micro` forfeit (§A.2.2 item 4) and
//! the Wesolowski VDF (§A.2.3). Both are deliberately out of scope here.

use serde::Serialize;

use crate::tmail::envelope::{TmailE2eeBlock, TmailEnvelopeV1, TmailFlags, TmailHybridSig};

/// The locked user-facing wording for scheduled release (spec §A.2.5, risk **R6**, decision #1).
///
/// Reproduced verbatim wherever a user sees the feature — the compose control, a withheld message,
/// the API docs and the operator guide. Do not soften it and do not describe this as a "time-lock"
/// without it: the whole risk R6 exists because "time-lock" implies an enforcement this does not
/// have.
pub const TMAIL_TIME_LOCK_DISCLOSURE: &str =
    "Scheduled release, not an enforced lock. The encrypted message reaches relaying nodes when it \
     is sent; cooperating nodes withhold it until the release time, and anyone holding the \
     recipient's keys could read it sooner.";

/// Is this message still scheduled at `now_ms`?
///
/// `now_ms` is a parameter rather than a call to the clock so the behaviour is testable without
/// waiting out a real schedule, and so a caller can never accidentally compare against two
/// different instants within one response.
pub fn is_locked(env: &TmailEnvelopeV1, now_ms: u64) -> bool {
    env.flags.time_lock && now_ms < env.release_at_ms
}

/// One row of `GET /tmail/inbox`.
///
/// Identical to [`TmailEnvelopeV1`] on the wire except that `e2ee` is **absent** while the message
/// is still scheduled, and two fields are added: `locked`, and `locked_note` carrying
/// [`TMAIL_TIME_LOCK_DISCLOSURE`] so a client cannot render the state without the caveat being
/// available to it.
///
/// A separate type rather than `Option<TmailE2eeBlock>` on the envelope itself: a *submitted*
/// envelope must always carry its ciphertext (`verify_tmail_envelope_v1` hashes it for the
/// pre-image), and making the field optional there would let an envelope with no payload look
/// structurally valid.
#[derive(Debug, Clone, Serialize)]
pub struct TmailInboxRowV1 {
    pub v: u32,
    pub kind: String,
    pub msg_id: String,
    pub flags: TmailFlags,
    pub sender_wallet_id: String,
    pub receiver_wallet_id: String,
    pub sent_at_ms: u64,
    pub release_at_ms: u64,
    pub ttl_ms: u64,
    pub fee_paid_micro: u64,
    pub pin_stake_micro: u64,
    /// Omitted entirely while the message is scheduled. Clients must treat "absent" as "not yet
    /// released", never as an empty payload.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub e2ee: Option<TmailE2eeBlock>,
    pub hybrid_sig: TmailHybridSig,
    /// `true` while `now < release_at_ms`.
    pub locked: bool,
    /// Present only on anonymous messages: what this node concluded about the membership proof.
    ///
    /// **Absent is not "verified".** A client must render `pending` as *proof pending* and never
    /// label a message anonymous-verified until this says `verified`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anon_verdict: Option<crate::tmail::store::AnonVerdict>,
    /// Present only when `locked`; always [`TMAIL_TIME_LOCK_DISCLOSURE`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub locked_note: Option<&'static str>,
}

/// Project an envelope into an inbox row, withholding the ciphertext if it is still scheduled.
///
/// The signature block is kept either way: the receiver can verify who scheduled the message and
/// for when before it opens, which is the point of listing it at all.
pub fn to_inbox_row(env: &TmailEnvelopeV1, now_ms: u64) -> TmailInboxRowV1 {
    to_inbox_row_with_verdict(env, now_ms, None)
}

/// As [`to_inbox_row`], attaching the stored anonymity verdict.
///
/// An anonymous message with **no** stored verdict is reported as
/// [`crate::tmail::store::AnonVerdict::Pending`] rather than as an absent field: "we have not
/// checked yet" must be a value the client sees, not a gap it interprets.
pub fn to_inbox_row_with_verdict(
    env: &TmailEnvelopeV1,
    now_ms: u64,
    verdict: Option<crate::tmail::store::AnonVerdict>,
) -> TmailInboxRowV1 {
    let locked = is_locked(env, now_ms);
    let anon_verdict = if env.flags.anonymous {
        Some(verdict.unwrap_or(crate::tmail::store::AnonVerdict::Pending))
    } else {
        None
    };
    TmailInboxRowV1 {
        v: env.v,
        kind: env.kind.clone(),
        msg_id: env.msg_id.clone(),
        flags: env.flags.clone(),
        sender_wallet_id: env.sender_wallet_id.clone(),
        receiver_wallet_id: env.receiver_wallet_id.clone(),
        sent_at_ms: env.sent_at_ms,
        release_at_ms: env.release_at_ms,
        ttl_ms: env.ttl_ms,
        fee_paid_micro: env.fee_paid_micro,
        pin_stake_micro: env.pin_stake_micro,
        e2ee: if locked {
            None
        } else {
            Some(env.e2ee.clone())
        },
        hybrid_sig: env.hybrid_sig.clone(),
        locked,
        locked_note: if locked {
            Some(TMAIL_TIME_LOCK_DISCLOSURE)
        } else {
            None
        },
        anon_verdict,
    }
}
