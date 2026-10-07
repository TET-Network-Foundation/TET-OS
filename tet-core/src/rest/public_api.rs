//! Public-API mode for the "Try TET" demo node (`TET_PUBLIC_API=1`).
//!
//! The seeds keep REST on loopback. The demo node is the one place REST faces the internet, so it
//! answers **only** the routes the try page needs and rate-limits **per client IP**. Everything
//! else is a plain 404: no admin, mining, mnemonic, faucet or log route exists from outside.
//! See `docs/DEMO_NODE.md`.
//!
//! The gate is the outermost layer: nothing (handler, rate limit, CORS) runs for a request it
//! refuses.
//!
//! **Client identity.** The client is the TCP peer, unless the peer is a configured trusted proxy
//! (`TET_PUBLIC_TRUSTED_PROXIES`, addresses or CIDRs), in which case it is the **right-most**
//! `X-Forwarded-For` entry. On the demo node the proxies are Caddy and the UI container on a pinned
//! compose subnet; Caddy (2.5+, no `trusted_proxies`) replaces any client-supplied value. So the
//! header is believed only from a hop that set it, and a request reaching tet-core any other way is
//! keyed by its own address and cannot invent new ones. IPv6 clients are keyed by their /64: one
//! subscriber usually holds a whole /64, and per-address keys would give each 2^64 buckets.

use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// `(method, path pattern)`. A `:name` segment matches exactly one non-empty segment that is not
/// `.`/`..` and has no `%`; everything else must match exactly. Trailing slashes, extra segments,
/// dot-segments and encoded characters do not match.
pub const PUBLIC_ALLOWLIST: &[(&str, &str)] = &[
    ("GET", "/status"),
    ("GET", "/chain"),
    ("GET", "/ledger/state"),
    ("GET", "/ledger/balance/:wallet"),
    // Tmail
    ("POST", "/tmail/send"),
    ("GET", "/tmail/inbox/:wallet_id"),
    ("GET", "/tmail/keys/:wallet_id"),
    ("PUT", "/tmail/keys/:wallet_id"),
    ("POST", "/tmail/keys/:wallet_id"),
    ("POST", "/tmail/read-receipt"),
    // Anonymous mode: registration and the poster's path (never the wallet-keyed /anon/path).
    ("POST", "/tmail/anon/register"),
    ("GET", "/tmail/anon/root"),
    ("GET", "/tmail/anon/leaves"),
    ("PUT", "/tmail/anon/receipt"),
    ("POST", "/tmail/anon/receipt"),
    ("GET", "/tmail/anon/receipt/:hash"),
    // Files. `/files/fee` is not here: a visitor's fee goes through the sponsor below.
    ("POST", "/files/upload"),
    ("GET", "/files/inbox/:wallet_id"),
    ("GET", "/files/fetch/:file_id"),
    ("DELETE", "/files/item/:file_id"),
    // The file-fee sponsor (part 3): answers `no_sponsor` on a node without one.
    ("POST", "/demo/files/sponsor-fee"),
];

/// Set on the gate's own refusals, so a test can tell "the gate refused" from a handler's 404.
pub const GATE_HEADER: &str = "x-tet-public-gate";

pub fn public_api_enabled() -> bool {
    matches!(
        std::env::var("TET_PUBLIC_API").ok().as_deref().map(str::trim),
        Some("1") | Some("true") | Some("yes")
    )
}

/// Is `method path` on the allow-list? `OPTIONS` is allowed wherever any method is, for CORS.
pub fn is_allowed(method: &Method, path: &str) -> bool {
    let segs: Vec<&str> = path.split('/').collect();
    PUBLIC_ALLOWLIST.iter().any(|(m, pattern)| {
        (method.as_str() == *m || method == Method::OPTIONS) && pattern_matches(pattern, &segs)
    })
}

fn pattern_matches(pattern: &str, segs: &[&str]) -> bool {
    let pat: Vec<&str> = pattern.split('/').collect();
    pat.len() == segs.len()
        && pat.iter().zip(segs).all(|(p, s)| {
            if p.starts_with(':') {
                // One plain segment: not empty, nothing percent-encoded, and not a dot-segment that
                // a proxy or router in front might resolve to a different path than this one.
                !s.is_empty() && !s.contains('%') && *s != "." && *s != ".."
            } else {
                p == s
            }
        })
}

/// A bucket key for an address: IPv4 as is (IPv4-mapped IPv6 too), IPv6 by its /64.
pub fn ip_key(ip: IpAddr) -> String {
    match ip {
        IpAddr::V4(v4) => v4.to_string(),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => v4.to_string(),
            None => {
                let s = v6.segments();
                format!("{:x}:{:x}:{:x}:{:x}::/64", s[0], s[1], s[2], s[3])
            }
        },
    }
}

/// `addr` or `addr/prefix`, IPv4 or IPv6.
fn cidr_contains(cidr: &str, ip: IpAddr) -> bool {
    let (net, bits) = match cidr.split_once('/') {
        Some((n, b)) => (n, b.parse::<u32>().ok()),
        None => (cidr, None),
    };
    let Ok(net) = net.trim().parse::<IpAddr>() else { return false };
    match (net, ip) {
        (IpAddr::V4(n), IpAddr::V4(i)) => {
            let b = bits.unwrap_or(32).min(32);
            let mask = if b == 0 { 0 } else { u32::MAX << (32 - b) };
            (u32::from(n) & mask) == (u32::from(i) & mask)
        }
        (IpAddr::V6(n), IpAddr::V6(i)) => {
            let b = bits.unwrap_or(128).min(128);
            let mask = if b == 0 { 0 } else { u128::MAX << (128 - b) };
            (u128::from(n) & mask) == (u128::from(i) & mask)
        }
        _ => false,
    }
}

