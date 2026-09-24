//! Phase 2.3 foundation: Host-side "ZK-Supreme Court" verifier (RISC Zero API shape).
//!
//! Guest compilation may be bypassed via `RISC0_SKIP_BUILD=1`.

use base64::Engine as _;
pub use nexus_protocol::{InferenceJournalV1, TmailAnonMembershipV1, ZkCourtJournalV1};
use risc0_zkvm::Receipt;

/// **Compile-time guard: a `zk-prove` build must embed a real guest.**
///
/// `risc0-build` skips embedding when `RISC0_SKIP_BUILD` is merely *set*, regardless of value, so
/// `RISC0_SKIP_BUILD=0` — which the Dockerfile and `zk-image.yml` both pass meaning "do build the
/// guest" — once produced `NEXUS_GUEST_ELF = &[]` and `NEXUS_GUEST_ID = [0; 8]` **while the build
/// went green**. The node then started normally, refused to prove with "guest ELF empty", and
/// verified receipts against an all-zero image id. The zk image that passed CI on 2026-09-22 had
/// exactly this shape.
///
/// `methods/build.rs` now removes the variable before calling `embed_methods`, but a build-script
/// fix is only as good as the next person not reintroducing it. This assertion makes the broken
/// state **unrepresentable**: any build carrying `--features zk-prove` fails to compile rather than
/// producing a node that cannot prove. It covers the Docker image, CI and local builds alike, which
/// a CI-only check would not.
///
/// It is deliberately compile-time rather than a test: a test can be skipped, and this one was —
/// every ZK test in the repo runs on `MOCKJ1:`/`MOCKZC1:` mocks, which is why the empty guest
/// survived for months.
#[cfg(feature = "zk-prove")]
const _: () = {
    assert!(
        !methods::NEXUS_GUEST_ELF.is_empty(),
        "zk-prove build has an empty NEXUS_GUEST_ELF: the guest was not embedded. \
         RISC0_SKIP_BUILD must be UNSET (not 0) for risc0-build, see methods/build.rs."
    );
    let id = methods::NEXUS_GUEST_ID;
    let mut i = 0usize;
    let mut any_nonzero = false;
    while i < 8 {
        if id[i] != 0 {
            any_nonzero = true;
        }
        i += 1;
    }
    assert!(
        any_nonzero,
        "zk-prove build has an all-zero NEXUS_GUEST_ID: receipts would verify against a null \
         image id. RISC0_SKIP_BUILD must be UNSET (not 0), see methods/build.rs."
    );
};

#[derive(Debug, Clone)]
pub enum VerifiedZkJournal {
    Inference(InferenceJournalV1),
    ZkCourt(ZkCourtJournalV1),
    /// Tmail anonymous **membership** proof, hash-only (spec §A.4.3, guest mode 3).
    TmailAnon(TmailAnonMembershipV1),
}

/// Whether dev/test mock ZK receipts (`MOCKJ1:` / `MOCKZC1:`) and ZK-Court optimistic placeholders are allowed.
pub fn zk_dev_mock_allowed() -> bool {
    mock_zk_allowed()
}

fn mock_zk_allowed() -> bool {
    let mainnet = std::env::var("TET_MAINNET")
        .ok()
        .as_deref()
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    if mainnet {
        let allow_mock = std::env::var("TET_ALLOW_MOCK_ZK")
            .ok()
            .as_deref()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        if allow_mock {
            panic!("CRITICAL: TET_MAINNET=1 forbids TET_ALLOW_MOCK_ZK=1.");
        }
        return false;
    }
    cfg!(test)
        || matches!(
            std::env::var("TET_ALLOW_MOCK_ZK")
                .ok()
                .as_deref()
                .map(str::trim),
            Some("1") | Some("true") | Some("TRUE") | Some("yes") | Some("YES")
        )
}

