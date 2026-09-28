# QA matrix — S11

**Status:** audit 2026-09-28; gaps #2, #6, #7, #8, #9 and #10 closed 2026-09-29 (see
[What changed](#what-changed-2026-09-29) at the end). Cells below are updated; the ranked gap list
is kept as written, with outcomes appended, because the reasoning is worth more than the scoreboard.

267 `#[test]`/`#[tokio::test]` functions across 9 files. Cells cite real test names, read rather
than inferred from the name — several tests do not do what their name suggests, which is the point
of the exercise.

## How to read this

**Columns** are the conditions that actually produced bugs in this repository this month, not a
generic checklist.

**Three structural facts** decide most cells, and each is the reason a whole column is thin:

1. **Only 13 tests use a real libp2p swarm** — the 10 in `mod block_sync` (`tests.rs:4025-5009`)
   and 3 in `p2p.rs`. Everything else calls handlers directly. So a test named
   `gossiped_tx_with_a_broken_signature_is_rejected` calls `p2p::handle_tx_broadcast(...)` in
   process; it proves the handler refuses, and proves nothing about the wire path in front of it
   (deserialization, gossipsub validation, message-size limits, topic routing). Wherever a cell
   says *handler-level*, that gap is what it means.
2. **Every real-prover test is `#[ignore]`.** Ten tests are ignored; the proving ones need
   `RISC0_SKIP_BUILD=0` and the `zk-prove` feature. ~~CI does not run them either.~~ **Closed
   2026-09-29:** the `zk-real` workflow runs them weekly, on demand, and on pushes touching the zk
   paths. They are still `#[ignore]` for the default suite, which is correct — the point was that
   *nothing* ran them.
3. ~~**No test restarts a node.**~~ **Closed 2026-09-29.** Two tests now do:
   `anon_root_history_survives_a_restart` and
   `rest_admitted_tx_survives_a_restart_and_a_mined_one_does_not`, both closing a store and
   reopening it at the same path. Writing them found a real bug — a REST-admitted transaction died
   with the process — now fixed. Restart cells for *other* behaviours (Tmail, files, block sync)
   remain UNTESTED.

**Negative controls.** 22 of 188 commits record one. Where a commit body documents restoring the bug
and watching the test fail, the cell is marked ✅ctl. Where no record exists the cell is marked
**⚠ no ctl** — that is *unverified*, not proof the control was never run, but CLAUDE.md requires it
to be recorded, so an unrecorded control counts as one that did not happen.

Legend: `test_name` = covered · **UNTESTED** · *N/A (reason)* · ✅ctl = negative control on record ·
⚠ no ctl = no control recorded

---

## Matrix

### Money

| Behaviour | Single node | Follower→seed | Late joiner | After restart | Real prover | Malicious peer | Mixed versions | Clock skew | Cap/limit reached |
|---|---|---|---|---|---|---|---|---|---|
| **Send coins** | `signed_transfer_rejects_replay_nonce`, `mldsa44_hybrid_transfer_sign_verify_roundtrip`, `transfer_fee_half_burn_reduces_total_supply_and_tracks_burned` | `block_sync::at_f1_follower_sends_money_and_producer_settles_it` (real swarm) | **UNTESTED** | **UNTESTED** | *N/A (no ZK in transfer)* | `gossiped_tx_with_a_broken_signature_is_rejected` ⚠ no ctl — handler-level | **UNTESTED** | `wallclock_time_changes_spendability_for_the_same_block` ⚠ no ctl — pins the defect, does not fix it | `hard_cap_never_exceeded`, `block_reward_fails_when_worker_pool_is_depleted` |
| **Claim / airdrop / faucet** | `initial_faucet_airdrop_grants_once_and_second_call_is_already_claimed`, `admin_rest_faucet_once_per_wallet_and_ip_rl` | `consensus_faucet_path_keeps_nodes_in_agreement` ⚠ no ctl, `welcome_airdrop_consensus_tx_predicts_same_root_on_all_nodes` — both compute roots in process, no swarm | **UNTESTED** | **UNTESTED** | *N/A* | `welcome_airdrop_offchain_claim_forks_node_state_root` ⚠ no ctl (pins the defect) | **UNTESTED** | **UNTESTED** | `ledger_aml_chf_limit_is_enforced_at_1000` |

### Tmail

| Behaviour | Single node | Follower→seed | Late joiner | After restart | Real prover | Malicious peer | Mixed versions | Clock skew | Cap/limit reached |
|---|---|---|---|---|---|---|---|---|---|
| **Tmail send (E2EE)** | `e2ee_encrypt_route_blind_decrypt_cycle`, `tmail_envelope_with_burn_flag_verifies` | **UNTESTED** in-suite (live-run only, SPRINT_PLAN CH↔FI) | **UNTESTED** | **UNTESTED** | *N/A* | `tmail_basic_envelope_still_verifies_after_burn_relaxation` ⚠ no ctl — handler-level | **UNTESTED** | *N/A* | `at7_a_read_side_cap_holds_when_stored_rows_exceed_retention` ✅ctl |
| **Burn-after-read** | `tmail_burn_revoke_by_receiver_destroys_the_message`, `..._by_sender_...` ⚠ no ctl | `tmail_burn_revoke_round_trips_as_a_network_event` — serialization only, no swarm | **UNTESTED** | **UNTESTED** | *N/A* | `tmail_burn_revoke_with_a_forged_signature_is_dropped` ✅ctl, `..._from_a_third_party_is_dropped`, `tmail_burned_message_is_not_resurrected_by_re_gossip` ✅ctl — all handler-level | **UNTESTED** | *N/A* | `tmail_burn_block_max_reads_is_rejected` |
| **Scheduled release** | `at3_scheduled_message_withholds_ciphertext_until_release`, `at3_withheld_row_serializes_without_any_ciphertext`, `tmail_time_lock_requires_a_future_release` | **UNTESTED** in-suite (live CH↔HEL only) | **UNTESTED** | **UNTESTED** | *N/A* | `tmail_unsigned_time_lock_block_cannot_contradict_or_smuggle_a_vdf` ⚠ no ctl | **UNTESTED** | **UNTESTED** — release is `now_ms` compared to a signed field; two nodes with skewed clocks releasing at different times is not covered | *N/A* |
| **Anonymous send** | `s8_anonymous_envelope_two_phase_verify`, `s8_anon_nullifier_is_bound_and_hiding`, `s8_anon_merkle_path_binds_the_leaf` | **UNTESTED** in-suite (live CH↔HEL only) | `s8_late_joiner_converges_after_sync_and_one_epoch` ✅ctl — store-level, not over the wire | **UNTESTED** | `s8_anon_membership_real_receipt_verifies_with_mocks_disabled` **#[ignore]** | `s8_anonymous_wrong_receipt_is_refused` ✅ctl, `s8_anonymous_nullifier_replay_is_refused` ✅ctl, `s8_anonymous_envelope_journal_must_match_the_receiver` ✅ctl, `s8_receipt_cache_refuses_a_hash_mismatch` ⚠ no ctl | **UNTESTED** | `s8_registration_eligibility_is_the_next_epoch_boundary` — one node's clock only | `s8_measure_receipt_size_against_the_gossip_ceiling` **#[ignore]** |
| **Anonymity registry** | `s8_registration_verifies_and_changes_the_root`, `s8_root_is_independent_of_registration_arrival_order`, `s8_registry_path_verifies_against_the_root` | `s8_registry_gossip_event_admits_through_the_shared_path` ⚠ no ctl — handler-level | `s8_late_joiner_converges_after_sync_and_one_epoch` ✅ctl, `s8_sync_pagination_covers_everything_and_ends` ⚠ no ctl | **UNTESTED** — `anon_roots` epoch memo is in-memory (`Mutex<Vec<…>>`); what a restart does to root history is untested | *N/A* | `s8_registration_signed_by_another_wallet_is_refused` ✅ctl, `s8_sync_cannot_import_a_forged_registration` ⚠ no ctl | **UNTESTED** | `s8_root_window_accepts_recent_and_refuses_stale`, `s8_superseded_root_stays_acceptable_inside_the_window` | `s8_registry_is_capped_and_refuses_rather_than_evicts`, `s8_registration_flood_does_not_invalidate_an_honest_root` ✅ctl, `s8_commitment_updates_are_rate_limited_per_wallet` |

### Network

| Behaviour | Single node | Follower→seed | Late joiner | After restart | Real prover | Malicious peer | Mixed versions | Clock skew | Cap/limit reached |
|---|---|---|---|---|---|---|---|---|---|
| **Block sync** | `sync.rs`: 28 tests (driver state machine, range building, gating) | `block_sync::chain_sync_three_nodes_in_process`, `tip_state_root_strict_match_after_mine`, `in_process_three_nodes_auto_mine_with_sync_gate_per_node` — **real swarms** | `block_sync::chain_sync_recovers_after_peer_disconnect`, `sync_gate_prevents_fork_under_concurrent_start` | **UNTESTED** — `bootnode_failure_recovery_no_manual_intervention` kills a peer and never restarts it | *N/A* | `catch_up_driver_apply_failure_blacklists_and_switches_peer`, `catch_up_driver_range_failed_blacklists_peer`, `peer_tip_conflict_marks_not_synced` ⚠ no ctl — driver-level, fed synthetic responses | **UNTESTED** | **UNTESTED** — block validity does not check timestamps against local time | `plan_catch_up_range_request_caps_batch`, `build_range_respects_block_count_cap`, `orphan_buffer_enforces_capacity_and_ttl` |
| **Tx delivery** | `pending_local_tx_is_rebroadcast_until_mined_then_forgotten`, `gossiped_tx_already_mined_is_dropped_not_requeued` | `block_sync::at_f1_follower_submits_tx_and_mining_peer_settles_it`, `follower_tx_settles_on_the_mining_peer_with_gossip_disabled` ⚠ no ctl — **real swarms**, and the second isolates the direct `/tet/v1/tx-submit` path | **UNTESTED** | **UNTESTED** — mempool is in memory; a restart loses it and nothing asserts what happens | *N/A* | `gossiped_tx_with_a_broken_signature_is_rejected`, `gossiped_tx_is_never_marked_for_rebroadcast`, `gossiped_tx_duplicate_is_queued_once` ⚠ no ctl — handler-level | **UNTESTED** | *N/A* | `TET_TX_REBROADCAST_MAX` ceiling inside the rebroadcast test |
| **File share** | 16 `file_*` tests (preimage, envelope, store, expiry, delete) | `file_two_node_send_receive_flow` — two **stores**, not two swarms | **UNTESTED** | `file_store_expiry_hides_entries` covers TTL, not restart — **UNTESTED** | *N/A* | `file_envelope_verify_rejects_wrong_signer`, `..._tampered_sha256`, `..._bad_version_and_kind`, `file_delete_request_rejects_wrong_signer` ⚠ no ctl | **UNTESTED** — `file_envelope_verify_rejects_bad_version_and_kind` refuses unknown versions, which is the closest thing | *N/A* | `file_store_rejects_oversize_blob`, `file_envelope_verify_rejects_size_out_of_range` |
| **Seed provisioning** | *N/A (shell, not Rust)* | **UNTESTED** — `deploy/*.sh` has no test of any kind; CI never runs it | **UNTESTED** | **UNTESTED** — the redeploy procedure is manual and was exercised by hand twice this month | *N/A* | *N/A* | **UNTESTED** | *N/A* | **UNTESTED** |

### Compute

| Behaviour | Single node | Follower→seed | Late joiner | After restart | Real prover | Malicious peer | Mixed versions | Clock skew | Cap/limit reached |
|---|---|---|---|---|---|---|---|---|---|
| **AI infer** | `ai_utility_micro_tet_split_is_nonzero_for_0_001_tet`, `worker_daemon_mock_flops_are_dynamic_per_task_and_worker` (**mock only**) | **UNTESTED** | **UNTESTED** | **UNTESTED** | **UNTESTED** — the inference path has no real-prover test | `gossiped_ai_result_writes_no_balance` ⚠ no ctl, `ai_infer_settlement_direct_write_forks_state_root` ⚠ no ctl (pins the defect) | **UNTESTED** | *N/A* | **UNTESTED** |
| **ZK verify** | `fips204_vectors.rs`: 4 ACVP tests; `browser_wallet_hybrid_signatures_verify_on_the_node` ✅ctl, `wasm_signer_signatures_verify_on_the_node`, `browser_wasm_and_node_derive_the_same_mldsa44_pubkeys` | **UNTESTED** | **UNTESTED** | **UNTESTED** | `s8_anon_membership_real_receipt_verifies_with_mocks_disabled`, `s8_guest_elf_is_embedded_in_a_zk_build` ✅ctl, `s8_anon_membership_executor_cost` — **all #[ignore]** | `invalid_zk_receipt_is_rejected_without_slashing` ⚠ no ctl, `invalid_zk_candidate_is_rejected_without_slashing` ✅ctl, `invalid_zk_slash_moves_entire_worker_bond_to_ecosystem` | **UNTESTED** | `zkcourt_challenge_rejected_after_window_closes` — single clock | `s8_measure_sync_verification_cost` **#[ignore]** |

---

## Notes on specific cells

**`mainnet_panics_when_mock_zk_is_enabled`** is the only thing standing between a mock receipt and
mainnet. It is a single-node assertion about a startup check; nothing tests that a *peer* running a
mock build is rejected. That is the mixed-versions column in one sentence.

**`tmail_burn_revoke_round_trips_as_a_network_event`** tests JSON serialization both ways. It does
not put the event on a wire. The same is true of `file_announce_network_event_roundtrips_json`.

**`file_two_node_send_receive_flow`** opens two `FileStore`s in one process. It is a useful test of
store semantics and is not a two-node test in the network sense.

**`welcome_airdrop_offchain_claim_forks_node_state_root`** and
**`ai_infer_settlement_direct_write_forks_state_root`** are pins on known defects: they assert the
bug still behaves as described so the Phase 1 fix can be verified against them. They are not
protection.

---

## Top 10 gaps, ranked

Ranked as instructed: reachable from 8002 by strangers first, then things that break on seed
restart, then the rest.

### Reachable from 8002 by a stranger

**1. No test drives a hostile message over a real swarm.**
Every "malicious peer" cell is handler-level: the test constructs a struct and calls
`handle_tx_broadcast` / `admit_anon_registration` / the burn-revoke handler directly. The handlers
are well covered. What is untested is everything in front of them — gossipsub validation, frame
decoding, size limits, topic routing — and that is the part a stranger on 8002 actually touches
first. Two of this month's bugs lived exactly there: the lost-subscription bug (a connected node
silently receiving nothing) and `NoPeersSubscribedToTopic`.
*Shape of the fix:* extend `mod block_sync`, which already builds real swarms, with a peer that
sends malformed frames, oversized messages and wrong-topic traffic.

