//! FIPS-204 (ML-DSA) conformance vectors — **TET's own**, not the dependency's.
//!
//! `WHITEPAPER.md` §7.1 claims ML-DSA / FIPS 204. That claim rests entirely on `dilithium-rs`,
//! a single-maintainer crate with no published third-party audit. The crate ships its own KATs,
//! but those live in the dependency: if a future version silently stopped matching FIPS-204,
//! TET's build would stay green and the whitepaper claim would quietly become false.
//!
//! This module vendors official **NIST ACVP** vectors into TET's own suite so that cannot happen.
//!
//! # Vector provenance
//!
//! - **Source:** <https://github.com/usnistgov/ACVP-Server/tree/master/gen-val/json-files>
//! - **Files:** `ML-DSA-keyGen-FIPS204/internalProjection.json`,
//!   `ML-DSA-sigVer-FIPS204/internalProjection.json`
//! - **Fetched:** 2026-09-18
//! - **Parameter set:** ML-DSA-44 — the level Phase 0 actually ships (§7.1)
//! - **sigVer group:** `signatureInterface=external, preHash=pure, externalMu=false`, which is the
//!   shape TET uses (`MlDsaKeyPair::verify(pk, sig, msg, ctx, mode)`).
//!
//! Vectors are verbatim from NIST. Nothing here is generated, derived, or hand-written — if a
//! vector needs updating, re-fetch it from the URL above rather than editing the JSON.
//!
//! # What the tests pin
//!
//! | Test | Pins |
//! |------|------|
//! | [`tests::acvp_keygen_ml_dsa_44_matches_fips204`] | ξ → public key derivation, 5 vectors |
//! | [`tests::acvp_sigver_ml_dsa_44_matches_fips204`] | accept/reject, 3 valid + 4 tampered |
//! | [`tests::acvp_sigver_rejects_every_tamper_class`] | each negative class is genuinely rejected |

/// Official NIST ACVP ML-DSA-44 vectors, verbatim. See module docs for provenance.
pub const ACVP_ML_DSA_44_JSON: &str = include_str!("testdata/fips204_acvp_ml_dsa_44.json");

#[cfg(test)]
mod tests {
    use super::ACVP_ML_DSA_44_JSON;
    use dilithium::{DilithiumSignature, ML_DSA_44, MlDsaKeyPair};

    fn vectors() -> serde_json::Value {
        serde_json::from_str(ACVP_ML_DSA_44_JSON).expect("vendored ACVP JSON must parse")
    }

    fn hex_to_bytes(s: &str) -> Vec<u8> {
        hex::decode(s).expect("ACVP hex field must decode")
    }

    /// FIPS-204 key generation: ξ (32-byte seed) → public key, bit-for-bit.
    ///
    /// This is the strongest single check available, because ML-DSA keygen is fully deterministic
    /// from ξ — any deviation in the expansion, NTT, or packing shows up immediately.
    #[test]
    fn acvp_keygen_ml_dsa_44_matches_fips204() {
        let v = vectors();
        let cases = v["keygen"].as_array().expect("keygen array");
        assert!(!cases.is_empty(), "vector file must not be empty");

        for case in cases {
            let tc_id = case["tcId"].as_u64().unwrap_or(0);
            let seed = hex_to_bytes(case["seed"].as_str().expect("seed"));
            let expected_pk = hex_to_bytes(case["pk"].as_str().expect("pk"));

            assert_eq!(seed.len(), 32, "tcId {tc_id}: ML-DSA seed is 32 bytes");
            assert_eq!(
                expected_pk.len(),
                1312,
                "tcId {tc_id}: ML-DSA-44 public key is 1312 bytes"
            );

            let seed32: [u8; 32] = seed
                .as_slice()
                .try_into()
                .expect("ACVP seed is exactly 32 bytes");
            let kp = MlDsaKeyPair::generate_deterministic(ML_DSA_44, &seed32);
            assert_eq!(
                kp.public_key(),
                expected_pk.as_slice(),
                "tcId {tc_id}: keygen diverges from FIPS-204 ACVP. \
                 The dependency no longer matches the standard; WHITEPAPER §7.1's FIPS 204 claim \
                 is not currently true."
            );
        }
    }

