#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use libp2p::identity;

#[cfg(target_arch = "wasm32")]
pub struct FinancialIdentity {
    pub wallet_id_hex: String,  // 64-hex ed25519 public key
    pub keypair_proto: Vec<u8>, // libp2p identity protobuf encoding
}

#[cfg(target_arch = "wasm32")]
fn keypair_from_seed32(seed32: [u8; 32]) -> Result<identity::Keypair, JsValue> {
    // libp2p-identity doesn't expose "from_seed", but it can decode a 64-byte Ed25519 keypair.
    // We deterministically build the keypair bytes via dalek and then import into libp2p.
    use ed25519_dalek::SigningKey;
    let sk = SigningKey::from_bytes(&seed32);
    let vk = sk.verifying_key();
    let mut bytes = [0u8; 64];
    bytes[0..32].copy_from_slice(&seed32);
    bytes[32..64].copy_from_slice(vk.as_bytes());
    let kp = identity::ed25519::Keypair::try_from_bytes(&mut bytes)
        .map_err(|_| JsValue::from_str("failed to import ed25519 keypair bytes"))?;
    Ok(identity::Keypair::from(kp))
}

#[cfg(target_arch = "wasm32")]
pub fn derive_from_mnemonic_12(phrase: &str) -> Result<FinancialIdentity, JsValue> {
    use bip39::{Language, Mnemonic};

    let m = Mnemonic::parse_in(Language::English, phrase.trim())
        .map_err(|_| JsValue::from_str("invalid mnemonic"))?;
    let seed = m.to_seed_normalized(""); // 64 bytes
    let mut seed32 = [0u8; 32];
    seed32.copy_from_slice(&seed[0..32]);
    let kp = keypair_from_seed32(seed32)?;
    let pk = kp
        .public()
        .try_into_ed25519()
        .map_err(|_| JsValue::from_str("derived identity is not ed25519"))?;
    let wallet_id_hex = hex::encode(pk.to_bytes());
    let keypair_proto = kp
        .to_protobuf_encoding()
        .map_err(|e| JsValue::from_str(&format!("keypair encode failed: {e}")))?;
    Ok(FinancialIdentity {
        wallet_id_hex,
        keypair_proto,
    })
}

#[cfg(target_arch = "wasm32")]
pub fn generate_new_mnemonic_12() -> Result<String, JsValue> {
    use bip39::{Language, Mnemonic};
    let m = Mnemonic::generate_in(Language::English, 12)
        .map_err(|e| JsValue::from_str(&format!("mnemonic generate failed: {e}")))?;
    Ok(m.to_string())
}
