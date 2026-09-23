//! Fluid P2P: bootnode discovery env parsing (`BOOTNODES` alias + `TET_BOOTNODES`).
//!
//! `TET_BOOTNODES` addresses the **block plane** and nothing else. The other planes read their
//! own variable via [`plane_bootnode_addrs_from_env`] and default to empty.
//!
//! They used to share `TET_BOOTNODES`, which was wrong twice over. The published bootnode
//! multiaddr points at the block-plane port (8002); the inference and ledger planes listen on
//! 4003/4005, which are container-internal and not published on the public seed at all, so the
//! dial could only ever land on the wrong plane's listener. And because every plane is built from
//! the same identity keypair, that second connection arrives at the remote as a second connection
//! from an already-known `PeerId` — which gossipsub answers by telling it nothing at all
//! (`behaviour.rs:2912`, `other_established > 0` returns early). Locally that connection belongs
//! to a different `Behaviour` instance, which is therefore left with no record of the remote's
//! subscriptions and cannot publish. See
//! `docs/postmortems/2026-09-gossip-lost-subscriptions.md`.

/// Comma-separated bootstrap multiaddrs (libp2p). Checks `TET_BOOTNODES` then `BOOTNODES`.
pub fn bootnode_addrs_from_env() -> Vec<String> {
    let raw = std::env::var("TET_BOOTNODES")
        .ok()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| {
            std::env::var("BOOTNODES")
                .ok()
                .filter(|s| !s.trim().is_empty())
        });
    raw.map(|s| {
        s.split(',')
            .map(|v| v.trim().to_string())
            .filter(|v| !v.is_empty())
            .collect()
    })
    .unwrap_or_default()
}

/// Bootnodes for a non-block plane, e.g. `plane_bootnode_addrs_from_env("TET_NEXUS_BOOTNODES")`.
///
/// Deliberately does **not** fall back to `TET_BOOTNODES`: that address is the block plane's, and
/// a fallback is what caused two planes to dial one listener under one `PeerId`.
pub fn plane_bootnode_addrs_from_env(var: &str) -> Vec<String> {
    std::env::var(var)
        .ok()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            s.split(',')
                .map(|v| v.trim().to_string())
                .filter(|v| !v.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

pub fn log_startup_summary() {
    let nodes = bootnode_addrs_from_env();
    log::info!(
        "[vision][fluid_net] bootnodes_loaded={} (TET_BOOTNODES | BOOTNODES)",
        nodes.len()
    );
    for (i, n) in nodes.iter().enumerate().take(8) {
        log::info!("[vision][fluid_net] bootnode[{i}] {n}");
    }
}
