use sc_service::ChainType;
use solochain_template_runtime::WASM_BINARY;
use sp_core::crypto::Ss58Codec;
use sp_core::sr25519;
use sp_core::Pair as _;
use sp_runtime::traits::IdentifyAccount;
use serde_json::json;

use solochain_template_runtime::{AccountId, Balance};

/// Specialized `ChainSpec`. This is a specialization of the general Substrate ChainSpec type.
pub type ChainSpec = sc_service::GenericChainSpec;

const STEVEMON_PER_TET: Balance = 100_000_000; // 1 TET = 10^8 Stevemon

fn account_id_from_seed(seed: &str) -> AccountId {
	let pair = sr25519::Pair::from_string(&format!("//{seed}"), None)
		.expect("static values are valid; qed");
	sp_runtime::MultiSigner::from(pair.public()).into_account()
}

fn tet_balances_patch() -> serde_json::Value {
	let founder = account_id_from_seed("Founder");
	let founder_balance: Balance = 2_500_000_000u128
		.saturating_mul(STEVEMON_PER_TET);

	let debug_balance: Balance = 1_000u128
		.saturating_mul(STEVEMON_PER_TET);

	let endowed: Vec<(String, Balance)> = vec![
		(founder.to_ss58check(), founder_balance),
		(account_id_from_seed("GenesisPool").to_ss58check(), debug_balance),
		(account_id_from_seed("Alice").to_ss58check(), debug_balance),
		(account_id_from_seed("Bob").to_ss58check(), debug_balance),
		(account_id_from_seed("Charlie").to_ss58check(), debug_balance),
		(account_id_from_seed("Dave").to_ss58check(), debug_balance),
		(account_id_from_seed("Eve").to_ss58check(), debug_balance),
		(account_id_from_seed("Ferdie").to_ss58check(), debug_balance),
	];

	json!({
		"balances": {
			"balances": endowed
		}
	})
}

pub fn development_chain_spec() -> Result<ChainSpec, String> {
	Ok(ChainSpec::builder(
		WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
		None,
	)
	.with_name("Development")
	.with_id("dev")
	.with_chain_type(ChainType::Development)
	.with_genesis_config_preset_name(sp_genesis_builder::DEV_RUNTIME_PRESET)
	.build())
}

pub fn local_chain_spec() -> Result<ChainSpec, String> {
	Ok(ChainSpec::builder(
		WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
		None,
	)
	.with_name("Local Testnet")
	.with_id("local_testnet")
	.with_chain_type(ChainType::Local)
	.with_genesis_config_preset_name(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET)
	.with_genesis_config_patch(tet_balances_patch())
	.build())
}

pub fn tet_testnet_chain_spec() -> Result<ChainSpec, String> {
	let bootnode = "/ip4/127.0.0.1/tcp/30333/p2p/12D3KooWQvJ5w6vB4N7j7UU5g3uQh3V1dVw9Qv3Axy9QZ3vYJZk9"
		.parse()
		.map_err(|e| format!("invalid bootnode multiaddr: {e}"))?;

	Ok(ChainSpec::builder(
		WASM_BINARY.ok_or_else(|| "Development wasm not available".to_string())?,
		None,
	)
	.with_name("TET Testnet")
	.with_id("tet_testnet")
	.with_chain_type(ChainType::Live)
	.with_protocol_id("tet")
	.with_boot_nodes(vec![bootnode])
	.with_genesis_config_preset_name(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET)
	.with_genesis_config_patch(tet_balances_patch())
	.build())
}
