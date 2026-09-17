//! Single source of truth for every protocol fee.
//!
//! Normative spec: `docs/FEE_SPEC.md`. **No fee arithmetic may live outside this module.**
//!
//! Before 2026-09-17 there were seven ad-hoc schedules with three different "treasuries", two
//! different meanings of "burn", and an unvalidated caller-supplied rate on the consensus path
//! (`docs/FEE_AUDIT.md`). Everything now resolves through [`charge`].
//!
//! # Design
//!
//! [`charge`] is **pure**: amount in, [`FeeSplit`] out. It reads no environment, touches no ledger,
//! and resolves no wallet ids. The caller maps the four amounts onto balance keys. That keeps the
//! conservation invariant provable without a database and identical on every node.
//!
//! # Invariant
//!
//! ```text
//! net_micro + pool_micro + treasury_micro + burn_micro == amount_micro
//! ```
//!
//! Exact, for every [`FeeKind`], at every amount. `burn_micro` absorbs all integer-division
//! remainder, so no rounding mode or float is involved anywhere in consensus-visible fee math.

use serde::Serialize;

/// Basis-point denominator. 10 000 bps = 100%.
pub const BPS_DENOM: u64 = 10_000;

/// Largest amount [`charge`] will accept — the supply cap, 10 000 000 000 TET in µTET.
///
/// Defined here rather than imported so this module stays dependency-free: it is compiled into
/// both crate roots (`lib.rs` and `main.rs`), but `ledger` exists only in the binary.
/// `ledger.rs` carries a `const _: () = assert!(...)` tying this to `MAX_SUPPLY_MICRO`, so the two
/// cannot drift without failing the build.
pub const MAX_CHARGE_MICRO: u64 = 10_000_000_000u64 * 1_000_000;

/// Genesis Epoch length in blocks, mirrored from `ledger::GENESIS_EPOCH_BLOCK_LIMIT`.
///
/// Referenced only by the regression test that pins the inference split across the epoch boundary
/// (FEE_SPEC §2.3). Settlement itself no longer consults height at all.
#[cfg(test)]
const GENESIS_EPOCH_BLOCK_LIMIT_MIRROR: u64 = 1_300_000;

// ── Transfer (FEE_SPEC §2.1) ──────────────────────────────────────────────────────────────────

/// Minimum accepted `fee_bps` on `TxV1::Transfer` — **1%**. Consensus rule; changing it is a fork.
pub const TRANSFER_FEE_BPS_MIN: u64 = 100;
/// Maximum accepted `fee_bps` on `TxV1::Transfer` — **10%**. Consensus rule; changing it is a fork.
pub const TRANSFER_FEE_BPS_MAX: u64 = 1_000;
/// Rate clients should use when they have no reason to pick another — **1%**.
pub const TRANSFER_FEE_BPS_DEFAULT: u64 = 100;

// ── AI utility (FEE_SPEC §2.2) ────────────────────────────────────────────────────────────────

/// Network fee on AI utility settlement — **20%** of gross.
pub const NETWORK_FEE_BPS: u64 = 2_000;
/// Share of the network fee that is burned — **25% of the fee**, i.e. 5% of gross.
pub const BURN_FRACTION_OF_NETWORK_FEE_BPS: u64 = 2_500;

// ── AI inference (FEE_SPEC §2.3) ──────────────────────────────────────────────────────────────

/// Worker-pool share of a thermodynamic inference charge — **50%**. Burn takes the rest.
///
/// The former Genesis Epoch ×5 multiplier is gone: it saturated to 100% pool / 0% burn for all
/// 1 300 000 Genesis Epoch blocks, so the documented 50/50 never ran. See FEE_SPEC §2.3.
pub const AI_INFERENCE_POOL_BPS: u64 = 5_000;

// ── File (FEE_SPEC §2.4) ──────────────────────────────────────────────────────────────────────

/// Flat per-file fee — **1000 µTET**.
pub const FILE_FEE_MICRO: u64 = 1_000;
/// Treasury share of a file fee — **25%**.
pub const FILE_SPLIT_TREASURY_BPS: u64 = 2_500;
/// Storage-node share of a file fee — **50%**.
pub const FILE_SPLIT_STORAGE_BPS: u64 = 5_000;
/// Burn share of a file fee — **25%** (taken as the remainder).
pub const FILE_SPLIT_BURN_BPS: u64 = 2_500;

const _: () = assert!(
    FILE_SPLIT_TREASURY_BPS + FILE_SPLIT_STORAGE_BPS + FILE_SPLIT_BURN_BPS == BPS_DENOM,
    "file fee split must sum to 100%"
);
const _: () = assert!(TRANSFER_FEE_BPS_MIN <= TRANSFER_FEE_BPS_MAX);
const _: () = assert!(
    TRANSFER_FEE_BPS_DEFAULT >= TRANSFER_FEE_BPS_MIN
        && TRANSFER_FEE_BPS_DEFAULT <= TRANSFER_FEE_BPS_MAX,
    "default transfer fee must be inside the accepted range"
);

