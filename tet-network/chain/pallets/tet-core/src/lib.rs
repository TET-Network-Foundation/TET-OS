#![cfg_attr(not(feature = "std"), no_std)]
extern crate alloc;

// TET Core Pallet (Quantum-Resistant AI Reward)
// - Prevent double-claim via `MinedTasks`
// - Reward pot holds 75% of total supply (funded in genesis)
// - `submit_ai_proof` verifies (mock) PQC signature, transfers 5 Stevemon, records task_id

pub use pallet::*;

/// Set when the workspace is built with `--features zk-prove` (propagated from node → runtime → pallet).
#[cfg(feature = "zk-prove")]
pub const ZK_PROVE_ENABLED: bool = true;
#[cfg(not(feature = "zk-prove"))]
pub const ZK_PROVE_ENABLED: bool = false;

pub mod weights;

#[frame_support::pallet]
pub mod pallet {
  use alloc::vec::Vec;
  use crate::weights::WeightInfo;
  use frame_support::{
    pallet_prelude::*,
    traits::{Currency, ExistenceRequirement, Get},
    PalletId,
  };
  use frame_system::pallet_prelude::*;
  use sp_core::{ed25519, Pair as _, H256};
  use sp_runtime::traits::AccountIdConversion;
  use frame_support::BoundedVec;
  use frame_support::pallet_prelude::ConstU32;
  use dilithium::{MlDsaKeyPair, MlDsaSignature, ML_DSA_44};
  use sp1_verifier::Groth16Verifier;
  use sp_core::crypto::AccountId32;

  pub type Balance = u128;

  // Economics constants (decimals=6; 1 TET = 1,000,000 Stevemon).
  pub const STEVEMON: Balance = 1;
  pub const TET: Balance = 1_000_000 * STEVEMON;

  pub const TOTAL_SUPPLY_TET: Balance = 10_000_000_000;
  pub const TOTAL_SUPPLY_STEVEMON: Balance = TOTAL_SUPPLY_TET * TET; // 10^10 * 10^6 = 10^16

  pub const REWARD_POT_PERCENT: Balance = 75;
  pub const REWARD_POT_STEVEMON: Balance = (TOTAL_SUPPLY_STEVEMON / 100) * REWARD_POT_PERCENT;

  pub const AI_REWARD_STEVEMON: Balance = 5;
  pub const BURN_FEE_PERCENT: Balance = 50;
  pub const DEFAULT_SLASH_LAMBDA: Balance = 10;

  /// Phase 0: strict model id max length.
  pub type ModelIdMaxLen = ConstU32<64>;
  /// Ed25519 signature is always 64 bytes.
  pub type Ed25519SigMaxLen = ConstU32<64>;
  /// ML-DSA-44 public key is provided in tagged form: `[mode_tag | pk]`.
  /// For ML-DSA-44, pk is 1312 bytes, so tagged length is 1313.
  pub type Mldsa44PubkeyMaxLen = ConstU32<1313>;
  /// ML-DSA-44 signature length is 2420 bytes (FIPS 204).
  pub type Mldsa44SigMaxLen = ConstU32<2420>;
  /// SP1 proof bytes (Groth16) upper bound for Phase 0.
  pub type ZkProofMaxLen = ConstU32<200_000>;
  /// SP1 public inputs upper bound for Phase 0.
  pub type ZkPublicInputsMaxLen = ConstU32<16_384>;
  /// `vk.bytes32()` is typically "0x" + 64 hex chars.
  pub type Sp1VkeyHashMaxLen = ConstU32<66>;
  /// Memo max length for `transfer_with_memo`.
  pub type MemoMaxLen = ConstU32<128>;
  /// Raw destination bytes max length (either 20-byte hex or 32-byte AccountId32).
  pub type DestBytesMaxLen = ConstU32<32>;

  #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
  pub enum ZkCourtStatus {
    Open,
    EvidenceSubmitted,
    Finalized,
  }