**2. Oversized / malformed gossip frames are untested at any level.**
`DEFAULT_GLOBAL_GOSSIP_MAX_MSG_BYTES` is 128 KiB and `s8_measure_receipt_size_against_the_gossip_ceiling`
— the one test that reasons about it — is `#[ignore]`. Nothing asserts what a node does when a peer
sends 129 KiB, or a truncated frame. Anonymous receipts are ~257 KB, so this ceiling is load-bearing
for the announce-then-pull design.

**3. The anonymous receipt-pull request/response path has no adversarial test over the wire.**
`s8_receipt_cache_refuses_a_hash_mismatch` covers the cache and has no control on record. The
serving side — a peer requesting receipts it should not get, or requesting many at once — is
untested. This is reachable by anyone who can dial 8002.

**4. Registry sync serving is untested against a hostile requester.**
`s8_sync_pagination_covers_everything_and_ends` (no control on record) tests the cursor walk on the
happy path. Nothing tests a peer that asks for page after page, sends a malformed cursor, or opens
many concurrent syncs. The per-peer RPS limiter and the 30 s verification budget were both added
this week and neither has a test.

**5. Mixed versions: untested everywhere, and the protocol is built to make it matter.**
`TxV1` is `#[serde(tag = "kind")]` and blocks carry `Vec<SignedTxEnvelopeV1>`, so a node on an older
binary cannot *deserialize* a block containing a new variant — documented in
`PHASE_1_GENESIS_SPEC.md` §2 as the reason `TmailPin` needs a flag day. That failure mode is
specified and never exercised. A stranger running last month's binary is the likeliest way to meet
it.

