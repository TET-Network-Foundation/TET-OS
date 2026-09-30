//! Agent identity — a key an automated process holds, vouched for by a human wallet.
//!
//! Two pieces, and nothing else in v0:
//!
//! 1. [`agent_payload_auth_message_bytes`] — the **generic** signer. Everything else in this
//!    repository signs one purpose-built pre-image per operation (`transfer_hybrid_auth_message_bytes`,
//!    `tmail_envelope_auth_message_bytes`, …). An agent needs to sign *arbitrary* bytes: a devlog
//!    entry, a file, an HTTP body. That is a genuinely dangerous thing to add, because a generic
//!    signer with no domain separation is a **signing oracle**: hand it a payload that happens to
//!    equal a transfer pre-image and an agent key becomes a spending key.
//!
//!    So the encoding is length-prefixed (DSSE's PAE shape) under a fixed domain tag, and the chain
//!    is bound in. Two properties follow, and both are asserted by tests rather than asserted here:
//!    output always begins with `tet agent payload v1`, which no other TET pre-image does; and no
//!    two distinct field lists can produce the same bytes, because every field carries its length.
//!    A `|`-joined format has neither property — `wallet.rs`'s builders escape nothing, so a field
//!    containing `|` is re-parseable as two fields. That is why this is not just another
//!    `format!("…|{}|{}")`.
//!
//! 2. [`AgentManifestV1`] — the owner's statement that a given agent key is theirs. Same shape as
//!    [`crate::tmail::anon::TmailAnonRegistrationV1`], deliberately: signer is the subject, the
//!    chain is bound, and the ML-DSA public key is **inside** the pre-image so it cannot be swapped
//!    for another after signing.
//!
//! WHAT A MANIFEST DOES NOT SAY. It does not prove the agent is software. Nothing in a signature
//! can separate a model's output from a human typing into the same process holding the same key, so
//! the field is [`AgentManifestV1::declared_automated`] — a declaration by the owner, named as one.
//! It also does not prove the owner still endorses the key: v0 has no revocation, only
//! `expires_at_ms`, which is the revocation you do not have to operate.
//!
//! LEVEL PINNING. Verification uses [`crate::wallet::verify_mldsa44_b64`], never
//! [`crate::wallet::verify_mldsa_b64`] and never [`crate::quantum_shield::verify_hybrid`] (which
//! calls the latter). The inferring verifier reads the parameter set off the public key it is handed
//! and accepts a consistent ML-DSA-65 pair happily — green, and unusable by every wallet on the
//! network. A manifest that says ML-DSA-44 has to *enforce* ML-DSA-44 or the claim is decorative.
//!
//! DETERMINISTIC SIGNING RANDOMNESS. ML-DSA here signs with
//! `rnd = SHA256("tet:mldsa44-signing-rnd:v1" ‖ msg)` ([`crate::wallet::mldsa_signing_rnd`]).
//! FIPS 204 permits deterministic signing, the value is public and message-derived, and the
//! cross-language interop guards depend on it: the browser bundle, `tet-pqc-wasm` and this crate
//! must produce identical signature bytes for identical input, which is only checkable because
//! there is no randomness. **Do not "fix" this by adding entropy** — it would break every fixture
//! and buy nothing, since the pre-image is already domain-separated and chain-bound.

use base64::Engine as _;
use ed25519_dalek::Signer as _;
use serde::{Deserialize, Serialize};

use crate::protocol::HybridSigV1;

/// Domain tag every agent-signed pre-image starts with. No other TET pre-image begins with this.
pub const AGENT_PAYLOAD_DOMAIN_V1: &str = "tet agent payload v1";

/// `payload_type` for a manifest, so a manifest can never be confused with agent-signed content.
pub const AGENT_MANIFEST_PAYLOAD_TYPE: &str = "tet agent manifest v1";