    /// FIPS-204 signature verification: accept valid, reject every tampered variant.
    #[test]
    fn acvp_sigver_ml_dsa_44_matches_fips204() {
        let v = vectors();
        let cases = v["sigver"].as_array().expect("sigver array");
        assert!(!cases.is_empty(), "vector file must not be empty");

        for case in cases {
            let tc_id = case["tcId"].as_u64().unwrap_or(0);
            let reason = case["reason"].as_str().unwrap_or("");
            let expected = case["passed"].as_bool().expect("passed");

            let pk = hex_to_bytes(case["pk"].as_str().expect("pk"));
            let msg = hex_to_bytes(case["msg"].as_str().expect("msg"));
            let ctx = hex_to_bytes(case["ctx"].as_str().unwrap_or(""));
            let sig_bytes = hex_to_bytes(case["sig"].as_str().expect("sig"));

            let sig = DilithiumSignature::from_slice(&sig_bytes);
            let got = MlDsaKeyPair::verify(&pk, &sig, &msg, &ctx, ML_DSA_44);

            assert_eq!(
                got, expected,
                "tcId {tc_id} ({reason}): FIPS-204 ACVP expects verify == {expected}, got {got}. \
                 WHITEPAPER §7.1's FIPS 204 claim is not currently true."
            );
        }
    }

    /// Guards against a verifier that accepts everything — which would pass a
    /// positive-only test suite while being catastrophically broken.
    #[test]
    fn acvp_sigver_rejects_every_tamper_class() {
        let v = vectors();
        let cases = v["sigver"].as_array().expect("sigver array");

        let negatives: Vec<_> = cases
            .iter()
            .filter(|c| !c["passed"].as_bool().unwrap_or(true))
            .collect();
        let positives = cases.len() - negatives.len();

        assert!(
            negatives.len() >= 4,
            "vector set must retain negative cases; found {}",
            negatives.len()
        );
        assert!(positives >= 1, "vector set must retain at least one valid signature");

        // Every distinct tamper class NIST supplies must actually be rejected.
        let mut classes: Vec<&str> = negatives
            .iter()
            .map(|c| c["reason"].as_str().unwrap_or(""))
            .collect();
        classes.sort_unstable();
        classes.dedup();
        assert!(
            classes.len() >= 3,
            "expected several distinct tamper classes, got {classes:?}"
        );

        for case in negatives {
            let pk = hex_to_bytes(case["pk"].as_str().expect("pk"));
            let msg = hex_to_bytes(case["msg"].as_str().expect("msg"));
            let ctx = hex_to_bytes(case["ctx"].as_str().unwrap_or(""));
            let sig = DilithiumSignature::from_slice(&hex_to_bytes(case["sig"].as_str().expect("sig")));
            assert!(
                !MlDsaKeyPair::verify(&pk, &sig, &msg, &ctx, ML_DSA_44),
                "tcId {} ({}) must be rejected",
                case["tcId"],
                case["reason"]
            );
        }
    }

    /// The level TET verifies is inferred from public-key length (WP §7.1). Pin that mapping
    /// against a real FIPS-204 key so the inference cannot drift.
    #[test]
    fn acvp_public_key_length_implies_ml_dsa_44() {
        let v = vectors();
        let pk = hex_to_bytes(v["keygen"][0]["pk"].as_str().expect("pk"));
        assert_eq!(pk.len(), ML_DSA_44.public_key_bytes());
        assert_eq!(
            crate::wallet::infer_mldsa_mode_from_raw_pubkey(&pk).map(|m| m.public_key_bytes()),
            Some(ML_DSA_44.public_key_bytes()),
            "a genuine ML-DSA-44 public key must be inferred as level 44"
        );
    }
}