### Breaks on seed restart

**6. Nothing restarts a node. Not one test.**
The single largest structural hole. Untested consequences include: the mempool is in memory and a
restart drops it; `anon_roots` (the epoch→root memo) is a `Mutex<Vec<…>>` and its post-restart
behaviour is unknown; pending rebroadcast bookkeeping is in memory. The seed was restarted twice
this month by hand and each time the check was manual — PeerId unchanged, height continued, registry
survived. That check should be a test.

**7. The anonymity root history does not survive a restart, and no test says what happens.**
Related to 6 but worth its own line, because the failure is silent and delayed: after a seed
restart, proofs built against a pre-restart root may be rejected with no error naming the cause.
That is exactly the shape of the CH↔HEL bug that took a day to find.

**8. Seed provisioning has no test of any kind.**
`deploy/*.sh` — `provision-seed.sh`, `remote_deploy.sh`, `reset_db.sh`, `seed-healthcheck.sh` — is
untested and CI never runs it. `reset_db.sh` deletes a live ledger. The redeploy that swapped the
binary this month was driven by hand, and the verification that it was a swap and not a reset was
also by hand.

### The rest

**9. Every real-prover test is `#[ignore]`, so the ZK path is unverified by default.**
`s8_anon_membership_real_receipt_verifies_with_mocks_disabled` is the test that would have caught
the bincode-vs-risc0-serde decoder bug and the empty guest ELF — both real defects that survived for
months behind mocks. It exists, it passes, and nothing runs it. `zk-image.yml` builds the image
monthly but does not run the proving tests. Per CLAUDE.md's own mock-only rule, this is the rule
being followed in letter and not in effect.

