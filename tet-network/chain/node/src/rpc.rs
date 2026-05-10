//! A collection of node-specific RPC methods.
//! Substrate provides the `sc-rpc` crate, which defines the core RPC layer
//! used by Substrate nodes. This file extends those RPC definitions with
//! capabilities that are specific to this project's runtime configuration.

#![warn(missing_docs)]

use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use jsonrpsee::RpcModule;
use sc_transaction_pool_api::TransactionPool;
use solochain_template_runtime::{opaque::Block, AccountId, Balance, Nonce};
use sp_api::ProvideRuntimeApi;
use sp_block_builder::BlockBuilder;
use sp_blockchain::{Error as BlockChainError, HeaderBackend, HeaderMetadata};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RpcExposureProfile {
	Public,
	Private,
}

/// Full client dependencies.
pub struct FullDeps<C, P> {
	/// The client instance to use.
	pub client: Arc<C>,
	/// Transaction pool instance.
	pub pool: Arc<P>,
	/// RPC exposure profile.
	pub profile: RpcExposureProfile,
}

/// Instantiate all full RPC extensions.
pub fn create_full<C, P>(
	deps: FullDeps<C, P>,
) -> Result<RpcModule<()>, Box<dyn std::error::Error + Send + Sync>>
where
	C: ProvideRuntimeApi<Block>,
	C: HeaderBackend<Block> + HeaderMetadata<Block, Error = BlockChainError> + 'static,
	C: Send + Sync + 'static,
	C::Api: substrate_frame_rpc_system::AccountNonceApi<Block, AccountId, Nonce>,
	C::Api: pallet_transaction_payment_rpc::TransactionPaymentRuntimeApi<Block, Balance>,
	C::Api: BlockBuilder<Block>,
	P: TransactionPool + 'static,
{
	use pallet_transaction_payment_rpc::{TransactionPayment, TransactionPaymentApiServer};
	use substrate_frame_rpc_system::{System, SystemApiServer};

	let mut module = RpcModule::new(());
	let FullDeps { client, pool, profile } = deps;
	let client_for_health = client.clone();

	module.merge(System::new(client.clone(), pool).into_rpc())?;
	module.merge(TransactionPayment::new(client).into_rpc())?;

	// Lightweight health summary for explorer/ops dashboards.
	module.register_method("tet_healthSummary", move |_, _, _| {
		let info = client_for_health.info();
		let ts_ms = SystemTime::now()
			.duration_since(UNIX_EPOCH)
			.map(|d| d.as_millis() as u64)
			.unwrap_or(0);
		Ok::<_, jsonrpsee::types::ErrorObjectOwned>(serde_json::json!({
			"ok": true,
			"profile": match profile {
				RpcExposureProfile::Public => "public",
				RpcExposureProfile::Private => "private",
			},
			"best_number": info.best_number.to_string(),
			"best_hash": format!("{:?}", info.best_hash),
			"timestamp_ms": ts_ms,
		}))
	})?;

	// Extend this RPC with a custom API by using the following syntax.
	// `YourRpcStruct` should have a reference to a client, which is needed
	// to call into the runtime.
	// `module.merge(YourRpcTrait::into_rpc(YourRpcStruct::new(ReferenceToClient, ...)))?;`

	// You probably want to enable the `rpc v2 chainSpec` API as well
	//
	// let chain_name = chain_spec.name().to_string();
	// let genesis_hash = client.block_hash(0).ok().flatten().expect("Genesis block exists; qed");
	// let properties = chain_spec.properties();
	// module.merge(ChainSpec::new(chain_name, genesis_hash, properties).into_rpc())?;

	// NOTE:
	// public profile intentionally exposes a strict, read-only subset of methods.
	// private profile can be expanded in future with operator-only modules.
	match profile {
		RpcExposureProfile::Public => {},
		RpcExposureProfile::Private => {},
	}

	Ok(module)
}