/// Which fee schedule applies to an operation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeeKind {
    /// `TxV1::Transfer`. `fee_bps` is sender-declared and signed, but bounded — see
    /// [`TRANSFER_FEE_BPS_MIN`] / [`TRANSFER_FEE_BPS_MAX`].
    Transfer { fee_bps: u64 },
    /// Enterprise AI settlement: 80% worker / 15% treasury / 5% burn.
    AiUtility,
    /// Thermodynamic inference charge: 50% worker pool / 50% burn.
    AiInference,
    /// Per-file sharing fee: 50% storage node / 25% treasury / 25% burn.
    File,
}

impl FeeKind {
    /// Stable tag for audit rows and error messages.
    pub fn tag(&self) -> &'static str {
        match self {
            Self::Transfer { .. } => "transfer",
            Self::AiUtility => "ai_utility",
            Self::AiInference => "ai_inference",
            Self::File => "file",
        }
    }
}

/// Deterministic four-way split of `amount_micro`.
///
/// Destinations are resolved by the caller:
/// - `net_micro` → counterparty (recipient wallet, or the storage node for [`FeeKind::File`])
/// - `pool_micro` → `WALLET_WORKER_POOL`
/// - `treasury_micro` → `TET_TREASURY_ADDRESS` **only**
/// - `burn_micro` → destroyed; **decrements `META_TOTAL_SUPPLY`**, credited to no wallet
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize)]
pub struct FeeSplit {
    pub net_micro: u64,
    pub pool_micro: u64,
    pub treasury_micro: u64,
    pub burn_micro: u64,
}

impl FeeSplit {
    /// Sum of all four parts. Equals the original `amount_micro` by construction.
    pub fn total_micro(&self) -> u64 {
        self.net_micro
            .saturating_add(self.pool_micro)
            .saturating_add(self.treasury_micro)
            .saturating_add(self.burn_micro)
    }

