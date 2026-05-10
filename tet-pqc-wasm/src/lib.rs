use wasm_bindgen::prelude::*;

#[cfg(target_arch = "wasm32")]
use js_sys::{Object, Reflect};

#[cfg(target_arch = "wasm32")]
use base64::Engine as _;

#[cfg(target_arch = "wasm32")]
use dilithium::{DilithiumSignature, ML_DSA_44, MlDsaKeyPair};

#[cfg(target_arch = "wasm32")]
use hkdf::Hkdf;

#[cfg(target_arch = "wasm32")]
use sha2::{Digest as _, Sha256};

#[cfg(target_arch = "wasm32")]
use zeroize::Zeroizing;

#[cfg(target_arch = "wasm32")]
fn mldsa44_seed32_from_mnemonic(mnemonic: &str) -> Result<[u8; 32], JsValue> {
    let m = bip39::Mnemonic::parse_in(bip39::Language::English, mnemonic.trim())
        .map_err(|_| JsValue::from_str("invalid mnemonic"))?;
    let seed = Zeroizing::new(m.to_seed(""));
    let hk = Hkdf::<Sha256>::new(None, seed.as_ref());
    let mut out = [0u8; 32];
    hk.expand(b"tet:pqc:mldsa44-seed:v1", &mut out)
        .map_err(|_| JsValue::from_str("hkdf expand failed"))?;
    Ok(out)
}

#[cfg(target_arch = "wasm32")]
fn mldsa44_signing_rnd(msg: &[u8]) -> [u8; 32] {
    let mut h = Sha256::new();
    h.update(b"tet:mldsa44-signing-rnd:v1");
    h.update(msg);
    h.finalize().into()
}

#[wasm_bindgen]
pub fn mldsa44_keypair_from_mnemonic_b64(mnemonic12: String) -> Result<JsValue, JsValue> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = mnemonic12;
        return Err(JsValue::from_str(
            "mldsa44 wasm not available on this target",
        ));
    }
    #[cfg(target_arch = "wasm32")]
    {
        let seed32 = mldsa44_seed32_from_mnemonic(&mnemonic12)?;
        let kp = MlDsaKeyPair::generate_deterministic(ML_DSA_44, &seed32);
        let pubkey_b64 = base64::engine::general_purpose::STANDARD.encode(kp.public_key());
        // Store the full keypair bytes (mode_tag|pk|sk) so we can reconstruct safely.
        let keypair_b64 = base64::engine::general_purpose::STANDARD.encode(kp.to_bytes());
        let o = Object::new();
        Reflect::set(
            &o,
            &JsValue::from_str("pubkey_b64"),
            &JsValue::from_str(&pubkey_b64),
        )?;
        Reflect::set(
            &o,
            &JsValue::from_str("keypair_b64"),
            &JsValue::from_str(&keypair_b64),
        )?;
        Ok(o.into())
    }
}

#[wasm_bindgen]
pub fn mldsa44_sign_deterministic_b64(
    keypair_b64: String,
    msg_bytes: Vec<u8>,
) -> Result<String, JsValue> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (keypair_b64, msg_bytes);
        return Err(JsValue::from_str(
            "mldsa44 wasm not available on this target",
        ));
    }
    #[cfg(target_arch = "wasm32")]
    {
        let kp_bytes = base64::engine::general_purpose::STANDARD
            .decode(keypair_b64.trim().as_bytes())
            .map_err(|_| JsValue::from_str("bad keypair_b64"))?;
        let kp = MlDsaKeyPair::from_bytes(&kp_bytes)
            .map_err(|_| JsValue::from_str("failed to parse keypair"))?;
        let rnd = mldsa44_signing_rnd(&msg_bytes);
        let sig = kp
            .sign_deterministic(&msg_bytes, b"", &rnd)
            .map_err(|_| JsValue::from_str("mldsa sign failed"))?;
        Ok(base64::engine::general_purpose::STANDARD.encode(sig.as_bytes()))
    }
}

#[wasm_bindgen]
pub fn mldsa44_verify_b64(
    pubkey_b64: String,
    sig_b64: String,
    msg_bytes: Vec<u8>,
) -> Result<bool, JsValue> {
    #[cfg(not(target_arch = "wasm32"))]
    {
        let _ = (pubkey_b64, sig_b64, msg_bytes);
        return Ok(false);
    }
    #[cfg(target_arch = "wasm32")]
    {
        let pk = base64::engine::general_purpose::STANDARD
            .decode(pubkey_b64.trim().as_bytes())
            .map_err(|_| JsValue::from_str("bad pubkey_b64"))?;
        let sig_bytes = base64::engine::general_purpose::STANDARD
            .decode(sig_b64.trim().as_bytes())
            .map_err(|_| JsValue::from_str("bad sig_b64"))?;
        let sig = DilithiumSignature::from_slice(&sig_bytes);
        Ok(MlDsaKeyPair::verify(&pk, &sig, &msg_bytes, b"", ML_DSA_44))
    }
}