/// Decode a **real receipt's** journal into its typed form.
///
/// # Journals are risc0 serde, not bincode
///
/// `env::commit` serializes with **risc0's word-aligned serde**, so a journal that `bincode` would
/// write in 72 bytes arrives as 264 (each `u8` of a `[u8; 32]` becomes a 4-byte word). This
/// function previously used `bincode::deserialize`, which is wrong in the worst possible way:
/// bincode **succeeds** on those 264 bytes, consuming the first 72 and returning a struct full of
/// garbage. It did not error — it returned a confidently wrong journal.
///
/// The consequence was not cosmetic. `consensus::compute_reward_for_block` reads
/// `ZkCourtJournalV1::flops_u64` out of a verified journal and folds it into the block reward, so a
/// real ZK-Court receipt would have contributed a nonsense FLOPs value to consensus. It stayed
/// hidden because every ZK test in this repo uses `MOCKJ1:`/`MOCKZC1:` receipts, whose "journals"
/// are bincode by construction — the mock path and the real path disagreed about the wire format
/// and only the mock path was ever exercised.
///
/// # Length collisions are real, so every decode is round-tripped
///
/// Journal types of equal length are a live hazard here: the removed mode-2 journal was 264 bytes
/// under risc0 serde, exactly like `ZkCourtJournalV1`, and a byte-level permutation of it — decoding
/// one as the other succeeded *and* re-serialized identically. Each candidate is therefore
/// re-serialized and compared against the original bytes, and the Tmail journal additionally
/// carries a checked `journal_kind` tag so length alone never decides.
pub(crate) fn decode_journal_bytes(bytes: &[u8]) -> anyhow::Result<VerifiedZkJournal> {
    fn round_trips<T: serde::Serialize + serde::de::DeserializeOwned>(
        bytes: &[u8],
    ) -> Option<T> {
        let decoded: T = risc0_zkvm::serde::from_slice(bytes).ok()?;
        let words = risc0_zkvm::serde::to_vec(&decoded).ok()?;
        let mut re = Vec::with_capacity(words.len() * 4);
        for w in &words {
            re.extend_from_slice(&w.to_le_bytes());
        }
        if re == bytes { Some(decoded) } else { None }
    }

    if let Some(j) = round_trips::<InferenceJournalV1>(bytes) {
        return Ok(VerifiedZkJournal::Inference(j));
    }
    if let Some(j) = round_trips::<TmailAnonMembershipV1>(bytes)
        && j.journal_kind == nexus_protocol::TMAIL_ANON_JOURNAL_KIND
    {
        return Ok(VerifiedZkJournal::TmailAnon(j));
    }
    if let Some(j) = round_trips::<ZkCourtJournalV1>(bytes) {
        return Ok(VerifiedZkJournal::ZkCourt(j));
    }
    Err(anyhow::anyhow!(
        "journal is not a recognised TET journal type (expected risc0-serde encoding)"
    ))
}