    /// Everything that is not `net_micro` — what the protocol took.
    pub fn fee_micro(&self) -> u64 {
        self.pool_micro
            .saturating_add(self.treasury_micro)
            .saturating_add(self.burn_micro)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum FeeError {
    #[error("fee_bps {got} outside accepted range [{min}, {max}]")]
    FeeBpsOutOfRange { got: u64, min: u64, max: u64 },
    #[error("amount {got} exceeds max supply {max}")]
    AmountOutOfRange { got: u64, max: u64 },
}

/// `amount × bps / 10_000`, computed in `u128` so no intermediate can overflow.
#[inline]
fn bps_of(amount_micro: u64, bps: u64) -> u64 {
    ((amount_micro as u128 * bps as u128) / BPS_DENOM as u128) as u64
}

/// Validate a `TxV1::Transfer` fee rate against the consensus bounds.
///
/// Called at block-apply time on every node, so an out-of-range rate is rejected identically
/// everywhere rather than being silently honoured (the pre-2026-09-17 behaviour, where any value
/// `0..=10000` applied — a sender could pay nothing or destroy the whole amount).
pub fn validate_transfer_fee_bps(fee_bps: u64) -> Result<(), FeeError> {
    if !(TRANSFER_FEE_BPS_MIN..=TRANSFER_FEE_BPS_MAX).contains(&fee_bps) {
        return Err(FeeError::FeeBpsOutOfRange {
            got: fee_bps,
            min: TRANSFER_FEE_BPS_MIN,
            max: TRANSFER_FEE_BPS_MAX,
        });
    }
    Ok(())
}

/// Resolve `amount_micro` into its [`FeeSplit`] under `kind`.
///
/// Pure. The conservation invariant (FEE_SPEC §1.1) holds exactly for every input.
pub fn charge(kind: FeeKind, amount_micro: u64) -> Result<FeeSplit, FeeError> {
    if amount_micro > MAX_CHARGE_MICRO {
        return Err(FeeError::AmountOutOfRange {
            got: amount_micro,
            max: MAX_CHARGE_MICRO,
        });
    }

    let split = match kind {
        FeeKind::Transfer { fee_bps } => {
            validate_transfer_fee_bps(fee_bps)?;
            let fee = bps_of(amount_micro, fee_bps);
            let pool = fee / 2;
            FeeSplit {
                net_micro: amount_micro - fee,
                pool_micro: pool,
                treasury_micro: 0,
                // remainder
                burn_micro: fee - pool,
            }
        }

        FeeKind::AiUtility => {
            let fee = bps_of(amount_micro, NETWORK_FEE_BPS);
            let burn = bps_of(fee, BURN_FRACTION_OF_NETWORK_FEE_BPS);
            FeeSplit {
                net_micro: amount_micro - fee,
                pool_micro: 0,
                treasury_micro: fee - burn,
                burn_micro: burn,
            }
        }

        FeeKind::AiInference => {
            let pool = bps_of(amount_micro, AI_INFERENCE_POOL_BPS);
            FeeSplit {
                net_micro: 0,
                pool_micro: pool,
                treasury_micro: 0,
                // remainder
                burn_micro: amount_micro - pool,
            }
        }

        FeeKind::File => {
            let storage = bps_of(amount_micro, FILE_SPLIT_STORAGE_BPS);
            let treasury = bps_of(amount_micro, FILE_SPLIT_TREASURY_BPS);
            FeeSplit {
                net_micro: storage,
                pool_micro: 0,
                treasury_micro: treasury,
                // remainder
                burn_micro: amount_micro - storage - treasury,
            }
        }
    };

    debug_assert_eq!(
        split.total_micro(),
        amount_micro,
        "FEE_SPEC §1.1 conservation violated for {:?}",
        kind
    );
    Ok(split)
}

/// Convenience for the flat per-file fee.
pub fn charge_file_fee() -> FeeSplit {
    charge(FeeKind::File, FILE_FEE_MICRO).expect("FILE_FEE_MICRO is always in range")
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    const KINDS: &[FeeKind] = &[
        FeeKind::Transfer {
            fee_bps: TRANSFER_FEE_BPS_MIN,
        },
        FeeKind::Transfer {
            fee_bps: TRANSFER_FEE_BPS_DEFAULT,
        },
        FeeKind::Transfer {
            fee_bps: TRANSFER_FEE_BPS_MAX,
        },
        FeeKind::AiUtility,
        FeeKind::AiInference,
        FeeKind::File,
    ];

    /// FEE_SPEC §1.1 — the whole point of the module.
    #[test]
    fn conservation_holds_for_all_kinds_and_amounts() {
        let amounts = [
            0u64,
            1,
            2,
            3,
            7,
            999,
            1_000,
            1_001,
            999_999,
            1_000_000,
            1_000_001,
            MAX_CHARGE_MICRO - 1,
            MAX_CHARGE_MICRO,
        ];
        for &kind in KINDS {
            for &amount in &amounts {
                let s = charge(kind, amount).expect("in-range");
                assert_eq!(
                    s.total_micro(),
                    amount,
                    "conservation violated: kind={:?} amount={}",
                    kind,
                    amount
                );
            }
        }
    }

    proptest! {
        /// FEE_SPEC §1.1 over the full amount domain.
        #[test]
        fn conservation_proptest(
            amount in 0u64..=MAX_CHARGE_MICRO,
            fee_bps in TRANSFER_FEE_BPS_MIN..=TRANSFER_FEE_BPS_MAX,
        ) {
            for kind in [
                FeeKind::Transfer { fee_bps },
                FeeKind::AiUtility,
                FeeKind::AiInference,
                FeeKind::File,
            ] {
                let s = charge(kind, amount).expect("in-range");
                prop_assert_eq!(s.total_micro(), amount);
            }
        }
    }

    /// FEE_SPEC §1.2 — burn absorbs remainder; nothing is created or lost.
    #[test]
    fn burn_takes_the_rounding_remainder() {
        // 3 µTET at 1%: fee = 0, so the whole amount survives as net.
        let s = charge(FeeKind::Transfer { fee_bps: 100 }, 3).unwrap();
        assert_eq!(s.total_micro(), 3);

        // Odd inference charge: pool floors, burn takes the extra µTET.
        let s = charge(FeeKind::AiInference, 7).unwrap();
        assert_eq!(s.pool_micro, 3);
        assert_eq!(s.burn_micro, 4);
        assert_eq!(s.total_micro(), 7);

        // File fee at a value that does not divide evenly by 4.
        let s = charge(FeeKind::File, 999).unwrap();
        assert_eq!(s.net_micro, 499); // 50% floor
        assert_eq!(s.treasury_micro, 249); // 25% floor
        assert_eq!(s.burn_micro, 251); // remainder, absorbs both roundings
        assert_eq!(s.total_micro(), 999);
    }

    /// FEE_SPEC §2.1 — bounds are a consensus rule.
    #[test]
    fn transfer_fee_bps_bounds_are_enforced() {
        assert!(validate_transfer_fee_bps(TRANSFER_FEE_BPS_MIN).is_ok());
        assert!(validate_transfer_fee_bps(TRANSFER_FEE_BPS_MAX).is_ok());
        assert!(validate_transfer_fee_bps(500).is_ok());

        for bad in [0u64, 1, 99, 1_001, 2_000, 10_000, u64::MAX] {
            let err = validate_transfer_fee_bps(bad).unwrap_err();
            assert_eq!(
                err,
                FeeError::FeeBpsOutOfRange {
                    got: bad,
                    min: TRANSFER_FEE_BPS_MIN,
                    max: TRANSFER_FEE_BPS_MAX,
                },
                "fee_bps {bad} must be rejected"
            );
            assert!(charge(FeeKind::Transfer { fee_bps: bad }, 1_000_000).is_err());
        }
    }

    /// The two values that were silently accepted before: free transfers and total destruction.
    #[test]
    fn transfer_fee_bps_zero_and_max_rejected() {
        assert!(charge(FeeKind::Transfer { fee_bps: 0 }, 1_000_000).is_err());
        assert!(charge(FeeKind::Transfer { fee_bps: 10_000 }, 1_000_000).is_err());
    }

    /// FEE_SPEC §2.3 — the split must not depend on height. Guards the removed ×5 multiplier.
    #[test]
    fn ai_inference_is_fifty_fifty_across_genesis_epoch() {
        let heights = [
            0u64,
            1,
            GENESIS_EPOCH_BLOCK_LIMIT_MIRROR / 2,
            GENESIS_EPOCH_BLOCK_LIMIT_MIRROR - 1,
            GENESIS_EPOCH_BLOCK_LIMIT_MIRROR,
            GENESIS_EPOCH_BLOCK_LIMIT_MIRROR + 1,
            u64::MAX,
        ];
        let charge_micro = 1_000_000u64;
        let expected = charge(FeeKind::AiInference, charge_micro).unwrap();

        assert_eq!(expected.pool_micro, 500_000, "pool must be exactly 50%");
        assert_eq!(expected.burn_micro, 500_000, "burn must be exactly 50%");
        assert_ne!(expected.burn_micro, 0, "burn must never be zeroed again");

        // `charge` takes no height argument by construction, so the split cannot vary with it.
        // Asserting across the epoch boundary documents the regression this replaced.
        for h in heights {
            let s = charge(FeeKind::AiInference, charge_micro).unwrap();
            assert_eq!(s, expected, "inference split must not vary with height {h}");
        }
    }

    /// FEE_SPEC §2.2 — 80 / 15 / 5, and nothing to the worker pool.
    #[test]
    fn ai_utility_is_eighty_fifteen_five() {
        let s = charge(FeeKind::AiUtility, 1_000_000).unwrap();
        assert_eq!(s.net_micro, 800_000);
        assert_eq!(s.treasury_micro, 150_000);
        assert_eq!(s.burn_micro, 50_000);
        assert_eq!(s.pool_micro, 0);
        assert_eq!(s.total_micro(), 1_000_000);
    }

    /// FEE_SPEC §2.4 — 50 storage / 25 treasury / 25 burn on the flat fee.
    #[test]
    fn file_fee_is_fifty_twentyfive_twentyfive() {
        let s = charge_file_fee();
        assert_eq!(s.net_micro, 500);
        assert_eq!(s.treasury_micro, 250);
        assert_eq!(s.burn_micro, 250);
        assert_eq!(s.pool_micro, 0);
        assert_eq!(s.total_micro(), FILE_FEE_MICRO);
    }

    /// FEE_SPEC §1.3 / §1.4 — no kind may route to a pool the spec does not name.
    /// Transfer never funds treasury; AiUtility and File never fund the worker pool.
    #[test]
    fn no_kind_routes_outside_its_declared_destinations() {
        let t = charge(FeeKind::Transfer { fee_bps: 100 }, 1_000_000).unwrap();
        assert_eq!(t.treasury_micro, 0, "transfer must not fund treasury");

        for kind in [FeeKind::AiUtility, FeeKind::File] {
            let s = charge(kind, 1_000_000).unwrap();
            assert_eq!(s.pool_micro, 0, "{:?} must not fund the worker pool", kind);
        }

        let i = charge(FeeKind::AiInference, 1_000_000).unwrap();
        assert_eq!(i.net_micro, 0, "inference has no counterparty");
        assert_eq!(i.treasury_micro, 0, "inference must not fund treasury");
    }

    #[test]
    fn amount_above_max_supply_is_rejected() {
        let over = MAX_CHARGE_MICRO + 1;
        for &kind in KINDS {
            assert!(charge(kind, over).is_err(), "{:?} must reject over-cap", kind);
        }
    }

    #[test]
    fn fee_micro_is_everything_but_net() {
        let s = charge(FeeKind::Transfer { fee_bps: 1_000 }, 1_000_000).unwrap();
        assert_eq!(s.net_micro, 900_000);
        assert_eq!(s.fee_micro(), 100_000);
        assert_eq!(s.pool_micro + s.burn_micro, 100_000);
    }
}
