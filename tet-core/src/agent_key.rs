//! Agent keys derived from the owner's words (docs/plans/AGENT_ID.md §1). Derivation only: no
//! manifest, no revocation, no limits; those wait on the plan's open questions.
//!
//! ```text
//! seed_agent = HKDF-SHA256(ikm = BIP39 seed(words, ""), info = "tet-agent-v1|" + label + "|" + n)
//! Ed25519    = seed_agent                                     (agent id = its public key, hex)
//! ML-DSA-44  = keygen(HKDF-SHA256(ikm = seed_agent, info = "tet:pqc:mldsa44-seed:v1"))
//! ```
//!
//! - **Same words, label and counter → the same agent keys,** on any device, so an owner can always
//!   re-create an agent's key (to revoke it or read its log) without the agent's key file.
//! - **The agent never holds the owner's words:** it gets only these derived keys. HKDF is one-way,
//!   so a leaked agent key doesn't reveal the owner's key.
//! - **Nobody else can check the derivation.** The link others can verify is the owner's signed
//!   manifest, not this math.
//! - **A label is 1–32 of `a-z 0-9 -`,** not starting or ending with `-`. `|` can't appear, so
//!   `label|n` is unambiguous: two different (label, n) pairs can never share an info string.
//! - **Nothing here prints, logs or returns the owner's words:** `Debug` shows only public keys, and
//!   errors never echo their input.
#![allow(dead_code)] // library only until an agent tool or route uses it (AGENT_ID.md)

use base64::Engine as _;
use bip39::{Language, Mnemonic};
use dilithium::{ML_DSA_44, MlDsaKeyPair};
use ed25519_dalek::SigningKey;
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroizing;

pub const AGENT_KEY_INFO_PREFIX: &str = "tet-agent-v1|";
pub const AGENT_LABEL_MAX: usize = 32;
const MLDSA44_SEED_INFO: &[u8] = b"tet:pqc:mldsa44-seed:v1";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentKeyError {
    /// The label breaks the rule above. The label itself is not echoed.
    InvalidLabel,
    /// Not a valid 12- or 24-word English BIP39 phrase. The words are never echoed.
    InvalidOwnerWords,
    Hkdf,
}

impl std::fmt::Display for AgentKeyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::InvalidLabel => "agent label must be 1-32 of a-z, 0-9 and -, not starting or ending with -",
            Self::InvalidOwnerWords => "the owner's passphrase (12 words) is not a valid phrase",
            Self::Hkdf => "agent key derivation failed",
        })
    }
}

impl std::error::Error for AgentKeyError {}

/// What may be shown or sent anywhere: no secret material.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct AgentPublicKeys {
    pub label: String,
    pub n: u32,
    /// The agent's ID: its Ed25519 public key, 64 lowercase hex.
    pub agent_id: String,
    pub mldsa44_pubkey_b64: String,
}

/// An agent's keys. `Debug` prints only the public part.
pub struct AgentKeys {
    public: AgentPublicKeys,
    ed25519: SigningKey,
    mldsa44: MlDsaKeyPair,
}

impl std::fmt::Debug for AgentKeys {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AgentKeys").field("public", &self.public).finish_non_exhaustive()
    }
}

impl AgentKeys {
    pub fn public(&self) -> &AgentPublicKeys {
        &self.public
    }
    pub fn agent_id(&self) -> &str {
        &self.public.agent_id
    }
    pub fn ed25519_signing_key(&self) -> &SigningKey {
        &self.ed25519
    }
    pub fn mldsa44_keypair(&self) -> &MlDsaKeyPair {
        &self.mldsa44
    }
}

pub fn valid_agent_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= AGENT_LABEL_MAX
        && label.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !label.starts_with('-')
        && !label.ends_with('-')
}

/// The HKDF info string for one agent: `tet-agent-v1|<label>|<n>`.
pub fn agent_key_info(label: &str, n: u32) -> Result<String, AgentKeyError> {
    if !valid_agent_label(label) {
        return Err(AgentKeyError::InvalidLabel);
    }
    Ok(format!("{AGENT_KEY_INFO_PREFIX}{label}|{n}"))
}

