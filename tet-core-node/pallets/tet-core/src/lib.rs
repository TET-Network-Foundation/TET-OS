#![cfg_attr(not(feature = "std"), no_std)]

extern crate alloc;

pub use pallet::*;

/// Set when the workspace is built with `--features zk-prove` (propagated from node → runtime → pallet).
#[cfg(feature = "zk-prove")]
pub const ZK_PROVE_ENABLED: bool = true;
#[cfg(not(feature = "zk-prove"))]
pub const ZK_PROVE_ENABLED: bool = false;

#[cfg(feature = "runtime-benchmarks")]
mod benchmarking;

#[cfg(test)]
mod mock;

#[cfg(test)]
mod tests;

pub mod weights;
pub use weights::*;

use frame_support::PalletId;

/// OCW が署名付きトランザクションに使うキータイプ（`author insert-key --key-type tetc`）。
pub const TET_CORE_OCW_KEY_TYPE: sp_runtime::KeyTypeId = sp_runtime::KeyTypeId(*b"tetc");

pub mod crypto {
	use super::TET_CORE_OCW_KEY_TYPE;
	use sp_runtime::app_crypto::{app_crypto, sr25519};

	app_crypto!(sr25519, TET_CORE_OCW_KEY_TYPE);

	/// `Signer::<T, TetCoreAuthId>` 用の OCW アプリ暗号。
	pub struct TetCoreAuthId;

	/// ランタイムが `MultiSignature` のとき、`SigningTypes::Public` は `MultiSigner`。
	impl frame_system::offchain::AppCrypto<sp_runtime::MultiSigner, sp_runtime::MultiSignature>
		for TetCoreAuthId
	{
		type RuntimeAppPublic = Public;
		type GenericSignature = sp_core::sr25519::Signature;
		type GenericPublic = sp_core::sr25519::Public;
	}
}

/// 送金ゲスト `tet_transfer_guest` の image ID（`zk-prove` 時の送金レシート検証用）。
#[cfg(feature = "zk-prove")]
pub const GUEST_CODE_IMAGE_ID: [u32; 8] = [0u32; 8];

/// AI 推論ゲスト `tet_ai_inference_guest` の image ID。`prover/methods` ビルドの `TET_AI_INFERENCE_GUEST_ID` と同期すること。
#[cfg(feature = "zk-prove")]
pub const GUEST_AI_INFERENCE_IMAGE_ID: [u32; 8] = [
	1_217_106_852,
	1_003_026_117,
	703_268_964,
	3_346_849_854,
	1_454_389_088,
	1_116_930_443,
	1_818_808_380,
	3_110_716_015,
];

/// Upper bound for serialized RISC Zero `Receipt` payloads submitted on-chain.
pub type ZkReceiptMaxLen = frame_support::pallet_prelude::ConstU32<262144>;

/// エスクロー用モジュールアカウント（`into_account_truncating` と対）。
pub const TET_CORE_PALLET_ID: PalletId = PalletId(*b"TetCore!");

/// CAAC（環境適応型コンセンサス）向けノードハードウェア宣言。
#[derive(
	Copy,
	Clone,
	PartialEq,
	Eq,
	codec::Encode,
	codec::Decode,
	frame_support::pallet_prelude::MaxEncodedLen,
	scale_info::TypeInfo,
	frame_support::pallet_prelude::RuntimeDebug,
)]
pub struct NodeProfile {
	pub cpu_cores: u32,
	pub memory_mb: u32,
	pub has_gpu: bool,
}

impl codec::DecodeWithMemTracking for NodeProfile {}

#[frame_support::pallet]
pub mod pallet {
	use super::*;
	use alloc::vec::Vec;
	use codec::Decode;
	use frame_support::{
		pallet_prelude::*,
		traits::{Currency, ExistenceRequirement, Hooks, WithdrawReasons},
	};
	use frame_system::offchain::{SendSignedTransaction, Signer};
	use frame_system::pallet_prelude::*;
	use frame_support::sp_runtime::{
		traits::{AccountIdConversion, CheckedSub, SaturatedConversion, Saturating, Zero},
		Perbill,
	};
	#[cfg(feature = "zk-prove")]
	use borsh::BorshDeserialize;

