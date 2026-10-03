//! Block-producer signing key (Phase 1, spec §1 + D2): a dedicated hybrid Ed25519 + ML-DSA-44
//! keypair that signs the V3 `block_id`.
//!
//! It is **not** the wallet key: a producing node holds no spending secret. It lives in the node's
//! db directory next to the libp2p and ML-DSA-65 node keys, as two 32-byte seeds (mode 0600), and
//! its public half is what the genesis validator set lists for this producer.

use base64::Engine as _;
use dilithium::{ML_DSA_44, MlDsaKeyPair};
use ed25519_dalek::{Signer as _, SigningKey};
use rand_core::{OsRng, RngCore as _};
use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

pub const ED25519_SEED_FILE: &str = "producer_ed25519_seed.raw";
pub const MLDSA44_SEED_FILE: &str = "producer_mldsa44_seed.raw";

/// Domain tag for the producer signature pre-image. `block_id` already commits to height, parent,
/// state root, txs, producer and `ts_ms` (V3), so the signature covers all of them through it.
pub const BLOCK_SIGNATURE_DOMAIN: &[u8] = b"TET_BLOCK_SIG_V1|";

/// What the producer signs: `TET_BLOCK_SIG_V1|` followed by the `block_id` string.
pub fn block_signing_preimage(block_id: &str) -> Vec<u8> {
    let mut m = BLOCK_SIGNATURE_DOMAIN.to_vec();
    m.extend_from_slice(block_id.as_bytes());
    m
}

/// A producer's public key, as listed in the genesis validator set.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ProducerPublicKey {
    /// 32-byte Ed25519 verifying key, lowercase hex.
    pub ed25519_pk_hex: String,
    /// Raw FIPS-204 ML-DSA-44 public key, STANDARD base64.
    pub mldsa44_pk_b64: String,
}

/// The two halves of a producer signature over [`block_signing_preimage`]. Both must verify.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BlockSignature {
    pub ed25519_sig_hex: String,
    pub mldsa44_sig_b64: String,
}

/// Verify both halves of `sig` over `block_id` against `pk`. Each half fails with its own message,
/// so a guard can tell which half refused (CLAUDE.md, C4).
pub fn verify_block_signature(
    pk: &ProducerPublicKey,
    block_id: &str,
    sig: &BlockSignature,
) -> Result<(), String> {
    let msg = block_signing_preimage(block_id);
    crate::wallet::verify_ed25519_hex_message(&pk.ed25519_pk_hex, &msg, &sig.ed25519_sig_hex)
        .map_err(|e| format!("producer signature: ed25519 half refused: {e}"))?;
    crate::wallet::verify_mldsa44_b64(&pk.mldsa44_pk_b64, &sig.mldsa44_sig_b64, &msg)
        .map_err(|e| format!("producer signature: ml-dsa-44 half refused: {e}"))?;
    Ok(())
}

/// The producer's secret key. Never leaves the node.
pub struct ProducerKeypair {
    ed25519: SigningKey,
    mldsa44: MlDsaKeyPair,
}

impl std::fmt::Debug for ProducerKeypair {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ProducerKeypair")
            .field("public", &self.public_key())
            .finish_non_exhaustive()
    }
}

fn seed_paths(dir: &Path) -> (PathBuf, PathBuf) {
    (dir.join(ED25519_SEED_FILE), dir.join(MLDSA44_SEED_FILE))
}

fn read_seed(path: &Path) -> Result<Zeroizing<[u8; 32]>, String> {
    let bytes =
        Zeroizing::new(std::fs::read(path).map_err(|e| format!("{}: {e}", path.display()))?);
    let arr: [u8; 32] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| format!("{}: producer seed must be 32 bytes", path.display()))?;
    Ok(Zeroizing::new(arr))
}