**10. Twelve guards have no negative control on record.**
Including `wallclock_time_changes_spendability_for_the_same_block` — the pin on the single most
important Phase 1 consensus defect — and `gossiped_ai_result_writes_no_balance`,
`invalid_zk_receipt_is_rejected_without_slashing`, `bare_json_signed_envelope_is_rejected_off_mainnet`,
`envelope_signed_against_a_different_genesis_hash_is_rejected`,
`caac_complete_without_signature_is_rejected_and_writes_no_record`,
`zkcourt_challenge_without_signature_is_rejected_and_locks_no_bond`. Six vacuous guards were caught
this month by running the control; these predate that discipline and have not been re-checked.
*Cheapest item on this list and the one with the best history of finding real problems.*

---

## What this matrix is not

It does not rank by likelihood or by blast radius, only by the order asked for. It does not claim
the UNTESTED cells are broken — most are probably fine. It claims nobody has checked, which for a
system about to be public is the thing worth writing down.

Live-run evidence (CH↔HEL, seed↔follower) exists for AT-3, AT-4 and AT-5(a) and is recorded in
`SPRINT_PLAN.md`. Those runs are real and they are not tests: they were driven by hand, they are not
repeatable by CI, and they do not fail anybody's build when they regress. Where a cell says
"UNTESTED in-suite (live-run only)", that is what it means.

