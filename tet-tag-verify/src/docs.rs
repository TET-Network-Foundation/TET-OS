//! The two tag documents of docs/plans/GENUINE_TAG.md §2, with one canonical JSON form each.
//!
//! Canonical form: UTF-8 JSON, object keys sorted by byte order, no whitespace, integers only,
//! absent values written as `null` (never left out). The record's payload is SHA-256 of that text.
//! Hashes and IDs are lowercase hex.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const REGISTRATION_KIND: &str = "tet_tag_registration";
pub const CLAIM_KIND: &str = "tet_tag_claim";

/// tag_id = SHA-256("tet tag v1" ‖ UID), so the raw UID is never published.
pub fn tag_id(uid: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b"tet tag v1");
    h.update(uid);
    hex::encode(h.finalize())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Chip {
    #[serde(rename = "ntag424dna")]
    Ntag424Dna,
    #[serde(rename = "ntag424dna_tt")]
    Ntag424DnaTt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tamper {
    Closed,
    Open,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Product {
    pub label: String,
    #[serde(rename = "ref")]
    pub reference: String,
    pub images_sha256: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TagRegistrationV1 {
    pub v: u32,
    pub kind: String,
    pub tag_id: String,
    pub chip: Chip,
    pub product: Product,
    pub verifier: String,
    pub counter_at_registration: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tap {
    pub counter: u32,
    pub tamper: Option<Tamper>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TagClaimV1 {
    pub v: u32,
    pub kind: String,
    pub tag_id: String,
    pub registration_record_sha256: String,
    pub previous_claim_sha256: Option<String>,
    pub release_sha256: Option<String>,
    pub new_owner: String,
    pub tap: Tap,
    pub verifier_attestation_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocError {
    Json(String),
    Version(u32),
    Kind(String),
    NotHash(&'static str),
    Verifier,
    /// A claim that cites a release must also cite the claim it releases.
    ReleaseWithoutPrevious,
}

impl std::fmt::Display for DocError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DocError::Json(e) => write!(f, "not a valid document: {e}"),
            DocError::Version(v) => write!(f, "v is {v}, only 1 is known"),
            DocError::Kind(k) => write!(f, "kind is '{k}', not the expected one"),
            DocError::NotHash(what) => write!(f, "{what} is not 64 lowercase hex characters"),
            DocError::Verifier => write!(f, "verifier must be an https:// address"),
            DocError::ReleaseWithoutPrevious => {
                write!(f, "a claim with a release must cite the previous claim")
            }
        }
    }
}

impl std::error::Error for DocError {}

fn is_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn check_hash(what: &'static str, s: &str) -> Result<(), DocError> {
    if is_hash(s) {
        Ok(())
    } else {
        Err(DocError::NotHash(what))
    }
}

/// Canonical JSON text of any serialisable value (see the module comment).
pub fn canonical_json<T: Serialize>(v: &T) -> String {
    let value = serde_json::to_value(v).expect("tag documents always serialise");
    let mut out = String::new();
    write_canonical(&value, &mut out);
    out
}

fn write_canonical(v: &Value, out: &mut String) {
    match v {
        Value::Object(m) => {
            let mut keys: Vec<&String> = m.keys().collect();
            keys.sort();
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(k).expect("string"));
                out.push(':');
                write_canonical(&m[*k], out);
            }
            out.push('}');
        }
        Value::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_canonical(x, out);
            }
            out.push(']');
        }
        // Strings, integers, booleans and null: serde_json's compact form is already canonical.
        other => out.push_str(&serde_json::to_string(other).expect("scalar")),
    }
}

fn sha256_hex(s: &str) -> String {
    hex::encode(Sha256::digest(s.as_bytes()))
}

impl TagRegistrationV1 {
    pub fn validate(&self) -> Result<(), DocError> {
        if self.v != 1 {
            return Err(DocError::Version(self.v));
        }
        if self.kind != REGISTRATION_KIND {
            return Err(DocError::Kind(self.kind.clone()));
        }
        check_hash("tag_id", &self.tag_id)?;
        for h in &self.product.images_sha256 {
            check_hash("product.images_sha256", h)?;
        }
        if !self.verifier.starts_with("https://") {
            return Err(DocError::Verifier);
        }
        Ok(())
    }
    pub fn canonical_json(&self) -> String {
        canonical_json(self)
    }
    /// The SHA-256 a registry record would carry as its payload.
    pub fn sha256(&self) -> String {
        sha256_hex(&self.canonical_json())
    }
    pub fn from_json(s: &str) -> Result<Self, DocError> {
        let d: Self = serde_json::from_str(s).map_err(|e| DocError::Json(e.to_string()))?;
        d.validate()?;
        Ok(d)
    }
}

impl TagClaimV1 {
    pub fn validate(&self) -> Result<(), DocError> {
        if self.v != 1 {
            return Err(DocError::Version(self.v));
        }
        if self.kind != CLAIM_KIND {
            return Err(DocError::Kind(self.kind.clone()));
        }
        check_hash("tag_id", &self.tag_id)?;
        check_hash(
            "registration_record_sha256",
            &self.registration_record_sha256,
        )?;
        if let Some(h) = &self.previous_claim_sha256 {
            check_hash("previous_claim_sha256", h)?;
        }
        if let Some(h) = &self.release_sha256 {
            check_hash("release_sha256", h)?;
            if self.previous_claim_sha256.is_none() {
                return Err(DocError::ReleaseWithoutPrevious);
            }
        }
        check_hash(
            "verifier_attestation_sha256",
            &self.verifier_attestation_sha256,
        )?;
        Ok(())
    }
    pub fn canonical_json(&self) -> String {
        canonical_json(self)
    }
    pub fn sha256(&self) -> String {
        sha256_hex(&self.canonical_json())
    }
    pub fn from_json(s: &str) -> Result<Self, DocError> {
        let d: Self = serde_json::from_str(s).map_err(|e| DocError::Json(e.to_string()))?;
        d.validate()?;
        Ok(d)
    }
}