/// Derive agent `label` #`n` of the owner whose passphrase (12 words) is `owner_words`.
pub fn derive_agent_keys(owner_words: &str, label: &str, n: u32) -> Result<AgentKeys, AgentKeyError> {
    let info = agent_key_info(label, n)?;
    let words = Zeroizing::new(owner_words.split_whitespace().collect::<Vec<_>>().join(" "));
    let m = Mnemonic::parse_in(Language::English, words.as_str()).map_err(|_| AgentKeyError::InvalidOwnerWords)?;
    let seed = Zeroizing::new(m.to_seed(""));

    let mut seed_agent = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(None, seed.as_ref())
        .expand(info.as_bytes(), seed_agent.as_mut())
        .map_err(|_| AgentKeyError::Hkdf)?;
    let ed25519 = SigningKey::from_bytes(&seed_agent);

    let mut mldsa_seed = Zeroizing::new([0u8; 32]);
    Hkdf::<Sha256>::new(None, seed_agent.as_ref())
        .expand(MLDSA44_SEED_INFO, mldsa_seed.as_mut())
        .map_err(|_| AgentKeyError::Hkdf)?;
    let mldsa44 = MlDsaKeyPair::generate_deterministic(ML_DSA_44, &mldsa_seed);

    let public = AgentPublicKeys {
        label: label.to_string(),
        n,
        agent_id: hex::encode(ed25519.verifying_key().to_bytes()),
        mldsa44_pubkey_b64: base64::engine::general_purpose::STANDARD.encode(mldsa44.public_key()),
    };
    Ok(AgentKeys { public, ed25519, mldsa44 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::Digest as _;

    /// The BIP39 reference phrase (public, from the BIP39 test vectors): never a real wallet.
    const VECTOR_WORDS: &str = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

    fn mldsa_fingerprint(k: &AgentKeys) -> String {
        let pk = base64::engine::general_purpose::STANDARD.decode(&k.public().mldsa44_pubkey_b64).unwrap();
        hex::encode(Sha256::digest(&pk))
    }

    /// The derivation is pinned. The agent ID was checked against an independent implementation
    /// (Python: hashlib PBKDF2 for the BIP39 seed, a hand-written HMAC-SHA256 HKDF, PyNaCl Ed25519).
    /// The ML-DSA-44 key's fingerprint is pinned from this implementation only (the browser's WASM
    /// signer takes words, not a seed), so it guards against change, not against a shared mistake.
    /// Any change to the scheme or the info string fails here. Control (run by
    /// hand): info prefix "tet-agent-v2|" → FAILS.
    #[test]
    fn agent_key_for_a_known_phrase_is_pinned() {
        let k = derive_agent_keys(VECTOR_WORDS, "newsbot", 0).unwrap();
        assert_eq!(k.agent_id(), PINNED_AGENT_ID);
        assert_eq!(mldsa_fingerprint(&k), PINNED_MLDSA_SHA256);
        assert_eq!(base64::engine::general_purpose::STANDARD.decode(&k.public().mldsa44_pubkey_b64).unwrap().len(), 1312);
    }
    const PINNED_AGENT_ID: &str = "ede70cba57ccce7912f6e3561b71e7a2964eded45aa580b901727b2707301aca";
    const PINNED_MLDSA_SHA256: &str = "05e442456513b365f13b245fa36528d78966a59e1140715b7e72a8aacd0fbd08";

    /// Same words, label and counter → the same keys, every time and whatever the whitespace; and the
    /// signing keys behave (a signature by the agent verifies under its published keys).
    #[test]
    fn agent_key_is_stable() {
        let w = crate::wallet::generate_mnemonic_12().unwrap().mnemonic_12.unwrap();
        let a = derive_agent_keys(&w, "newsbot", 3).unwrap();
        let b = derive_agent_keys(&w, "newsbot", 3).unwrap();
        let spaced = format!("  {}\n", w.replace(' ', "   "));
        let c = derive_agent_keys(&spaced, "newsbot", 3).unwrap();
        assert_eq!(a.public(), b.public());
        assert_eq!(a.public(), c.public());
        assert_eq!(a.ed25519_signing_key().to_bytes(), b.ed25519_signing_key().to_bytes());

        use ed25519_dalek::Signer as _;
        let msg = b"tet agent key test";
        let sig = a.ed25519_signing_key().sign(msg);
        let vk = ed25519_dalek::VerifyingKey::from_bytes(&hex::decode(a.agent_id()).unwrap().try_into().unwrap()).unwrap();
        vk.verify_strict(msg, &sig).unwrap();
        let ml = crate::wallet::mldsa_sign_deterministic(a.mldsa44_keypair(), msg).unwrap();
        let ml_b64 = base64::engine::general_purpose::STANDARD.encode(ml);
        crate::wallet::verify_mldsa_b64(&a.public().mldsa44_pubkey_b64, &ml_b64, msg).unwrap();
    }

    /// Each (owner, label, n) is its own key, and none is the owner's wallet key.
    #[test]
    fn agent_keys_are_distinct_from_each_other_and_from_the_owner() {
        let w = crate::wallet::generate_mnemonic_12().unwrap();
        let words = w.mnemonic_12.clone().unwrap();
        let other = crate::wallet::generate_mnemonic_12().unwrap().mnemonic_12.unwrap();
        let ids: Vec<String> = [
            derive_agent_keys(&words, "newsbot", 0),
            derive_agent_keys(&words, "newsbot", 1),
            derive_agent_keys(&words, "newsbot2", 0),
            derive_agent_keys(&words, "news", 10), // "news|10" vs "newsbot|…": no shared info string
            derive_agent_keys(&words, "news1", 0),
            derive_agent_keys(&other, "newsbot", 0),
        ]
        .into_iter()
        .map(|k| k.unwrap().agent_id().to_string())
        .collect();
        let unique: std::collections::HashSet<&String> = ids.iter().collect();
        assert_eq!(unique.len(), ids.len(), "two agents share a key: {ids:?}");
        let owner_id = w.address_hex.to_ascii_lowercase();
        assert!(!ids.contains(&owner_id), "an agent key equals the owner's wallet key");
        let owner_mldsa = base64::engine::general_purpose::STANDARD
            .encode(crate::wallet::mldsa44_keypair_from_mnemonic(&words).unwrap().public_key());
        assert_ne!(derive_agent_keys(&words, "newsbot", 0).unwrap().public().mldsa44_pubkey_b64, owner_mldsa);
    }

    #[test]
    fn labels_outside_the_rule_are_refused() {
        let w = crate::wallet::generate_mnemonic_12().unwrap().mnemonic_12.unwrap();
        for bad in ["", "-a", "a-", "News", "a|1", "a b", "ä", "a_b", &"a".repeat(33)] {
            assert_eq!(derive_agent_keys(&w, bad, 0).unwrap_err(), AgentKeyError::InvalidLabel, "{bad:?}");
        }
        for good in ["a", "newsbot", "bot-2", "0", &"a".repeat(32)] {
            assert!(derive_agent_keys(&w, good, 0).is_ok(), "{good:?}");
        }
    }

    fn tokens(out: &str) -> std::collections::HashSet<String> {
        out.split(|c: char| c.is_whitespace() || "\"'`,;:()[]{}<>=|".contains(c)).filter(|t| !t.is_empty()).map(str::to_string).collect()
    }

    /// True if `out` contains the phrase, or two consecutive words of it, or one of its words as a
    /// token that isn't in `fixed` (the tokens the same outputs contain for an unrelated phrase: the
    /// fixed English of messages and field names, which can include BIP39 words like "valid").
    fn leaks_words(out: &str, words: &str, fixed: &std::collections::HashSet<String>) -> bool {
        let ws: Vec<&str> = words.split_whitespace().collect();
        if out.contains(words) || ws.windows(2).any(|p| out.contains(&format!("{} {}", p[0], p[1]))) {
            return true;
        }
        let t = tokens(out);
        ws.iter().any(|w| t.contains(*w) && !fixed.contains(*w))
    }

    /// Everything this module can show for `words`: the public keys (JSON and Debug), Debug of the
    /// keys, and every error (a bad label beside the real words, a near-miss of the words, a cut
    /// phrase). Returns the outputs, the near-miss phrase and the agent's secret key in hex.
    fn outputs_for(words: &str) -> (Vec<String>, String, String) {
        let k = derive_agent_keys(words, "newsbot", 0).unwrap();
        let mut outputs = vec![
            serde_json::to_string(k.public()).unwrap(),
            format!("{:?}", k.public()),
            format!("{k:?}"),
            format!("{k:#?}"),
        ];
        let mut typo: Vec<&str> = words.split_whitespace().collect();
        typo[3] = "notaword";
        let typo = typo.join(" ");
        for e in [
            derive_agent_keys(words, "Bad Label", 0).unwrap_err(),
            derive_agent_keys(&typo, "newsbot", 0).unwrap_err(),
            derive_agent_keys(&words[..words.len() - 2], "newsbot", 0).unwrap_err(),
        ] {
            outputs.push(e.to_string());
            outputs.push(format!("{e:?}"));
        }
        // Debug prints exactly the public part, nothing else (a derived Debug prints ~20 KB of key internals).
        assert_eq!(format!("{k:?}"), format!("AgentKeys {{ public: {:?}, .. }}", k.public()));
        (outputs, typo, hex::encode(k.ed25519_signing_key().to_bytes()))
    }

    /// The first bytes of `secret` as Rust prints a byte array: `[200, 165, 173, …`.
    fn decimal_prefix(secret: &[u8]) -> String {
        secret[..6].iter().map(|b| b.to_string()).collect::<Vec<_>>().join(", ")
    }

    /// The owner's words never appear in anything this module produces, for 20 random phrases a run;
    /// and `Debug` carries no secret key material. Controls (run by hand): `#[derive(Debug)]` on
    /// `AgentKeys` → FAILS (Debug is ~20 KB of key internals); an error that echoes its input → FAILS.
    #[test]
    fn owner_words_never_appear_in_any_output() {
        for _ in 0..20 {
            let words = crate::wallet::generate_mnemonic_12().unwrap().mnemonic_12.unwrap();
            let other = crate::wallet::generate_mnemonic_12().unwrap().mnemonic_12.unwrap();
            let (outputs, typo, secret_hex) = outputs_for(&words);
            let fixed: std::collections::HashSet<String> = outputs_for(&other).0.iter().flat_map(|o| tokens(o)).collect();
            let seed_hex = hex::encode(Mnemonic::parse_in(Language::English, words.as_str()).unwrap().to_seed(""));
            for out in &outputs {
                assert!(!leaks_words(out, &words, &fixed), "the owner's words leaked: {out}");
                assert!(!leaks_words(out, &typo, &fixed), "the near-miss words leaked: {out}");
                assert!(!out.contains(&secret_hex) && !out.contains(&seed_hex[..32]), "secret material in: {out}");
                let sk = hex::decode(&secret_hex).unwrap();
                assert!(!out.contains(&decimal_prefix(&sk)), "the secret key's bytes are in: {}", &out[..out.len().min(200)]);
            }
        }
        // The leak check itself can fail.
        let words = crate::wallet::generate_mnemonic_12().unwrap().mnemonic_12.unwrap();
        let none = std::collections::HashSet::new();
        assert!(leaks_words(&format!("error: {words}"), &words, &none));
        let w5 = words.split(' ').nth(5).unwrap();
        assert!(leaks_words(&format!("[\"{w5}\"]"), &words, &none));
    }
}