---

## What changed, 2026-09-29

Six of the ten ranked gaps are closed. Each closure has a negative control recorded in its commit.
Three of them turned up a real bug, which is the argument for writing the matrix rather than
reasoning about coverage from memory.

| Gap | Status | Commit | What it actually found |
|---|---|---|---|
| #2 oversized / malformed frames | **closed** | `61e8609` | Two surprises. libp2p drops oversized frames in the codec, so the app-level length check is a *second* line of defence, not the first. And an oversized frame **costs the sender its connection** — measured: an honest frame from the same peer arrives in 0.04 s without it, nothing in 30 s with it |
| #6 / #7 restart | **closed** | `2efe104` | **A REST-admitted transaction died with the process.** Submitted, `202` returned, gone on restart, no retry, nothing to tell the sender. Now persisted in `mempool_pending_v1`. The anon root history was already safe — recomputed from the registry — verified rather than assumed |
| #8 `reset_db.sh` | **closed** | `5af365e` | The script deleted a path the seed **stopped using**, so it would have reported a successful wipe having deleted nothing. Its `read -p` prompt was also no safeguard: demonstrated bypassed by `yes \|` |
| #9 real prover in CI | **closed** | `c150bac` | `cargo test` **exits 0 when a filter matches nothing**, so a bare `-- --ignored` would have gone green running nothing after a rename. Each test is named and asserted to be "1 passed" |
| #10 twelve missing controls | **closed** | `ad51b6e` | All twelve fire; none vacuous. One imprecise and fixed: `envelope_signed_against_a_different_genesis_hash_is_rejected` passed with *either* binding removed, because `genesis_hash` is derived from `chain_id` |

Still open, and unchanged: **#1** (no hostile message driven over a real swarm — #2 covers frames,
not forged application messages), **#3** (receipt-pull path), **#4** (registry sync serving under a
hostile requester), **#5** (mixed versions).

Note on #1 and #2: closing #2 does **not** close #1. #2 covers malformed and oversized *frames* —
the transport layer. #1 is about application-level hostile messages (a forged registration, a
replayed nullifier, a tampered burn revoke) driven over a wire rather than into a handler. Those
handlers are well tested; the wire path in front of them is still only covered for frame shape.