  #[derive(Clone, Encode, Decode, Eq, PartialEq, RuntimeDebug, TypeInfo, MaxEncodedLen)]
  pub struct ZkCourtCase<AccountId> {
    pub challenger: AccountId,
    pub accused: AccountId,
    pub task_id: H256,
    pub status: ZkCourtStatus,
  }

  #[pallet::config]
  pub trait Config: frame_system::Config<AccountId = AccountId32> {
    type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;

    type Currency: Currency<Self::AccountId, Balance = Balance>;

    /// PalletId used to derive the reward pot account.
    #[pallet::constant]
    type RewardPotPalletId: Get<PalletId>;

    type WeightInfo: crate::weights::WeightInfo;
  }

  #[pallet::pallet]
  pub struct Pallet<T>(_);

  /// Task IDs already mined/claimed to prevent double-claim.
  #[pallet::storage]
  pub type MinedTasks<T: Config> = StorageMap<_, Blake2_128Concat, H256, (), OptionQuery>;

  #[pallet::storage]
  pub type SlashLambda<T: Config> = StorageValue<_, Balance, ValueQuery>;

  #[pallet::storage]
  pub type SlashingLedger<T: Config> =
    StorageMap<_, Blake2_128Concat, T::AccountId, Balance, ValueQuery>;

  #[pallet::storage]
  pub type ZkCourtCases<T: Config> =
    StorageMap<_, Blake2_128Concat, H256, ZkCourtCase<T::AccountId>, OptionQuery>;

  /// Total burned fees (in the smallest balance unit).
  #[pallet::storage]
  pub type TotalBurned<T: Config> = StorageValue<_, Balance, ValueQuery>;

  /// Replay protection: (worker_pubkey, nonce) can be used at most once.
  #[pallet::storage]
  pub type UsedNonces<T: Config> = StorageDoubleMap<
    _,
    Blake2_128Concat,
    [u8; 32],
    Blake2_128Concat,
    u64,
    (),
    OptionQuery
  >;

  /// Settlement log per task (Phase 0).
  #[pallet::storage]
  pub type Settlements<T: Config> = StorageMap<
    _,
    Blake2_128Concat,
    H256,
    tet_primitives::SettlementRecord,
    OptionQuery
  >;

  #[pallet::event]
  #[pallet::generate_deposit(pub(super) fn deposit_event)]
  pub enum Event<T: Config> {
    AiProofAccepted { worker: T::AccountId, task_id: H256, ai_result_hash: H256 },
    RewardIssued { worker: T::AccountId, amount_stevemon: Balance },
    SlashLambdaUpdated { lambda: Balance },
    ZkCourtOpened { task_id: H256, challenger: T::AccountId, accused: T::AccountId },
    ZkCourtEvidenceSubmitted { task_id: H256, submitter: T::AccountId, evidence_hash: H256 },
    ZkCourtFinalized { task_id: H256, accepted: bool },
    WorkerSlashed {
      worker: T::AccountId,
      task_id: H256,
      expected_reward_stevemon: Balance,
      slash_amount_stevemon: Balance,
      lambda: Balance,
    },
    ReceiptSettled {
      task_id: H256,
      accepted: bool,
      reward_paid_stevemon: Balance,
      burned_stevemon: Balance,
    },
    MemoSent {
      from: T::AccountId,
      dest: T::AccountId,
      value: Balance,
      memo: Vec<u8>,
    },
  }

  #[pallet::error]
  pub enum Error<T> {
    AlreadyMined,
    InvalidProof,
    RewardPotEmpty,
    TransferFailed,
    CaseNotFound,
    InvalidCaseState,
    NotAuthorized,
    NonceAlreadyUsed,
    BadEd25519Signature,
    BadMldsaSignature,
    BadMldsaPubkey,
    BadMldsaSignatureFormat,
    BadSp1VkeyHash,
    ZkProofInvalid,
    MemoTooLong,
    BadDestBytes,
  }

