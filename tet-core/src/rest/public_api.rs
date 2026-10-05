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
//! **Client IP.** The demo node runs tet-core behind Caddy, which (2.5+, no `trusted_proxies`)
//! replaces any client-supplied `X-Forwarded-For` with the real remote address. tet-core is
//! published only on `127.0.0.1`, so a request carrying `X-Forwarded-For` came through Caddy, and
//! its **right-most** entry is the client. A request with no usable header came from the host itself
//! (the health probe) and shares one bucket, `local`.

use axum::http::{HeaderMap, Method, StatusCode};
use axum::response::{IntoResponse, Response};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

/// `(method, path pattern)`. A `:name` segment matches exactly one non-empty segment; everything
/// else must match exactly. Trailing slashes, extra segments and encoded slashes do not match.
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
    // Files (the fee route comes with the sponsor, part 3 of docs/DEMO_NODE.md)
    ("POST", "/files/upload"),
    ("GET", "/files/inbox/:wallet_id"),
    ("GET", "/files/fetch/:file_id"),
    ("DELETE", "/files/item/:file_id"),
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
                !s.is_empty() && !s.contains('%')
            } else {
                p == s
            }
        })
}

/// The client a request is accounted to: the right-most `X-Forwarded-For` entry if it parses as an
/// IP, else `local`.
pub fn client_key(headers: &HeaderMap) -> String {
    headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .last()
        .and_then(|s| s.parse::<std::net::IpAddr>().ok())
        .map(|ip| ip.to_string())
        .unwrap_or_else(|| "local".to_string())
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
    buckets: Mutex<HashMap<(String, bool), Bucket>>,
}

impl PublicGate {
    pub fn new(limits: Limits) -> Arc<Self> {
        Arc::new(Self { limits, buckets: Mutex::new(HashMap::new()) })
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
    let client = client_key(req.headers());
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