pub fn trusted_proxies_from_env() -> Vec<String> {
    std::env::var("TET_PUBLIC_TRUSTED_PROXIES")
        .ok()
        .map(|v| v.split(',').map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect())
        .unwrap_or_default()
}

/// The client a request is accounted to.
///
/// - The TCP peer, if it is not a trusted proxy (or if no proxies are configured).
/// - The right-most `X-Forwarded-For` entry, if the peer is a trusted proxy and the entry parses.
/// - `unknown` if the peer address is not available (only in-process calls), shared by all.
pub fn client_key(peer: Option<IpAddr>, headers: &HeaderMap, trusted: &[String]) -> String {
    let Some(peer) = peer else {
        return "unknown".to_string();
    };
    let peer_trusted = trusted.iter().any(|c| cidr_contains(c, peer));
    if !peer_trusted {
        return ip_key(peer);
    }
    headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .last()
        .and_then(|s| s.parse::<IpAddr>().ok())
        .map(ip_key)
        .unwrap_or_else(|| ip_key(peer))
}

fn env_f64(key: &str, default: f64) -> f64 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.trim().parse::<f64>().ok())
        .filter(|v| *v > 0.0)
        .unwrap_or(default)
}

/// Token-bucket limits per client, in two classes: reads, and writes (anything not GET/HEAD/OPTIONS).
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub read_per_sec: f64,
    pub read_burst: f64,
    pub write_per_min: f64,
    pub write_burst: f64,
    /// Most distinct clients tracked; past it, new clients share one overflow bucket (fail closed).
    pub max_clients: usize,
}

impl Limits {
    pub fn from_env() -> Self {
        Self {
            read_per_sec: env_f64("TET_PUBLIC_READ_PER_SEC", 10.0),
            read_burst: env_f64("TET_PUBLIC_READ_BURST", 40.0),
            write_per_min: env_f64("TET_PUBLIC_WRITE_PER_MIN", 20.0),
            write_burst: env_f64("TET_PUBLIC_WRITE_BURST", 10.0),
            max_clients: env_f64("TET_PUBLIC_MAX_CLIENTS", 50_000.0) as usize,
        }
    }
}

#[derive(Debug, Clone, Copy)]
struct Bucket {
    tokens: f64,
    at: Instant,
}

impl Bucket {
    fn take(&mut self, now: Instant, rate_per_sec: f64, burst: f64) -> bool {
        let dt = now.saturating_duration_since(self.at).as_secs_f64();
        self.tokens = (self.tokens + dt * rate_per_sec).min(burst);
        self.at = now;
        if self.tokens >= 1.0 {
            self.tokens -= 1.0;
            true
        } else {
            false
        }
    }
}

pub struct PublicGate {
    limits: Limits,
    trusted: Vec<String>,
    buckets: Mutex<HashMap<(String, bool), Bucket>>,
}

impl PublicGate {
    pub fn new(limits: Limits) -> Arc<Self> {
        Arc::new(Self { limits, trusted: trusted_proxies_from_env(), buckets: Mutex::new(HashMap::new()) })
    }

    /// Spend one token for `client` in its class. `false` means over the limit.
    pub fn allow(&self, client: &str, write: bool, now: Instant) -> bool {
        let (rate, burst) = if write {
            (self.limits.write_per_min / 60.0, self.limits.write_burst)
        } else {
            (self.limits.read_per_sec, self.limits.read_burst)
        };
        let mut map = self.buckets.lock().unwrap_or_else(|p| p.into_inner());
        let mut key = (client.to_string(), write);
        if !map.contains_key(&key) && map.len() >= self.limits.max_clients {
            // Drop clients idle long enough to be full again; if still full, share one bucket.
            map.retain(|_, b| now.saturating_duration_since(b.at).as_secs() < 600);
            if map.len() >= self.limits.max_clients {
                key = ("overflow".to_string(), write);
            }
        }
        map.entry(key)
            .or_insert(Bucket { tokens: burst, at: now })
            .take(now, rate, burst)
    }
}

fn is_write(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

/// The outermost layer in public mode: allow-list first, then the per-client limit.
pub async fn public_api_gate(
    axum::extract::State(gate): axum::extract::State<Arc<PublicGate>>,
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> Response {
    if !is_allowed(req.method(), req.uri().path()) {
        return (StatusCode::NOT_FOUND, [(GATE_HEADER, "refused")], "not found").into_response();
    }
    let peer = req
        .extensions()
        .get::<axum::extract::ConnectInfo<std::net::SocketAddr>>()
        .map(|c| c.0.ip());
    let client = client_key(peer, req.headers(), &gate.trusted);
    if !gate.allow(&client, is_write(req.method()), Instant::now()) {
        return (
            StatusCode::TOO_MANY_REQUESTS,
            [(axum::http::header::RETRY_AFTER, "5")],
            "rate limit exceeded for this address",
        )
            .into_response();
    }
    next.run(req).await
}