fn write_seed(path: &Path, seed: &[u8; 32]) -> Result<(), String> {
    std::fs::write(path, seed).map_err(|e| format!("{}: {e}", path.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

impl ProducerKeypair {
    /// Build from the two 32-byte seeds.
    pub fn from_seeds(ed25519_seed: &[u8; 32], mldsa44_seed: &[u8; 32]) -> Self {
        Self {
            ed25519: SigningKey::from_bytes(ed25519_seed),
            mldsa44: MlDsaKeyPair::generate_deterministic(ML_DSA_44, mldsa44_seed),
        }
    }

    /// Fresh random key (not persisted).
    pub fn generate() -> Self {
        let mut ed = Zeroizing::new([0u8; 32]);
        let mut ml = Zeroizing::new([0u8; 32]);
        OsRng.fill_bytes(ed.as_mut());
        OsRng.fill_bytes(ml.as_mut());
        Self::from_seeds(&ed, &ml)
    }

    /// Load the producer key from `db_dir`, or create it there if neither seed file exists.
    /// A directory holding only one of the two seeds is refused rather than half-regenerated.
    pub fn load_or_create(db_dir: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(db_dir).map_err(|e| e.to_string())?;
        let (ed_path, ml_path) = seed_paths(db_dir);
        match (ed_path.is_file(), ml_path.is_file()) {
            (true, true) => Ok(Self::from_seeds(
                &*read_seed(&ed_path)?,
                &*read_seed(&ml_path)?,
            )),
            (false, false) => {
                let mut ed = Zeroizing::new([0u8; 32]);
                let mut ml = Zeroizing::new([0u8; 32]);
                OsRng.fill_bytes(ed.as_mut());
                OsRng.fill_bytes(ml.as_mut());
                write_seed(&ed_path, &ed)?;
                write_seed(&ml_path, &ml)?;
                Ok(Self::from_seeds(&ed, &ml))
            }
            _ => Err(format!(
                "producer keystore in {} has only one of {ED25519_SEED_FILE} / {MLDSA44_SEED_FILE}; \
                 refusing to regenerate half a key",
                db_dir.display()
            )),
        }
    }

    pub fn public_key(&self) -> ProducerPublicKey {
        ProducerPublicKey {
            ed25519_pk_hex: hex::encode(self.ed25519.verifying_key().to_bytes()),
            mldsa44_pk_b64: base64::engine::general_purpose::STANDARD
                .encode(self.mldsa44.public_key()),
        }
    }

    /// Sign `block_id`. ML-DSA uses the deterministic `rnd` every TET signature uses
    /// ([`crate::wallet::mldsa_signing_rnd`]), so the same key and block give the same bytes.
    pub fn sign_block_id(&self, block_id: &str) -> Result<BlockSignature, String> {
        let msg = block_signing_preimage(block_id);
        let ed = self.ed25519.sign(&msg);
        let ml = crate::wallet::mldsa44_sign_deterministic(&self.mldsa44, &msg)
            .map_err(|e| e.to_string())?;
        Ok(BlockSignature {
            ed25519_sig_hex: hex::encode(ed.to_bytes()),
            mldsa44_sig_b64: base64::engine::general_purpose::STANDARD.encode(ml),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(n: u8) -> ProducerKeypair {
        ProducerKeypair::from_seeds(&[n; 32], &[n.wrapping_add(100); 32])
    }

    #[test]
    fn producer_signature_round_trips_and_is_deterministic() {
        let k = key(1);
        let a = k.sign_block_id("0xabc").unwrap();
        assert_eq!(a, k.sign_block_id("0xabc").unwrap(), "deterministic rnd");
        verify_block_signature(&k.public_key(), "0xabc", &a).unwrap();
    }

    /// C4: each half is checked on its own. A valid signature from another block is swapped into
    /// exactly one half, so only a verifier that checks that half can refuse it.
    #[test]
    fn producer_signature_refuses_each_half_independently() {
        let k = key(2);
        let good = k.sign_block_id("0xblock-a").unwrap();
        let other = k.sign_block_id("0xblock-b").unwrap();

        let ed_swapped = BlockSignature {
            ed25519_sig_hex: other.ed25519_sig_hex.clone(),
            ..good.clone()
        };
        let err = verify_block_signature(&k.public_key(), "0xblock-a", &ed_swapped).unwrap_err();
        assert!(err.contains("ed25519 half refused"), "{err}");

        let ml_swapped = BlockSignature {
            mldsa44_sig_b64: other.mldsa44_sig_b64.clone(),
            ..good
        };
        let err = verify_block_signature(&k.public_key(), "0xblock-a", &ml_swapped).unwrap_err();
        assert!(err.contains("ml-dsa-44 half refused"), "{err}");
    }

    #[test]
    fn producer_keystore_persists_and_refuses_half_a_key() {
        let dir = tempfile::tempdir().unwrap();
        let a = ProducerKeypair::load_or_create(dir.path()).unwrap();
        let b = ProducerKeypair::load_or_create(dir.path()).unwrap();
        assert_eq!(a.public_key(), b.public_key());
        // The ML-DSA half is level 44: 1312-byte public key.
        let pk = base64::engine::general_purpose::STANDARD
            .decode(a.public_key().mldsa44_pk_b64)
            .unwrap();
        assert_eq!(pk.len(), ML_DSA_44.public_key_bytes());

        std::fs::remove_file(dir.path().join(MLDSA44_SEED_FILE)).unwrap();
        let err = ProducerKeypair::load_or_create(dir.path()).unwrap_err();
        assert!(err.contains("half a key"), "{err}");
    }
}