/// Stable `kind` discriminator.
pub const AGENT_MANIFEST_KIND: &str = "tet_agent_manifest_v1";

/// ML-DSA-44 public key size (FIPS 204). Pinned, not inferred.
pub const AGENT_MLDSA44_PUBKEY_BYTES: usize = 1312;

/// Upper bound on the capability list. Input-driven lists need an explicit, *observable* bound:
/// the refusal names this number, so a manifest rejected for size says which limit it hit rather
/// than being silently truncated.
pub const AGENT_MANIFEST_MAX_CAPABILITIES: usize = 32;

/// Upper bound on one capability string.
pub const AGENT_MANIFEST_MAX_CAPABILITY_LEN: usize = 64;

/// Upper bound on `agent_id`.
pub const AGENT_MANIFEST_MAX_AGENT_ID_LEN: usize = 128;

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AgentError {
    #[error("unsupported manifest version: {0}")]
    UnsupportedVersion(u32),
    #[error("unexpected manifest kind: {0}")]
    Kind(String),
    #[error("agent_id must be 1..={max} bytes (got {got})")]
    AgentId { got: usize, max: usize },
    #[error("too many capabilities: {got} (bound is {max})")]
    TooManyCapabilities { got: usize, max: usize },
    #[error("capability {index} must be 1..={max} bytes (got {got})")]
    Capability {
        index: usize,
        got: usize,
        max: usize,
    },
    #[error("invalid agent ed25519 pubkey (expected 64 lowercase hex chars)")]
    InvalidAgentEd25519,
    #[error("invalid owner wallet id (expected 64 lowercase hex chars)")]
    InvalidOwnerWalletId,
    #[error("the agent key must not be the owner's own wallet key")]
    AgentKeyIsOwnerKey,
    #[error("agent ml-dsa pubkey must be {expected} bytes (ML-DSA-44); got {got}")]
    AgentKeyLevel { got: usize, expected: usize },
    #[error("owner ml-dsa pubkey must be {expected} bytes (ML-DSA-44); got {got}")]
    OwnerKeyLevel { got: usize, expected: usize },
    #[error("signer ed25519 pubkey must equal owner_wallet_id")]
    SignerMismatch,
    #[error("expires_at_ms ({expires_at_ms}) must be after created_at_ms ({created_at_ms})")]
    Schedule {
        created_at_ms: u64,
        expires_at_ms: u64,
    },
    #[error("manifest expired at {expires_at_ms} (now {now_ms})")]
    Expired { expires_at_ms: u64, now_ms: u64 },
    #[error("ed25519 signature verification failed: {0}")]
    Ed25519(String),
    #[error("ml-dsa-44 signature verification failed: {0}")]
    Mldsa44(String),
    #[error("signing failed: {0}")]
    Signing(String),
}

/// `len SP field` for each field, concatenated. DSSE's PAE body.
///
/// The length prefix is the whole point: `["a", "bc"]` and `["ab", "c"]` encode differently, so no
/// choice of field contents can make two distinct lists collide.
fn pae_fields(fields: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::new();
    for f in fields {
        out.extend_from_slice(f.len().to_string().as_bytes());
        out.push(b' ');
        out.extend_from_slice(f);
        out.push(b' ');
    }
    out
}

/// `domain SP <pae_fields>`.
fn pae(domain: &str, fields: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(domain.len() + 1);
    out.extend_from_slice(domain.as_bytes());
    out.push(b' ');
    out.extend_from_slice(&pae_fields(fields));
    out
}

/// The bytes an agent key signs for an arbitrary payload.
///
/// `payload_type` is a caller-chosen label (`"tet agent manifest v1"`, `"application/json"`, a
/// devlog entry type…). It is bound in, so a signature over one type is not a signature over
/// another even for identical bytes.
pub fn agent_payload_auth_message_bytes(payload_type: &str, payload: &[u8]) -> Vec<u8> {
    let chain_id = crate::genesis::chain_id_from_env();
    let genesis_hash = crate::genesis::expected_genesis_hash_from_env();
    pae(
        AGENT_PAYLOAD_DOMAIN_V1,
        &[
            chain_id.as_bytes(),
            genesis_hash.as_bytes(),
            payload_type.trim().as_bytes(),
            payload,
        ],
    )
}