pub fn verify_tx_receipt_and_journal(
    image_id: [u32; 8],
    journal_b64: &str,
    receipt_b64: &str,
) -> anyhow::Result<VerifiedZkJournal> {
    let supplied_journal = base64::engine::general_purpose::STANDARD
        .decode(journal_b64.as_bytes())
        .map_err(|e| anyhow::anyhow!("Failed to decode journal b64: {e}"))?;

    if let Some(rest) = receipt_b64.strip_prefix("MOCKJ1:") {
        if !mock_zk_allowed() {
            return Err(anyhow::anyhow!(
                "mock zk receipt rejected; set TET_ALLOW_MOCK_ZK=1 for dev/test"
            ));
        }
        if image_id != methods::NEXUS_GUEST_ID {
            return Err(anyhow::anyhow!("image_id mismatch"));
        }
        let receipt_journal = base64::engine::general_purpose::STANDARD
            .decode(rest.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to decode MOCKJ1 b64: {e}"))?;
        if supplied_journal != receipt_journal {
            return Err(anyhow::anyhow!(
                "journal_b64 does not match receipt journal"
            ));
        }
        let j = bincode::deserialize::<InferenceJournalV1>(&receipt_journal)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize MOCKJ1 journal: {e}"))?;
        return Ok(VerifiedZkJournal::Inference(j));
    }

    if let Some(rest) = receipt_b64.strip_prefix("MOCKZC1:") {
        if !mock_zk_allowed() {
            return Err(anyhow::anyhow!(
                "mock zk receipt rejected; set TET_ALLOW_MOCK_ZK=1 for dev/test"
            ));
        }
        if image_id != methods::NEXUS_GUEST_ID {
            return Err(anyhow::anyhow!("image_id mismatch"));
        }
        let receipt_journal = base64::engine::general_purpose::STANDARD
            .decode(rest.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to decode MOCKZC1 b64: {e}"))?;
        if supplied_journal != receipt_journal {
            return Err(anyhow::anyhow!(
                "journal_b64 does not match receipt journal"
            ));
        }
        let j = bincode::deserialize::<ZkCourtJournalV1>(&receipt_journal)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize MOCKZC1 journal: {e}"))?;
        return Ok(VerifiedZkJournal::ZkCourt(j));
    }

    let receipt_bytes = base64::engine::general_purpose::STANDARD
        .decode(receipt_b64.as_bytes())
        .map_err(|e| anyhow::anyhow!("Failed to decode receipt b64: {e}"))?;
    let receipt: Receipt = bincode::deserialize(&receipt_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to deserialize receipt: {e}"))?;
    receipt
        .verify(image_id)
        .map_err(|e| anyhow::anyhow!("ZK Verification Math Failed: {e:?}"))?;

    if supplied_journal.as_slice() != receipt.journal.bytes.as_slice() {
        return Err(anyhow::anyhow!(
            "journal_b64 does not match receipt journal"
        ));
    }

    decode_journal_bytes(&supplied_journal)
}

pub fn verify_receipt(receipt_b64: &str) -> anyhow::Result<bool> {
    Ok(verify_receipt_with_size(receipt_b64)?.0)
}

pub fn verify_receipt_with_size(receipt_b64: &str) -> anyhow::Result<(bool, usize)> {
    // Dev-mode mock receipt: encoded `InferenceJournalV1` (no cryptographic proof).
    if let Some(rest) = receipt_b64.strip_prefix("MOCKJ1:") {
        if !mock_zk_allowed() {
            return Err(anyhow::anyhow!(
                "mock zk receipt rejected; set TET_ALLOW_MOCK_ZK=1 for dev/test"
            ));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(rest.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to decode MOCKJ1 b64: {e}"))?;
        // Validate it at least deserializes.
        let _j: InferenceJournalV1 = bincode::deserialize(&bytes)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize MOCKJ1 journal: {e}"))?;
        return Ok((true, bytes.len()));
    }

    // 1. Decode base64
    let receipt_bytes = base64::engine::general_purpose::STANDARD
        .decode(receipt_b64.as_bytes())
        .map_err(|e| anyhow::anyhow!("Failed to decode receipt b64: {e}"))?;
    let proof_size = receipt_bytes.len();

    // 2. Deserialize into RISC Zero Receipt
    let receipt: Receipt = bincode::deserialize(&receipt_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to deserialize receipt: {}", e))?;

    // 3. Verify against the Image ID (generated by `methods` crate).
    let image_id = methods::NEXUS_GUEST_ID;
    match receipt.verify(image_id) {
        Ok(_) => Ok((true, proof_size)),
        Err(e) => {
            log::error!("ZK Verification Math Failed: {:?}", e);
            Ok((false, proof_size))
        }
    }
}

#[allow(dead_code)]
pub fn verify_and_extract_inference_journal(
    receipt_b64: &str,
) -> anyhow::Result<InferenceJournalV1> {
    if let Some(rest) = receipt_b64.strip_prefix("MOCKJ1:") {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(rest.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to decode MOCKJ1 b64: {e}"))?;
        let j: InferenceJournalV1 = bincode::deserialize(&bytes)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize MOCKJ1 journal: {e}"))?;
        return Ok(j);
    }
    let receipt_bytes = base64::engine::general_purpose::STANDARD
        .decode(receipt_b64.as_bytes())
        .map_err(|e| anyhow::anyhow!("Failed to decode receipt b64: {e}"))?;
    let receipt: Receipt = bincode::deserialize(&receipt_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to deserialize receipt: {}", e))?;

    // Verify first: do not decode untrusted journal before cryptographic verification.
    let image_id = methods::NEXUS_GUEST_ID;
    receipt
        .verify(image_id)
        .map_err(|e| anyhow::anyhow!("ZK Verification Math Failed: {e:?}"))?;

    receipt
        .journal
        .decode()
        .map_err(|e| anyhow::anyhow!("Failed to decode inference journal: {e:?}"))
}

pub fn verify_and_extract_inference_journal_with_size(
    receipt_b64: &str,
) -> anyhow::Result<(InferenceJournalV1, usize)> {
    if let Some(rest) = receipt_b64.strip_prefix("MOCKJ1:") {
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(rest.as_bytes())
            .map_err(|e| anyhow::anyhow!("Failed to decode MOCKJ1 b64: {e}"))?;
        let proof_size = bytes.len();
        let j: InferenceJournalV1 = bincode::deserialize(&bytes)
            .map_err(|e| anyhow::anyhow!("Failed to deserialize MOCKJ1 journal: {e}"))?;
        return Ok((j, proof_size));
    }
    let receipt_bytes = base64::engine::general_purpose::STANDARD
        .decode(receipt_b64.as_bytes())
        .map_err(|e| anyhow::anyhow!("Failed to decode receipt b64: {e}"))?;
    let proof_size = receipt_bytes.len();
    let receipt: Receipt = bincode::deserialize(&receipt_bytes)
        .map_err(|e| anyhow::anyhow!("Failed to deserialize receipt: {}", e))?;

    let image_id = methods::NEXUS_GUEST_ID;
    receipt
        .verify(image_id)
        .map_err(|e| anyhow::anyhow!("ZK Verification Math Failed: {e:?}"))?;

    let journal: InferenceJournalV1 = receipt
        .journal
        .decode()
        .map_err(|e| anyhow::anyhow!("Failed to decode inference journal: {e:?}"))?;
    Ok((journal, proof_size))
}

/// Test-only alias so guards can exercise the real decoder rather than a copy of it.
#[cfg(test)]
pub(crate) fn decode_journal_bytes_for_tests(bytes: &[u8]) -> anyhow::Result<VerifiedZkJournal> {
    decode_journal_bytes(bytes)
}
