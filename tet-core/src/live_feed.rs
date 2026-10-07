//! The last few things this node actually saw on the network, for the try page's "Live" channel
//! (`GET /status/live`).
//!
//! A bounded ring buffer of [`LIVE_EVENTS_KEEP`] events, recorded by the block-plane swarm loop:
//! a gossip message it parsed (its kind, and the height for a block) and a peer connecting or
//! disconnecting. Nothing is synthesised: an idle node shows an empty or stale list.
//!
//! **Privacy:** an event carries a kind, a time, a block height and the last 6 characters of a
//! libp2p peer id (public in the gossip layer anyway). Never an IP address, a message or file id,
//! a wallet id, or anything from a message's contents.
//!
//! Node-local display state; not consensus, not persisted.

use std::collections::VecDeque;
use std::sync::{Mutex, OnceLock};

/// How many events `/status/live` returns (the newest).
pub const LIVE_EVENTS_KEEP: usize = 20;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
pub struct LiveEvent {
    pub at_ms: u64,
    /// `block`, `tx`, `tmail`, `file`, `other`, `peer_connected`, `peer_disconnected`.
    pub kind: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub height: Option<u64>,
    /// The last 6 characters of the peer id, when there is one.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub peer: Option<String>,
}

fn feed() -> &'static Mutex<VecDeque<LiveEvent>> {
    static FEED: OnceLock<Mutex<VecDeque<LiveEvent>>> = OnceLock::new();
    FEED.get_or_init(|| Mutex::new(VecDeque::with_capacity(LIVE_EVENTS_KEEP)))
}

/// The short peer label: the last 6 characters of the id (never an address).
pub fn short_peer(peer_id: &str) -> String {
    let chars: Vec<char> = peer_id.chars().collect();
    chars[chars.len().saturating_sub(6)..].iter().collect()
}

/// Record one event. Cheap and never blocks for long: one short mutex, a bounded deque.
pub fn record(kind: &'static str, height: Option<u64>, peer_id: Option<&str>) {
    let ev = LiveEvent {
        at_ms: crate::swarm_health::now_ms(),
        kind,
        height,
        peer: peer_id.map(short_peer),
    };
    if let Ok(mut q) = feed().lock() {
        if q.len() == LIVE_EVENTS_KEEP {
            q.pop_front();
        }
        q.push_back(ev);
    }
}

/// The kept events, newest first.
pub fn snapshot() -> Vec<LiveEvent> {
    feed().lock().map(|q| q.iter().rev().cloned().collect()).unwrap_or_default()
}

/// The source commit this binary was built from: `TET_GIT_SHA` at compile time (the deploy
/// commands pass it), or `None` when the build didn't say.
pub fn build_commit() -> Option<&'static str> {
    option_env!("TET_GIT_SHA").filter(|s| !s.is_empty())
}

#[cfg(test)]
pub fn clear_for_tests() {
    if let Ok(mut q) = feed().lock() {
        q.clear();
    }
}