/// An owner wallet's statement that an agent key is theirs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentManifestV1 {
    pub v: u32,
    pub kind: String,
    /// Human label for the agent. Bound into the pre-image; carries no authority.
    pub agent_id: String,
    /// 64-hex Ed25519 public key the agent signs with.
    pub agent_ed25519_pubkey_hex: String,
    /// Standard base64 ML-DSA-44 public key the agent signs with (1312 bytes).
    pub agent_mldsa44_pubkey_b64: String,
    /// 64-hex wallet id of the human owner. The signer.
    pub owner_wallet_id: String,
    pub created_at_ms: u64,
    /// Expiry is the only revocation v0 has. Re-sign to extend.
    pub expires_at_ms: u64,
    /// The owner's *declaration* that this key belongs to an automated process. Not a proof.
    pub declared_automated: bool,
    pub capabilities: Vec<String>,
    /// Signed by the OWNER, over [`agent_manifest_auth_message_bytes`].
    pub hybrid_sig: HybridSigV1,
}

fn is_64hex_lower(s: &str) -> bool {
    let s = s.trim();
    s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

/// Manifest pre-image: the manifest's fields, then wrapped by the generic agent payload encoding.
///
/// `owner_mldsa_pubkey_b64` is a parameter rather than read off `hybrid_sig` so that the caller
/// cannot accidentally verify against a key the pre-image did not commit to — the mistake
/// `tmail_anon_registration_auth_message_bytes` also guards against.
pub fn agent_manifest_auth_message_bytes(
    m: &AgentManifestV1,
    owner_mldsa_pubkey_b64: &str,
) -> Vec<u8> {
    let v = m.v.to_string();
    let agent_ed = m.agent_ed25519_pubkey_hex.trim().to_ascii_lowercase();
    let owner = m.owner_wallet_id.trim().to_ascii_lowercase();
    let created = m.created_at_ms.to_string();
    let expires = m.expires_at_ms.to_string();
    let automated = if m.declared_automated { "1" } else { "0" };
    let cap_count = m.capabilities.len().to_string();
    let owner_pk = owner_mldsa_pubkey_b64.trim();

    let mut fields: Vec<&[u8]> = vec![
        v.as_bytes(),
        m.kind.trim().as_bytes(),
        m.agent_id.as_bytes(),
        agent_ed.as_bytes(),
        m.agent_mldsa44_pubkey_b64.trim().as_bytes(),
        owner.as_bytes(),
        created.as_bytes(),
        expires.as_bytes(),
        automated.as_bytes(),
        cap_count.as_bytes(),
        owner_pk.as_bytes(),
    ];
    for c in &m.capabilities {
        fields.push(c.as_bytes());
    }
    let body = pae_fields(&fields);
    agent_payload_auth_message_bytes(AGENT_MANIFEST_PAYLOAD_TYPE, &body)
}

/// Verify one hybrid signature over agent-signed bytes, at ML-DSA-44 specifically.
///
/// `signer_wallet_id` is passed separately from `sig.ed25519_pubkey_hex`: callers that mean to bind
/// a signature to a named identity must do that equality check themselves and say which error it
/// is, rather than letting a signature failure stand in for a binding failure. Accepting either
/// reason is how two guards in this repository ended up vacuous.
pub fn verify_agent_hybrid_sig(
    signer_wallet_id: &str,
    sig: &HybridSigV1,
    msg: &[u8],
) -> Result<(), AgentError> {
    crate::quantum_shield::verify_ed25519(signer_wallet_id, &sig.ed25519_sig_b64, msg)
        .map_err(|e| AgentError::Ed25519(format!("{e:?}")))?;
    crate::wallet::verify_mldsa44_b64(&sig.mldsa_pubkey_b64, &sig.mldsa_sig_b64, msg)
        .map_err(AgentError::Mldsa44)?;
    Ok(())
}

/// Verify an agent's signature over an arbitrary payload.
pub fn verify_agent_payload(
    agent_ed25519_pubkey_hex: &str,
    sig: &HybridSigV1,
    payload_type: &str,
    payload: &[u8],
) -> Result<(), AgentError> {
    let signer = agent_ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if !is_64hex_lower(&signer) {
        return Err(AgentError::InvalidAgentEd25519);
    }
    if sig.ed25519_pubkey_hex.trim().to_ascii_lowercase() != signer {
        return Err(AgentError::SignerMismatch);
    }
    let msg = agent_payload_auth_message_bytes(payload_type, payload);
    verify_agent_hybrid_sig(&signer, sig, &msg)
}

/// Verify a manifest.
///
/// Order: structure, then the signer binding, then the signature, then the schedule. The signature
/// comes before expiry on purpose — an `Expired` error should only ever be reported for a manifest
/// that genuinely is the owner's, so "expired" never doubles as "unverifiable". `now_ms` is a
/// parameter and not a clock read: wall-clock time reached for inside verification is what split
/// two nodes at block 9828.
pub fn verify_agent_manifest_v1(m: &AgentManifestV1, now_ms: u64) -> Result<(), AgentError> {
    if m.v != 1 {
        return Err(AgentError::UnsupportedVersion(m.v));
    }
    if m.kind.trim() != AGENT_MANIFEST_KIND {
        return Err(AgentError::Kind(m.kind.clone()));
    }
    let agent_id_len = m.agent_id.len();
    if agent_id_len == 0 || agent_id_len > AGENT_MANIFEST_MAX_AGENT_ID_LEN {
        return Err(AgentError::AgentId {
            got: agent_id_len,
            max: AGENT_MANIFEST_MAX_AGENT_ID_LEN,
        });
    }
    if m.capabilities.len() > AGENT_MANIFEST_MAX_CAPABILITIES {
        return Err(AgentError::TooManyCapabilities {
            got: m.capabilities.len(),
            max: AGENT_MANIFEST_MAX_CAPABILITIES,
        });
    }
    for (index, c) in m.capabilities.iter().enumerate() {
        if c.is_empty() || c.len() > AGENT_MANIFEST_MAX_CAPABILITY_LEN {
            return Err(AgentError::Capability {
                index,
                got: c.len(),
                max: AGENT_MANIFEST_MAX_CAPABILITY_LEN,
            });
        }
    }

    let agent_ed = m.agent_ed25519_pubkey_hex.trim().to_ascii_lowercase();
    if !is_64hex_lower(&agent_ed) {
        return Err(AgentError::InvalidAgentEd25519);
    }
    let owner = m.owner_wallet_id.trim().to_ascii_lowercase();
    if !is_64hex_lower(&owner) {
        return Err(AgentError::InvalidOwnerWalletId);
    }
    // An agent holding the owner's own key is not an agent identity, it is the owner's spending key
    // in a process that signs automatically.
    if agent_ed == owner {
        return Err(AgentError::AgentKeyIsOwnerKey);
    }

    let b64 = base64::engine::general_purpose::STANDARD;
    let agent_pk_len = b64
        .decode(m.agent_mldsa44_pubkey_b64.trim().as_bytes())
        .map(|v| v.len())
        .unwrap_or(0);
    if agent_pk_len != AGENT_MLDSA44_PUBKEY_BYTES {
        return Err(AgentError::AgentKeyLevel {
            got: agent_pk_len,
            expected: AGENT_MLDSA44_PUBKEY_BYTES,
        });
    }
    let owner_pk_len = b64
        .decode(m.hybrid_sig.mldsa_pubkey_b64.trim().as_bytes())
        .map(|v| v.len())
        .unwrap_or(0);
    if owner_pk_len != AGENT_MLDSA44_PUBKEY_BYTES {
        return Err(AgentError::OwnerKeyLevel {
            got: owner_pk_len,
            expected: AGENT_MLDSA44_PUBKEY_BYTES,
        });
    }

    // Binding, as its own check with its own error. The real forgery is a *correctly signed*
    // manifest naming somebody else as owner, so the signature cannot be what refuses it.
    if m.hybrid_sig.ed25519_pubkey_hex.trim().to_ascii_lowercase() != owner {
        return Err(AgentError::SignerMismatch);
    }

    let msg = agent_manifest_auth_message_bytes(m, &m.hybrid_sig.mldsa_pubkey_b64);
    verify_agent_hybrid_sig(&owner, &m.hybrid_sig, &msg)?;

    if m.expires_at_ms <= m.created_at_ms {
        return Err(AgentError::Schedule {
            created_at_ms: m.created_at_ms,
            expires_at_ms: m.expires_at_ms,
        });
    }
    if now_ms > m.expires_at_ms {
        return Err(AgentError::Expired {
            expires_at_ms: m.expires_at_ms,
            now_ms,
        });
    }
    Ok(())
}

// ── Signing (used by tests today, by `tet-cli agent sign` on Day 2) ───────────────────────────────

/// Hybrid-sign arbitrary bytes with the wallet derived from `mnemonic`.
pub fn sign_agent_payload(
    mnemonic: &str,
    payload_type: &str,
    payload: &[u8],
) -> Result<HybridSigV1, AgentError> {
    let msg = agent_payload_auth_message_bytes(payload_type, payload);
    sign_agent_message_bytes(mnemonic, &msg)
}

/// Hybrid-sign pre-encoded bytes. Callers outside this module should prefer
/// [`sign_agent_payload`], which cannot forget the domain tag.
pub fn sign_agent_message_bytes(mnemonic: &str, msg: &[u8]) -> Result<HybridSigV1, AgentError> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let ed_sk = crate::wallet::ed25519_signing_key_from_mnemonic(mnemonic)
        .map_err(|e| AgentError::Signing(format!("{e:?}")))?;
    let kp = crate::wallet::mldsa44_keypair_from_mnemonic(mnemonic)
        .map_err(|e| AgentError::Signing(format!("{e:?}")))?;
    let mldsa_sig = crate::wallet::mldsa44_sign_deterministic(&kp, msg)
        .map_err(|e| AgentError::Signing(format!("{e:?}")))?;
    Ok(HybridSigV1 {
        ed25519_pubkey_hex: hex::encode(ed_sk.verifying_key().to_bytes()),
        ed25519_sig_b64: b64.encode(ed_sk.sign(msg).to_bytes()),
        mldsa_pubkey_b64: b64.encode(kp.public_key()),
        mldsa_sig_b64: b64.encode(mldsa_sig),
    })
}

/// Sign `m` in place as its owner. Fills `m.hybrid_sig`.
///
/// The owner's ML-DSA public key is part of the pre-image, so it has to be known *before* the bytes
/// are built: derive it, build the pre-image against it, then sign.
pub fn sign_agent_manifest(owner_mnemonic: &str, m: &mut AgentManifestV1) -> Result<(), AgentError> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let kp = crate::wallet::mldsa44_keypair_from_mnemonic(owner_mnemonic)
        .map_err(|e| AgentError::Signing(format!("{e:?}")))?;
    let owner_pk_b64 = b64.encode(kp.public_key());
    let msg = agent_manifest_auth_message_bytes(m, &owner_pk_b64);
    m.hybrid_sig = sign_agent_message_bytes(owner_mnemonic, &msg)?;
    Ok(())
}
