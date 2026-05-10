// This file is part of Substrate.

// Copyright (C) Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: Apache-2.0

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 	http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use crate::{AccountId, BalancesConfig, RuntimeGenesisConfig, SudoConfig};
use alloc::{vec, vec::Vec};
use frame_support::build_struct_json_patch;
use serde_json::Value;
use sp_consensus_aura::sr25519::AuthorityId as AuraId;
use sp_consensus_grandpa::AuthorityId as GrandpaId;
use sp_genesis_builder::{self, PresetId};
use sp_keyring::Sr25519Keyring;
use frame_support::PalletId;
use sp_runtime::traits::AccountIdConversion;

/// 1 TET = 100_000_000 Stevemon (10^8).
pub const STEVEMON_PER_TET: u128 = 100_000_000;

const FOUNDER_ENDOWMENT_TET: u128 = 2_500_000_000;
const TREASURY_ENDOWMENT_TET: u128 = 7_500_000_000;
const DEBUG_ENDOWMENT_TET: u128 = 1_000;

const TREASURY_PALLET_ID: PalletId = PalletId(*b"tet/trea");

fn tet(tet_units: u128) -> u128 {
	tet_units.saturating_mul(STEVEMON_PER_TET)
}

fn treasury_account() -> AccountId {
	TREASURY_PALLET_ID.into_account_truncating()
}

// Returns the genesis config presets populated with given parameters.
fn testnet_genesis(
	initial_authorities: Vec<(AuraId, GrandpaId)>,
	endowed_accounts: Vec<AccountId>,
	root: AccountId,
) -> Value {
	let founder: AccountId = Sr25519Keyring::Ferdie.to_account_id();
	let treasury: AccountId = treasury_account();

	// Ensure founder is always endowed.
	let mut all_endowed = endowed_accounts.clone();
	if !all_endowed.iter().any(|a| a == &founder) {
		all_endowed.push(founder.clone());
	}
	if !all_endowed.iter().any(|a| a == &treasury) {
		all_endowed.push(treasury.clone());
	}

	let founder_amount = tet(FOUNDER_ENDOWMENT_TET);
	let treasury_total = tet(TREASURY_ENDOWMENT_TET);

	// Debug allocations come out of treasury to keep total supply fixed.
	let mut debug_total: u128 = 0;
	for who in all_endowed.iter() {
		if who != &founder && who != &treasury {
			debug_total = debug_total.saturating_add(tet(DEBUG_ENDOWMENT_TET));
		}
	}
	let treasury_amount = treasury_total.saturating_sub(debug_total);

	build_struct_json_patch!(RuntimeGenesisConfig {
		balances: BalancesConfig {
			balances: all_endowed
				.iter()
				.cloned()
				.map(|who| {
					let amount = if who == founder {
						founder_amount
					} else if who == treasury {
						treasury_amount
					} else {
						tet(DEBUG_ENDOWMENT_TET)
					};
					(who, amount)
				})
				.collect::<Vec<_>>(),
		},
		tet_core: pallet_tet_core::GenesisConfig { founder: Some(founder.clone()), treasury: Some(treasury.clone()) },
		aura: pallet_aura::GenesisConfig {
			authorities: initial_authorities.iter().map(|x| x.0.clone()).collect::<Vec<_>>(),
		},
		grandpa: pallet_grandpa::GenesisConfig {
			authorities: initial_authorities.iter().map(|x| (x.1.clone(), 1)).collect::<Vec<_>>(),
		},
		sudo: SudoConfig { key: Some(root) },
	})
}

/// Return the development genesis config.
pub fn development_config_genesis() -> Value {
	testnet_genesis(
		vec![(
			sp_keyring::Sr25519Keyring::Alice.public().into(),
			sp_keyring::Ed25519Keyring::Alice.public().into(),
		)],
		vec![
			Sr25519Keyring::Alice.to_account_id(),
			Sr25519Keyring::Bob.to_account_id(),
			Sr25519Keyring::AliceStash.to_account_id(),
			Sr25519Keyring::BobStash.to_account_id(),
		],
		sp_keyring::Sr25519Keyring::Alice.to_account_id(),
	)
}

/// Return the local genesis config preset.
pub fn local_config_genesis() -> Value {
	testnet_genesis(
		vec![
			(
				sp_keyring::Sr25519Keyring::Alice.public().into(),
				sp_keyring::Ed25519Keyring::Alice.public().into(),
			),
			(
				sp_keyring::Sr25519Keyring::Bob.public().into(),
				sp_keyring::Ed25519Keyring::Bob.public().into(),
			),
		],
		Sr25519Keyring::iter()
			.filter(|v| v != &Sr25519Keyring::One && v != &Sr25519Keyring::Two)
			.map(|v| v.to_account_id())
			.collect::<Vec<_>>(),
		Sr25519Keyring::Alice.to_account_id(),
	)
}

/// Provides the JSON representation of predefined genesis config for given `id`.
pub fn get_preset(id: &PresetId) -> Option<Vec<u8>> {
	let patch = match id.as_ref() {
		sp_genesis_builder::DEV_RUNTIME_PRESET => development_config_genesis(),
		sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET => local_config_genesis(),
		_ => return None,
	};
	let json = serde_json::to_string(&patch).ok()?;
	Some(json.into_bytes())
}

/// List of supported presets.
pub fn preset_names() -> Vec<PresetId> {
	vec![
		PresetId::from(sp_genesis_builder::DEV_RUNTIME_PRESET),
		PresetId::from(sp_genesis_builder::LOCAL_TESTNET_RUNTIME_PRESET),
	]
}