	/// オンチェーンに保存するプロンプトの最大バイト数。
	pub type AiPromptMaxLen = ConstU32<2048>;
	/// オンチェーンに保存する AI 応答の最大バイト数。
	pub type AiResponseMaxLen = ConstU32<524288>;

	#[pallet::pallet]
	pub struct Pallet<T>(_);

	#[pallet::config]
	pub trait Config:
		frame_system::Config
		+ frame_system::offchain::SigningTypes
		+ pallet_balances::Config
		+ frame_system::offchain::CreateSignedTransaction<Call<Self>>
	{
		type RuntimeEvent: From<Event<Self>> + IsType<<Self as frame_system::Config>::RuntimeEvent>;
		type WeightInfo: WeightInfo;
		/// エスクロー・報酬・焼却に `pallet_balances` を結合するトークンインターフェース。
		type Currency: Currency<Self::AccountId>;
	}

	pub type BalanceOf<T> = <<T as Config>::Currency as Currency<<T as frame_system::Config>::AccountId>>::Balance;

	/// CAAC: 需要キューに載る AI タスク（`reward` はエスクロー済み）。
	#[derive(
		Clone,
		PartialEq,
		Eq,
		codec::Encode,
		codec::Decode,
		MaxEncodedLen,
		TypeInfo,
		RuntimeDebug,
	)]
	#[scale_info(skip_type_params(T))]
	pub struct AiTask<T: Config> {
		pub prompt: BoundedVec<u8, AiPromptMaxLen>,
		pub require_gpu: bool,
		pub requester: T::AccountId,
		pub reward: BalanceOf<T>,
	}

	impl<T: Config> codec::DecodeWithMemTracking for AiTask<T> where T::AccountId: MaxEncodedLen {}

	#[pallet::storage]
	pub type FounderAccount<T: Config> = StorageValue<_, T::AccountId>;

	#[pallet::storage]
	pub type TreasuryAccount<T: Config> = StorageValue<_, T::AccountId>;

	/// OCW / 署名者が投稿した AI 推論（キーはプロンプト、`Blake2_128Concat`）。
	#[pallet::storage]
	pub type AiInferences<T: Config> = StorageMap<
		_,
		Blake2_128Concat,
		BoundedVec<u8, AiPromptMaxLen>,
		BoundedVec<u8, AiResponseMaxLen>,
	>;

	/// 検証者／運用アカウントごとのノードハードウェア・テレメトリ。
	#[pallet::storage]
	pub type NodeProfiles<T: Config> = StorageMap<
		_,
		Blake2_128Concat,
		T::AccountId,
		super::NodeProfile,
	>;

	/// 次に採番する `PendingAiTasks` のタスク ID（採番後にインクリメント）。
	#[pallet::storage]
	pub type NextTaskId<T: Config> = StorageValue<_, u64, ValueQuery>;

	/// 未処理の AI 推論タスク（CAAC 需要キュー）。
	#[pallet::storage]
	pub type PendingAiTasks<T: Config> = StorageMap<_, Blake2_128Concat, u64, AiTask<T>>;

	#[pallet::genesis_config]
	pub struct GenesisConfig<T: Config> {
		pub founder: Option<T::AccountId>,
		pub treasury: Option<T::AccountId>,
	}

	impl<T: Config> Default for GenesisConfig<T> {
		fn default() -> Self {
			Self { founder: None, treasury: None }
		}
	}

	#[pallet::genesis_build]
	impl<T: Config> BuildGenesisConfig for GenesisConfig<T> {
		fn build(&self) {
			if let Some(f) = &self.founder {
				FounderAccount::<T>::put(f.clone());
			}
			if let Some(t) = &self.treasury {
				TreasuryAccount::<T>::put(t.clone());
			}
		}
	}

	#[pallet::event]
	#[pallet::generate_deposit(pub(super) fn deposit_event)]
	pub enum Event<T: Config> {
		MemoSent {
			from: T::AccountId,
			dest: T::AccountId,
			/// Gross value requested by the user (before tax).
			value: BalanceOf<T>,
			memo: BoundedVec<u8, ConstU32<256>>,
			/// `true` when this runtime was built with `zk-prove` and a valid RISC Zero receipt was verified.
			zk_verified: bool,
		},
		TaxApplied {
			from: T::AccountId,
			fee_total: BalanceOf<T>,
			fee_to_founder: BalanceOf<T>,
			fee_burned: BalanceOf<T>,
		},
		AiInferenceSubmitted {
			prompter: T::AccountId,
			prompt: BoundedVec<u8, AiPromptMaxLen>,
			response: BoundedVec<u8, AiResponseMaxLen>,
			/// ソルバーへ支払済み（エスクローの 80% 相当）。
			reward_paid: BalanceOf<T>,
			/// 焼却した金額（エスクローの 20% 相当）。
			amount_burned: BalanceOf<T>,
		},
		NodeProfileRegistered {
			node: T::AccountId,
			profile: super::NodeProfile,
		},
		AiTaskRequested {
			task_id: u64,
			requester: T::AccountId,
			require_gpu: bool,
		},
	}

	#[pallet::error]
	pub enum Error<T> {
		InvalidDestination,
		InsufficientValueForFee,
		MissingFounderAccount,
		/// Gross transfer amount must be positive.
		ZeroAmount,
		/// Fee / net split could not be computed safely for this balance type.
		ArithmeticError,
		/// ZK mode (`zk-prove`): transfers must include a serialized RISC Zero receipt.
		MissingZkReceipt,
		/// Receipt bytes could not be decoded or `Receipt::verify` failed.
		InvalidZkReceipt,
		/// プロンプトが `AiPromptMaxLen` を超えた。
		AiPromptTooLarge,
		/// 応答が `AiResponseMaxLen` を超えた。
		AiResponseTooLarge,
		/// 指定 `task_id` の未処理タスクが存在しない（既に消化済み等）。
		AiTaskNotFound,
		/// 提出 `prompt` がキュー上のタスクと一致しない。
		AiTaskPromptMismatch,
		/// AI タスクのエスクロー金額がゼロ。
		AiEscrowZero,
	}

	#[pallet::call]
	impl<T: Config> Pallet<T> {
		#[pallet::call_index(0)]
		#[pallet::weight(<T as Config>::WeightInfo::transfer_with_memo_raw(
			memo.len() as u32,
			zk_receipt.as_ref().map(|v| v.len() as u32).unwrap_or(0),
		))]
		pub fn transfer_with_memo_raw(
			origin: OriginFor<T>,
			dest: BoundedVec<u8, ConstU32<32>>,
			value: BalanceOf<T>,
			memo: BoundedVec<u8, ConstU32<256>>,
			zk_receipt: Option<BoundedVec<u8, ZkReceiptMaxLen>>,
		) -> DispatchResult {
			let from = ensure_signed(origin)?;

			let raw = dest.into_inner();
			let mut account_bytes = [0u8; 32];
			match raw.len() {
				32 => account_bytes.copy_from_slice(&raw[..]),
				20 => {
					// 20-byte (hex address) -> AccountId32 by left-padding 12 zero bytes.
					account_bytes[12..].copy_from_slice(&raw[..]);
				},
				_ => return Err(Error::<T>::InvalidDestination.into()),
			}

			let dest: T::AccountId =
				Decode::decode(&mut &account_bytes[..]).map_err(|_| Error::<T>::InvalidDestination)?;

			ensure!(value > Zero::zero(), Error::<T>::ZeroAmount);

			#[cfg(feature = "zk-prove")]
			{
				let bytes = zk_receipt.as_ref().ok_or(Error::<T>::MissingZkReceipt)?.as_slice();
				let receipt = risc0_zkvm::Receipt::try_from_slice(bytes)
					.map_err(|_| Error::<T>::InvalidZkReceipt)?;
				receipt
					.verify(risc0_zkvm::Digest::new(super::GUEST_CODE_IMAGE_ID))
					.map_err(|_| Error::<T>::InvalidZkReceipt)?;
			}
			#[cfg(not(feature = "zk-prove"))]
			let _ = zk_receipt;

			let zk_verified = cfg!(feature = "zk-prove");

			// Constitution: 1% fixed tax on transfers.
			// net ≈ 99%, fee_total ≈ 1%, fee_to_founder ≈ 0.5%, fee_burned ≈ 0.5%
			let fee_total: BalanceOf<T> = Perbill::from_percent(1).mul_floor(value);
			if fee_total > value {
				return Err(Error::<T>::InsufficientValueForFee.into());
			}
			let net: BalanceOf<T> = value
				.checked_sub(&fee_total)
				.ok_or(Error::<T>::ArithmeticError)?;

			let fee_to_founder: BalanceOf<T> = Perbill::from_percent(50).mul_floor(fee_total);
			let fee_burned: BalanceOf<T> = fee_total
				.checked_sub(&fee_to_founder)
				.ok_or(Error::<T>::ArithmeticError)?;

			// Send net to destination.
			<<T as Config>::Currency as Currency<T::AccountId>>::transfer(
				&from,
				&dest,
				net,
				ExistenceRequirement::AllowDeath,
			)?;

			// Send 50% of fee to founder (or treasury if configured that way in genesis).
			let founder = FounderAccount::<T>::get().ok_or(Error::<T>::MissingFounderAccount)?;
			if fee_to_founder > Zero::zero() {
				<<T as Config>::Currency as Currency<T::AccountId>>::transfer(
					&from,
					&founder,
					fee_to_founder,
					ExistenceRequirement::AllowDeath,
				)?;
			}

			// Burn 50% of fee.
			if fee_burned > Zero::zero() {
				let imbalance = <<T as Config>::Currency as Currency<T::AccountId>>::withdraw(
					&from,
					fee_burned,
					WithdrawReasons::FEE,
					ExistenceRequirement::AllowDeath,
				)?;
				drop(imbalance);
			}

			Self::deposit_event(Event::TaxApplied { from: from.clone(), fee_total, fee_to_founder, fee_burned });
			Self::deposit_event(Event::MemoSent {
				from,
				dest,
				value,
				memo,
				zk_verified,
			});
			Ok(())
		}

		#[pallet::call_index(1)]
		#[pallet::weight(<T as Config>::WeightInfo::submit_ai_inference(
			prompt.len() as u32,
			response.len() as u32,
			zk_receipt.as_ref().map(|v| v.len() as u32).unwrap_or(0),
		))]
		pub fn submit_ai_inference(
			origin: OriginFor<T>,
			task_id: u64,
			prompt: Vec<u8>,
			response: Vec<u8>,
			zk_receipt: Option<BoundedVec<u8, ZkReceiptMaxLen>>,
		) -> DispatchResult {
			let sender = ensure_signed(origin)?;

			let prompt_bounded = BoundedVec::<u8, AiPromptMaxLen>::try_from(prompt)
				.map_err(|_| Error::<T>::AiPromptTooLarge)?;
			let queued =
				PendingAiTasks::<T>::get(task_id).ok_or(Error::<T>::AiTaskNotFound)?;
			ensure!(queued.prompt == prompt_bounded, Error::<T>::AiTaskPromptMismatch);

			#[cfg(feature = "zk-prove")]
			{
				let bytes = zk_receipt.as_ref().ok_or(Error::<T>::MissingZkReceipt)?.as_slice();
				let receipt = risc0_zkvm::Receipt::try_from_slice(bytes)
					.map_err(|_| Error::<T>::InvalidZkReceipt)?;
				receipt
					.verify(risc0_zkvm::Digest::new(super::GUEST_AI_INFERENCE_IMAGE_ID))
					.map_err(|_| Error::<T>::InvalidZkReceipt)?;
			}
			#[cfg(not(feature = "zk-prove"))]
			let _ = zk_receipt;

			let response = BoundedVec::<u8, AiResponseMaxLen>::try_from(response)
				.map_err(|_| Error::<T>::AiResponseTooLarge)?;

			let reward_total = queued.reward;
			let escrow = Self::escrow_account();
			let reward_paid = Perbill::from_percent(80).mul_floor(reward_total);
			let amount_burned = reward_total.saturating_sub(reward_paid);

			if !reward_total.is_zero() {
				if !reward_paid.is_zero() {
					<<T as Config>::Currency as Currency<T::AccountId>>::transfer(
						&escrow,
						&sender,
						reward_paid,
						ExistenceRequirement::AllowDeath,
					)?;
				}
				if !amount_burned.is_zero() {
					let imbalance = <<T as Config>::Currency as Currency<T::AccountId>>::withdraw(
						&escrow,
						amount_burned,
						WithdrawReasons::FEE,
						ExistenceRequirement::AllowDeath,
					)?;
					drop(imbalance);
				}
			}

			AiInferences::<T>::insert(prompt_bounded.clone(), response.clone());
			Self::deposit_event(Event::AiInferenceSubmitted {
				prompter: sender,
				prompt: prompt_bounded,
				response,
				reward_paid,
				amount_burned,
			});
			PendingAiTasks::<T>::remove(task_id);
			Ok(())
		}

		#[pallet::call_index(2)]
		#[pallet::weight(<T as Config>::WeightInfo::register_node_profile())]
		pub fn register_node_profile(origin: OriginFor<T>, profile: super::NodeProfile) -> DispatchResult {
			let sender = ensure_signed(origin)?;
			NodeProfiles::<T>::insert(sender.clone(), profile);
			Self::deposit_event(Event::NodeProfileRegistered { node: sender, profile });
			Ok(())
		}

		#[pallet::call_index(3)]
		#[pallet::weight(<T as Config>::WeightInfo::request_ai_inference(prompt.len() as u32))]
		pub fn request_ai_inference(
			origin: OriginFor<T>,
			prompt: Vec<u8>,
			require_gpu: bool,
			reward_amount: BalanceOf<T>,
		) -> DispatchResult {
			let requester = ensure_signed(origin)?;
			ensure!(reward_amount > Zero::zero(), Error::<T>::AiEscrowZero);
			let prompt = BoundedVec::<u8, AiPromptMaxLen>::try_from(prompt)
				.map_err(|_| Error::<T>::AiPromptTooLarge)?;
			let escrow = Self::escrow_account();
			<<T as Config>::Currency as Currency<T::AccountId>>::transfer(
				&requester,
				&escrow,
				reward_amount,
				ExistenceRequirement::KeepAlive,
			)?;
			let task_id = NextTaskId::<T>::mutate(|c| {
				let id = *c;
				*c = c.saturating_add(1);
				id
			});
			let task = AiTask::<T> {
				prompt,
				require_gpu,
				requester: requester.clone(),
				reward: reward_amount,
			};
			PendingAiTasks::<T>::insert(task_id, task);
			Self::deposit_event(Event::AiTaskRequested {
				task_id,
				requester,
				require_gpu,
			});
			Ok(())
		}
	}

	impl<T: Config> Pallet<T> {
		/// パレットが管理するエスクロー（預託）口座。
		pub fn escrow_account() -> T::AccountId {
			super::TET_CORE_PALLET_ID.into_account_truncating()
		}
	}

	/// Ollama `/api/generate` (bind locally).
	const OLLAMA_GENERATE_URL: &'static str = "http://127.0.0.1:11434/api/generate";
	/// Pull first (`ollama pull llama3`); alternatives: `qwen`, `phi3`, etc.
	const OLLAMA_MODEL: &'static str = "llama3";
	/// Ollama への OCW HTTP デッドライン（ミリ秒）。
	const OLLAMA_HTTP_TIMEOUT_MS: u64 = 120_000;

	#[cfg(feature = "zk-prove")]
	/// Prover Daemon `/prove_ai` への OCW HTTP デッドライン（ミリ秒）。
	const PROVER_PROVE_AI_HTTP_TIMEOUT_MS: u64 = 180_000;
	#[cfg(feature = "zk-prove")]
	const PROVER_PROVE_AI_URL: &'static str = "http://127.0.0.1:9945/prove_ai";

	fn json_escape_for_ollama(s: &str) -> alloc::string::String {
		let mut out = alloc::string::String::new();
		for ch in s.chars() {
			match ch {
				'\\' => out.push_str("\\\\"),
				'"' => out.push_str("\\\""),
				'\n' => out.push_str("\\n"),
				'\r' => out.push_str("\\r"),
				'\t' => out.push_str("\\t"),
				c if (c as u32) < 0x20 => {
					out.push_str(&alloc::format!("\\u{:04x}", c as u32));
				},
				c => out.push(c),
			}
		}
		out
	}

	fn map_core_http_err(e: sp_core::offchain::HttpError) -> sp_runtime::offchain::http::Error {
		match e {
			sp_core::offchain::HttpError::DeadlineReached =>
				sp_runtime::offchain::http::Error::DeadlineReached,
			sp_core::offchain::HttpError::IoError => sp_runtime::offchain::http::Error::IoError,
			sp_core::offchain::HttpError::Invalid => sp_runtime::offchain::http::Error::Unknown,
		}
	}

	/// POST JSON to local Ollama; returns raw response bytes (JSON text).
	fn fetch_ai_inference(
		prompt: &str,
	) -> Result<alloc::vec::Vec<u8>, sp_runtime::offchain::http::Error> {
		use alloc::format;
		use alloc::vec;
		use alloc::vec::Vec;
		use sp_core::offchain::{Duration, HttpError};
		use sp_io::offchain as ocw;
		use sp_runtime::offchain::http::{self, Request};

		let now = ocw::timestamp();
		let deadline = now.add(Duration::from_millis(OLLAMA_HTTP_TIMEOUT_MS));

		let escaped = json_escape_for_ollama(prompt);
		let json = format!(
			r#"{{"model":"{}","prompt":"{}","stream":false}}"#,
			OLLAMA_MODEL,
			escaped
		);

		let pending = Request::post(OLLAMA_GENERATE_URL, vec![json.as_bytes()])
			.add_header("Content-Type", "application/json")
			.deadline(deadline)
			.send()
			.map_err(map_core_http_err)?;

		match pending.try_wait(Some(deadline)) {
			Ok(Ok(response)) => {
				if !(200..300).contains(&response.code) {
					return Err(http::Error::IoError);
				}
				let mut body_iter = response.body();
				body_iter.deadline(Some(deadline));
				let mut out = Vec::new();
				while let Some(b) = body_iter.next() {
					out.push(b);
				}
				if let Some(e) = body_iter.error() {
					return match *e {
						HttpError::DeadlineReached => Err(http::Error::DeadlineReached),
						HttpError::IoError => Err(http::Error::IoError),
						HttpError::Invalid => Err(http::Error::Unknown),
					};
				}
				Ok(out)
			},
			Ok(Err(e)) => Err(e),
			Err(_) => Err(http::Error::DeadlineReached),
		}
	}

	#[cfg(feature = "zk-prove")]
	fn hex_digit_value(byte: u8) -> Option<u8> {
		match byte {
			b'0'..=b'9' => Some(byte - b'0'),
			b'a'..=b'f' => Some(byte - b'a' + 10),
			b'A'..=b'F' => Some(byte - b'A' + 10),
			_ => None,
		}
	}

	#[cfg(feature = "zk-prove")]
	fn decode_hex_ascii(s: &str) -> Option<Vec<u8>> {
		let s = s.strip_prefix("0x").unwrap_or(s);
		if s.len() % 2 != 0 {
			return None;
		}
		let mut out = Vec::with_capacity(s.len() / 2);
		let b = s.as_bytes();
		let mut i = 0;
		while i < b.len() {
			let hi = hex_digit_value(b[i])?;
			let lo = hex_digit_value(b[i + 1])?;
			out.push((hi << 4) | lo);
			i += 2;
		}
		Some(out)
	}

	#[cfg(feature = "zk-prove")]
	fn extract_receipt_borsh_hex(json: &str) -> Option<&str> {
		let key = "\"receipt_borsh_hex\":\"";
		let start = json.find(key)? + key.len();
		let rest = json.get(start..)?;
		let end = rest.find('"')?;
		Some(&rest[..end])
	}

	/// Prover Daemon の `/prove_ai` へ `(prompt, response)` を送り、Borsh 化された `Receipt` バイト列を返す。
	#[cfg(feature = "zk-prove")]
	fn fetch_prove_ai_receipt(
		prompt: &str,
		response: &str,
	) -> Result<Vec<u8>, sp_runtime::offchain::http::Error> {
		use alloc::format;
		use alloc::vec;
		use alloc::vec::Vec;
		use sp_core::offchain::{Duration, HttpError};
		use sp_io::offchain as ocw;
		use sp_runtime::offchain::http::{self, Request};

		let now = ocw::timestamp();
		let deadline = now.add(Duration::from_millis(PROVER_PROVE_AI_HTTP_TIMEOUT_MS));
		let escaped_p = json_escape_for_ollama(prompt);
		let escaped_r = json_escape_for_ollama(response);
		let json = format!(r#"{{"prompt":"{}","response":"{}"}}"#, escaped_p, escaped_r);

		let pending = Request::post(PROVER_PROVE_AI_URL, vec![json.as_bytes()])
			.add_header("Content-Type", "application/json")
			.deadline(deadline)
			.send()
			.map_err(map_core_http_err)?;

		match pending.try_wait(Some(deadline)) {
			Ok(Ok(http_response)) => {
				if !(200..300).contains(&http_response.code) {
					return Err(http::Error::IoError);
				}
				let mut body_iter = http_response.body();
				body_iter.deadline(Some(deadline));
				let mut out = Vec::new();
				while let Some(b) = body_iter.next() {
					out.push(b);
				}
				if let Some(e) = body_iter.error() {
					return match *e {
						HttpError::DeadlineReached => Err(http::Error::DeadlineReached),
						HttpError::IoError => Err(http::Error::IoError),
						HttpError::Invalid => Err(http::Error::Unknown),
					};
				}
				let text = core::str::from_utf8(&out).map_err(|_| http::Error::IoError)?;
				let hex_str = extract_receipt_borsh_hex(text).ok_or(http::Error::IoError)?;
				decode_hex_ascii(hex_str).ok_or(http::Error::IoError)
			},
			Ok(Err(e)) => Err(e),
			Err(_) => Err(http::Error::DeadlineReached),
		}
	}

	#[pallet::hooks]
	impl<T: Config> Hooks<BlockNumberFor<T>> for Pallet<T>
	where
		super::crypto::TetCoreAuthId: frame_system::offchain::AppCrypto<T::Public, T::Signature>,
	{
		fn offchain_worker(block_number: BlockNumberFor<T>) {
			let n: u32 = block_number.saturated_into();

			// OCW モック（ランタイム no_std のため実 HW は取得しない）。
			const MOCK_PROFILE: super::NodeProfile = super::NodeProfile {
				cpu_cores: 8,
				memory_mb: 16384,
				has_gpu: true,
			};

			if (1..=10).contains(&n) {
				let signer_all = Signer::<T, super::crypto::TetCoreAuthId>::all_accounts();
				if signer_all.can_sign() {
					for account in signer_all.accounts_from_keys() {
						if NodeProfiles::<T>::contains_key(&account.id) {
							continue;
						}
						let pub_key = account.public.clone();
						let signer_one = Signer::<T, super::crypto::TetCoreAuthId>::all_accounts()
							.with_filter(alloc::vec![pub_key]);
						let results = signer_one.send_signed_transaction(|_acct| {
							Call::<T>::register_node_profile { profile: MOCK_PROFILE }
						});
						for (_a, res) in results.into_iter() {
							match res {
								Ok(()) => log::info!(
									"[OCW HW] Block #{}: register_node_profile を送信しました（テレメトリ登録）",
									n
								),
								Err(()) => log::warn!(
									"[OCW HW] register_node_profile の送信に失敗しました"
								),
							}
						}
						break;
					}
				}
			}

			let signer_supply = Signer::<T, super::crypto::TetCoreAuthId>::all_accounts();
			if !signer_supply.can_sign() {
				return;
			}

			let mut ocw_account = None;
			for account in signer_supply.accounts_from_keys() {
				ocw_account = Some(account);
				break;
			}
			let Some(worker) = ocw_account else {
				return;
			};

			let profile = NodeProfiles::<T>::get(&worker.id);
			let has_gpu = profile.map(|p| p.has_gpu).unwrap_or(false);

			let signer_one = Signer::<T, super::crypto::TetCoreAuthId>::all_accounts()
				.with_filter(alloc::vec![worker.public.clone()]);

			log::info!(
				"[OCW CAAC] Block #{:?}: PendingAiTasks をスキャン（has_gpu={}）…",
				block_number,
				has_gpu
			);

			for (task_id, task) in PendingAiTasks::<T>::iter() {
				if task.require_gpu && !has_gpu {
					continue;
				}

				let prompt_str = match core::str::from_utf8(task.prompt.as_slice()) {
					Ok(s) => s,
					Err(_) => continue,
				};

				let bytes = match fetch_ai_inference(prompt_str) {
					Ok(b) => b,
					Err(e) => {
						log::warn!("[OCW CAAC] Ollama 失敗 task_id={}: {:?}", task_id, e);
						continue;
					},
				};

				let prompt_vec = task.prompt.clone().into_inner();
				let response_vec = bytes.clone();
				if BoundedVec::<u8, AiResponseMaxLen>::try_from(response_vec.clone()).is_err() {
					log::warn!("[OCW CAAC] 応答 oversized task_id={}", task_id);
					continue;
				}

				#[cfg(feature = "zk-prove")]
				let zk_receipt: Option<BoundedVec<u8, ZkReceiptMaxLen>> = {
					let response_txt =
						alloc::string::String::from_utf8_lossy(&response_vec).into_owned();
					let zk_raw = match fetch_prove_ai_receipt(prompt_str, &response_txt) {
						Ok(b) => b,
						Err(e) => {
							log::warn!("[OCW CAAC] Prover 失敗 task_id={}: {:?}", task_id, e);
							continue;
						},
					};
					match BoundedVec::<u8, ZkReceiptMaxLen>::try_from(zk_raw) {
						Ok(b) => Some(b),
						Err(_) => {
							log::warn!("[OCW CAAC] ZK レシート oversized task_id={}", task_id);
							continue;
						},
					}
				};
				#[cfg(not(feature = "zk-prove"))]
				let zk_receipt: Option<BoundedVec<u8, ZkReceiptMaxLen>> = None;

				let results = signer_one.send_signed_transaction(move |_acct| {
					Call::<T>::submit_ai_inference {
						task_id,
						prompt: prompt_vec.clone(),
						response: response_vec.clone(),
						zk_receipt: zk_receipt.clone(),
					}
				});

				for (_acct, res) in results.into_iter() {
					match res {
						Ok(()) => log::info!(
							"[OCW CAAC] submit_ai_inference 送信 task_id={}",
							task_id
						),
						Err(()) => log::warn!(
							"[OCW CAAC] submit_ai_inference 失敗 task_id={}",
							task_id
						),
					}
				}
				break;
			}
		}
	}
}