  #[pallet::call]
  impl<T: Config> Pallet<T> {
    /// Transfer funds and emit an on-chain memo event.
    ///
    /// - Internally performs a `Currency::transfer` (Balances transfer in this runtime).
    /// - Emits `MemoSent` if the transfer succeeds.
    /// - Memo is limited to 128 bytes.
    #[pallet::call_index(12)]
    #[pallet::weight(T::WeightInfo::transfer_with_memo(memo.len() as u32))]
    pub fn transfer_with_memo(
      origin: OriginFor<T>,
      dest: T::AccountId,
      value: Balance,
      memo: Vec<u8>,
    ) -> DispatchResult {
      let from = ensure_signed(origin)?;
      ensure!(memo.len() <= 128, Error::<T>::MemoTooLong);
      T::Currency::transfer(&from, &dest, value, ExistenceRequirement::KeepAlive)
        .map_err(|_| Error::<T>::TransferFailed)?;
      Self::deposit_event(Event::<T>::MemoSent { from, dest, value, memo });
      Ok(())
    }

    /// Raw destination variant for UI hex compatibility.
    ///
    /// Accepts 20-byte (Ethereum-style) or 32-byte (AccountId32) and pads 20->32 with zeros.
    #[pallet::call_index(13)]
    #[pallet::weight(T::WeightInfo::transfer_with_memo_raw(dest.len() as u32, memo.len() as u32))]
    pub fn transfer_with_memo_raw(
      origin: OriginFor<T>,
      dest: BoundedVec<u8, DestBytesMaxLen>,
      value: Balance,
      memo: Vec<u8>,
    ) -> DispatchResult {
      let dest_id = Self::account_id_from_20_or_32(dest.as_slice())?;
      Self::transfer_with_memo(origin, dest_id, value, memo)
    }
    /// ZK-Court: submit a real zk proof and verify it on-chain.
    ///
    /// This verifies an SP1 Groth16 proof using `sp1-verifier` (BN254).
    #[pallet::call_index(11)]
    #[pallet::weight(T::WeightInfo::submit_zk_challenge(
      proof.len() as u32,
      public_inputs.len() as u32,
      sp1_vkey_hash.len() as u32,
    ))]
    pub fn submit_zk_challenge(
      origin: OriginFor<T>,
      task_id: H256,
      proof: BoundedVec<u8, ZkProofMaxLen>,
      public_inputs: BoundedVec<u8, ZkPublicInputsMaxLen>,
      sp1_vkey_hash: BoundedVec<u8, Sp1VkeyHashMaxLen>,
    ) -> DispatchResult {
      let challenger = ensure_signed(origin)?;

      // Require an open case by this challenger.
      ZkCourtCases::<T>::try_mutate(task_id, |c| -> DispatchResult {
        let case = c.as_mut().ok_or(Error::<T>::CaseNotFound)?;
        ensure!(matches!(case.status, ZkCourtStatus::Open), Error::<T>::InvalidCaseState);
        ensure!(case.challenger == challenger, Error::<T>::NotAuthorized);

        let hash_str = core::str::from_utf8(sp1_vkey_hash.as_slice())
          .map_err(|_| Error::<T>::BadSp1VkeyHash)?;

        // Verify mathematically.
        Groth16Verifier::verify(
          proof.as_slice(),
          public_inputs.as_slice(),
          hash_str,
          &sp1_verifier::GROTH16_VK_BYTES,
        )
        .map_err(|_| Error::<T>::ZkProofInvalid)?;

        // If the proof verifies, we accept the evidence and finalize.
        case.status = ZkCourtStatus::Finalized;
        Ok(())
      })?;

      Self::deposit_event(Event::<T>::ZkCourtFinalized { task_id, accepted: true });
      Ok(())
    }
    /// Phase 0: submit a real inference receipt and settle on-chain.
    ///
    /// Brutal path: verifies BOTH Ed25519 + ML-DSA (FIPS 204 / Dilithium) signatures.
    #[pallet::call_index(10)]
    #[pallet::weight(T::WeightInfo::submit_inference_receipt(
      model_id.len() as u32,
      worker_signature.len() as u32,
      mldsa_pubkey.len() as u32,
      mldsa_signature.len() as u32,
    ))]
    pub fn submit_inference_receipt(
      origin: OriginFor<T>,
      task_id: H256,
      worker_pubkey: [u8; 32],
      model_id: BoundedVec<u8, ModelIdMaxLen>,
      input_hash: [u8; 32],
      output_hash: [u8; 32],
      nonce: u64,
      worker_signature: BoundedVec<u8, Ed25519SigMaxLen>,
      mldsa_pubkey: BoundedVec<u8, Mldsa44PubkeyMaxLen>,
      mldsa_signature: BoundedVec<u8, Mldsa44SigMaxLen>,
    ) -> DispatchResult {
      let _caller = ensure_signed(origin)?;

      // 1) Dedup by task id.
      ensure!(!MinedTasks::<T>::contains_key(task_id), Error::<T>::AlreadyMined);

      // 2) Replay protection by (worker_pubkey, nonce).
      ensure!(
        !UsedNonces::<T>::contains_key(worker_pubkey, nonce),
        Error::<T>::NonceAlreadyUsed
      );

      // 3) Canonical signing message (same for both signatures).
      let msg = Self::receipt_signing_message(
        &task_id,
        &worker_pubkey,
        &model_id,
        &input_hash,
        &output_hash,
        nonce,
      );

      // 4) Verify Ed25519 signature (real).
      let pubkey = ed25519::Public::from_raw(worker_pubkey);
      let sig_raw: [u8; 64] = worker_signature
        .as_slice()
        .try_into()
        .map_err(|_| Error::<T>::BadEd25519Signature)?;
      let sig = ed25519::Signature::from_raw(sig_raw);
      ensure!(ed25519::Pair::verify(&sig, &msg, &pubkey), Error::<T>::BadEd25519Signature);

      // 5) Verify ML-DSA signature (real).
      // Public key is passed in tagged form so we can validate the mode.
      let (mode, pk) = MlDsaKeyPair::from_public_key(mldsa_pubkey.as_slice())
        .map_err(|_| Error::<T>::BadMldsaPubkey)?;
      ensure!(mode == ML_DSA_44, Error::<T>::BadMldsaPubkey);

      let mldsa_sig = MlDsaSignature::from_slice(mldsa_signature.as_slice());
      let ok = MlDsaKeyPair::verify(&pk, &mldsa_sig, &msg, b"", ML_DSA_44);
      ensure!(ok, Error::<T>::BadMldsaSignature);

      // 6) Settle: pay fixed reward from pot (Phase 0).
      let pot = Self::reward_pot_account();
      let pot_free = T::Currency::free_balance(&pot);
      ensure!(pot_free >= AI_REWARD_STEVEMON, Error::<T>::RewardPotEmpty);
      T::Currency::transfer(&pot, &_caller, AI_REWARD_STEVEMON, ExistenceRequirement::KeepAlive)
        .map_err(|_| Error::<T>::TransferFailed)?;

      UsedNonces::<T>::insert(worker_pubkey, nonce, ());
      MinedTasks::<T>::insert(task_id, ());

      let rec = tet_primitives::SettlementRecord {
        task_id,
        accepted: true,
        reward_paid_stevemon: AI_REWARD_STEVEMON,
        burned_stevemon: 0,
      };
      Settlements::<T>::insert(task_id, rec);

      Self::deposit_event(Event::<T>::ReceiptSettled {
        task_id,
        accepted: true,
        reward_paid_stevemon: AI_REWARD_STEVEMON,
        burned_stevemon: 0,
      });
      Ok(())
    }

    /// Submit an AI proof for a given task.
    ///
    /// Brutal path: verifies real ML-DSA (FIPS 204 / Dilithium).
    #[pallet::call_index(0)]
    #[pallet::weight(T::WeightInfo::submit_ai_proof())]
    pub fn submit_ai_proof(
      origin: OriginFor<T>,
      task_id: H256,
      ai_result_hash: H256,
      mldsa_pubkey: BoundedVec<u8, Mldsa44PubkeyMaxLen>,
      mldsa_signature: BoundedVec<u8, Mldsa44SigMaxLen>,
    ) -> DispatchResult {
      let worker = ensure_signed(origin)?;

      ensure!(!MinedTasks::<T>::contains_key(task_id), Error::<T>::AlreadyMined);
      let msg = Self::ai_proof_signing_message(&task_id, &ai_result_hash);
      let (mode, pk) = MlDsaKeyPair::from_public_key(mldsa_pubkey.as_slice())
        .map_err(|_| Error::<T>::BadMldsaPubkey)?;
      ensure!(mode == ML_DSA_44, Error::<T>::BadMldsaPubkey);
      let sig = MlDsaSignature::from_slice(mldsa_signature.as_slice());
      ensure!(
        MlDsaKeyPair::verify(&pk, &sig, &msg, b"", ML_DSA_44),
        Error::<T>::InvalidProof
      );

      let pot = Self::reward_pot_account();

      // Transfer 5 Stevemon from reward pot to worker.
      // NOTE: This assumes the pot is funded at genesis with REWARD_POT_STEVEMON.
      let pot_free = T::Currency::free_balance(&pot);
      ensure!(pot_free >= AI_REWARD_STEVEMON, Error::<T>::RewardPotEmpty);

      T::Currency::transfer(&pot, &worker, AI_REWARD_STEVEMON, ExistenceRequirement::KeepAlive)
        .map_err(|_| Error::<T>::TransferFailed)?;

      MinedTasks::<T>::insert(task_id, ());

      Self::deposit_event(Event::<T>::AiProofAccepted { worker: worker.clone(), task_id, ai_result_hash });
      Self::deposit_event(Event::<T>::RewardIssued { worker, amount_stevemon: AI_REWARD_STEVEMON });
      Ok(())
    }

    #[pallet::call_index(1)]
    #[pallet::weight(T::WeightInfo::set_slash_lambda())]
    pub fn set_slash_lambda(origin: OriginFor<T>, lambda: Balance) -> DispatchResult {
      ensure_root(origin)?;
      SlashLambda::<T>::put(lambda);
      Self::deposit_event(Event::<T>::SlashLambdaUpdated { lambda });
      Ok(())
    }

    #[pallet::call_index(2)]
    #[pallet::weight(T::WeightInfo::open_zk_court_case())]
    pub fn open_zk_court_case(
      origin: OriginFor<T>,
      task_id: H256,
      accused: T::AccountId,
    ) -> DispatchResult {
      let challenger = ensure_signed(origin)?;
      let case = ZkCourtCase::<T::AccountId> {
        challenger: challenger.clone(),
        accused: accused.clone(),
        task_id,
        status: ZkCourtStatus::Open,
      };
      ZkCourtCases::<T>::insert(task_id, case);
      Self::deposit_event(Event::<T>::ZkCourtOpened { task_id, challenger, accused });
      Ok(())
    }

    #[pallet::call_index(3)]
    #[pallet::weight(T::WeightInfo::submit_zk_evidence())]
    pub fn submit_zk_evidence(
      origin: OriginFor<T>,
      task_id: H256,
      evidence_hash: H256,
    ) -> DispatchResult {
      let submitter = ensure_signed(origin)?;
      ZkCourtCases::<T>::try_mutate(task_id, |c| -> DispatchResult {
        let case = c.as_mut().ok_or(Error::<T>::CaseNotFound)?;
        ensure!(matches!(case.status, ZkCourtStatus::Open), Error::<T>::InvalidCaseState);
        ensure!(submitter == case.challenger || submitter == case.accused, Error::<T>::NotAuthorized);
        case.status = ZkCourtStatus::EvidenceSubmitted;
        Ok(())
      })?;
      Self::deposit_event(Event::<T>::ZkCourtEvidenceSubmitted { task_id, submitter, evidence_hash });
      Ok(())
    }

    #[pallet::call_index(4)]
    #[pallet::weight(T::WeightInfo::finalize_zk_court_case())]
    pub fn finalize_zk_court_case(
      origin: OriginFor<T>,
      task_id: H256,
      accepted: bool,
    ) -> DispatchResult {
      ensure_root(origin)?;
      ZkCourtCases::<T>::try_mutate(task_id, |c| -> DispatchResult {
        let case = c.as_mut().ok_or(Error::<T>::CaseNotFound)?;
        ensure!(matches!(case.status, ZkCourtStatus::EvidenceSubmitted), Error::<T>::InvalidCaseState);
        case.status = ZkCourtStatus::Finalized;
        Ok(())
      })?;
      Self::deposit_event(Event::<T>::ZkCourtFinalized { task_id, accepted });
      Ok(())
    }

    #[pallet::call_index(5)]
    #[pallet::weight(T::WeightInfo::slash_worker())]
    pub fn slash_worker(
      origin: OriginFor<T>,
      worker: T::AccountId,
      task_id: H256,
      expected_reward_stevemon: Balance,
    ) -> DispatchResult {
      ensure_root(origin)?;
      let lambda = Self::effective_slash_lambda();
      let slash_amount_stevemon = expected_reward_stevemon.saturating_mul(lambda);
      SlashingLedger::<T>::mutate(worker.clone(), |v| *v = v.saturating_add(slash_amount_stevemon));
      Self::deposit_event(Event::<T>::WorkerSlashed {
        worker,
        task_id,
        expected_reward_stevemon,
        slash_amount_stevemon,
        lambda,
      });
      Ok(())
    }
  }

  impl<T: Config> Pallet<T> {
    pub fn reward_pot_account() -> T::AccountId {
      T::RewardPotPalletId::get().into_account_truncating()
    }

    /// Called by runtime fee handling to persist burn accounting.
    pub fn record_burn(amount: Balance) {
      if amount == 0 { return; }
      TotalBurned::<T>::mutate(|v| *v = v.saturating_add(amount));
    }

    fn ai_proof_signing_message(task_id: &H256, ai_result_hash: &H256) -> [u8; 32] {
      use sp_io::hashing::blake2_256;
      let mut v = Vec::with_capacity(64);
      v.extend_from_slice(b"TET::AI_PROOF::V0");
      v.extend_from_slice(task_id.as_bytes());
      v.extend_from_slice(ai_result_hash.as_bytes());
      blake2_256(&v)
    }

    fn receipt_signing_message(
      task_id: &H256,
      worker_pubkey: &[u8; 32],
      model_id: &[u8],
      input_hash: &[u8; 32],
      output_hash: &[u8; 32],
      nonce: u64,
    ) -> [u8; 32] {
      use sp_io::hashing::blake2_256;
      let mut v = Vec::with_capacity(64 + model_id.len());
      v.extend_from_slice(b"TET::INFERENCE_RECEIPT::V0");
      v.extend_from_slice(task_id.as_bytes());
      v.extend_from_slice(worker_pubkey);
      v.extend_from_slice(model_id);
      v.extend_from_slice(input_hash);
      v.extend_from_slice(output_hash);
      v.extend_from_slice(&nonce.to_le_bytes());
      blake2_256(&v)
    }

    fn effective_slash_lambda() -> Balance {
      let current = SlashLambda::<T>::get();
      if current == 0 { DEFAULT_SLASH_LAMBDA } else { current }
    }

    fn account_id_from_20_or_32(raw: &[u8]) -> Result<T::AccountId, DispatchError> {
      if raw.len() == 32 {
        let mut a = [0u8; 32];
        a.copy_from_slice(raw);
        let acc32 = AccountId32::from(a);
        return Ok(acc32.into());
      }
      if raw.len() == 20 {
        let mut a = [0u8; 32];
        a[..20].copy_from_slice(raw);
        let acc32 = AccountId32::from(a);
        return Ok(acc32.into());
      }
      Err(Error::<T>::BadDestBytes.into())
    }
  }
}

