# testnet-2 rebuild: local rehearsal

A rehearsal of the testnet-2 rebuild on one developer machine, on 2026-11-18. No host was contacted
and no real key was made. Every key-shaped value was a throwaway from `os.urandom`, made fresh on
each run, and only field names and lengths were printed. Every node had P2P off and bound to
127.0.0.1 only.

- Base: `main` at 84db74f.
- Node binary: `TET-Core` release build from a clean tree whose `tet-core/` and `Cargo.lock` match
  84db74f. Nothing was built for this rehearsal.
- To re-run it: `TET_CORE_BIN=<path to TET-Core> python3 -I tools/testnet2-rehearsal/rehearse.py`.
  It exits 0 only if every check passed.
- The deploy script's refusals: `bash deploy/tests/demo-node.test.sh` (CI runs this as well).

## What worked

**The node refuses dev defaults under `TET_ENV=testnet`.** The script sets every setting correctly,
then gets one wrong per case. In every case the node exited with code 2 and printed exactly one
`[FATAL]` line, the one for that setting, and it exited before it created its database. 15 of 15 cases:

| Wrong setting | The node says |
|---|---|
| no `TET_CHAIN_ID` | requires an explicit TET_CHAIN_ID |
| `tet-dev-local`, or the old `tet-local-dev` | refuses the dev chain id |
| no `TET_GENESIS_FILE` | requires TET_GENESIS_FILE |
| a genesis file for another chain | TET_GENESIS_FILE is for chain … |
| a genesis file with an extra field | unknown field |
| the dev founder, or the dev treasury, in the file | refuses the dev founder wallet / treasury |
| a wrong `genesis_hash` | does not match its chain, founder and treasury |
| no `TET_GENESIS_FOUNDER_WALLET_ID` | requires TET_GENESIS_FOUNDER_WALLET_ID |
| the founder in `TET_GENESIS_FOUNDER_WALLET_ID` or `TET_FOUNDER_WALLET` differs from the file | the founder wallet in the environment differs |
| `TET_TREASURY_ADDRESS` differs from the file | TET_TREASURY_ADDRESS is unset or differs |
| `TET_GENESIS_HASH` differs from the file | TET_GENESIS_HASH differs |
| `TET_ENV=TESTNET` in capitals | treated as testnet (requires an explicit TET_CHAIN_ID) |

The two refusals for P2P (a producer without `TET_VALIDATOR_IDS`, a follower without a producer
pin) need P2P on, so they were not run here. The unit test
`a_public_node_never_trusts_every_peer_for_sync` in `tet-core/src/genesis.rs` covers them.

**A producer boots when everything is right.** It ran with `TET_AUTO_MINE=1` and
`TET_VALIDATOR_IDS=local-wallet`, and mined to height 3. The check is that every socket `lsof`
lists for the node is bound to loopback; in this run there was one, on 127.0.0.1.

**The weekly backup and the restore.**
- `scripts/backup-node-data.sh` copied the running node's data directory and printed its two lines.
- The tarball and its `.sha256` were copied to a second directory, standing in for "off the host".
  `shasum -c` passed there, and the printed hash matched the copy.
- A new node with the same testnet settings, not mining, started from the unpacked copy. It was
  at height 3 (the check asks for at least one less than the height read just after the backup),
  stayed there for three block times, and served the same block as the host at one below the
  height read after the backup (block 2). Empty blocks of
  one genesis are identical, so a node that mined could rebuild them; this one does not mine and
  does not advance, so it can only have them from the backup.
- Control: the same restore with the database removed came up at height 0, stayed there, and did
  not serve that block. So the restore checks can fail.

**The deploy script's refusals.** `deploy/tests/demo-node.test.sh` passed. With every input missing
or wrong, `deploy/provision-seed.sh` stops before its root check, so before it changes anything:
no chain id, a dev chain id, no genesis file, a file for another chain, the dev founder or
treasury, a demo-producer that won't mine. The Caddy behaviour part was skipped because there was
no Docker daemon on this machine; CI runs that part.

## What did not work, or was not rehearsed

- **There is no dry-run for the deploy script.** `deploy/provision-seed.sh` has no dry-run flag. Past
  its input checks it installs packages and Docker, rewrites the firewall and sshd, and starts
  containers. It is meant for a fresh Ubuntu host, not for this machine. So only its refusal path
  was rehearsed. Everything after the root check is first run on the real day.
- **No node with P2P on was started.** So the P2P refusals were left to the unit test above, and
  the producer that booted had P2P off, which skips the sync-trust check by design. The first
  P2P-on boot of testnet-2 is on the real day.
- **The real off-host copy (`scp` from the host) was not run.** Rehearsing it needs a host. The
  hash check at the far end was rehearsed.
- **There is no way to make a genesis file other than the node itself.** The rehearsal took
  `genesis_hash` from the node's own error message: it prints the recomputed hash when the file's
  hash is wrong. That works, but it means the node checks a value it also supplied. On the real
  day, a second person should compute the hash on another machine. The payload is in
  `genesis_payload_v1` in `tet-core/src/genesis.rs`.
- The binary has no `--version` flag, so the commit above is inferred from its build tree, not
  read from the binary.

## Checklist for the real day

Before:
1. The owner makes the founder and treasury keys on their own device. Only the public wallet ids go
   into `genesis.json`.
2. Write `genesis.json` with exactly four fields: `chain_id` (`tet-testnet-2`, never a dev id),
   `founder_wallet_id`, `treasury_address` and `genesis_hash`.
3. Compute `genesis_hash` twice, on two machines, by two people, and compare.
4. Run `tools/testnet2-rehearsal/rehearse.py` against the exact binary that will be deployed. It must
   say `0 failed`.
5. Run `bash deploy/tests/demo-node.test.sh` on the release commit. It must say `all passed`.

On the host (`TET_NODE_ROLE=demo-producer`; see `deploy/demo/README.md`):
6. Put `genesis.json` at `/etc/tet/genesis.json`. Set `TET_CHAIN_ID`, `TET_DEMO_DOMAIN` and
   `TET_DEMO_ACME_EMAIL`, then run `provision-seed.sh`.
7. Read the written `.env`. Check it has `TET_ENV=testnet`, the chain id,
   `TET_VALIDATOR_IDS=local-wallet` and an empty `TET_PRODUCER_PEERS`, and that the founder and
   treasury match the file.
8. With the log at info level, check that the node log has the `[startup] public chain tet-testnet-2 genesis 0x…` line, and that
   the hash in it is the one from step 3.
9. Check that REST is published only on 127.0.0.1:5010 and that Caddy is on 80/443
   (`docker compose ps`, `ss -tlnp`).
10. Check that `/status/live` height rises.

After:
11. Run `scripts/backup-node-data.sh` by hand once, and note the host's height and the block at
    one below it right after. Pull the tarball off the host and off the
    provider, and check its SHA-256 there.
12. Restore that tarball on a machine other than the host, with the same testnet settings but
    `TET_AUTO_MINE=0` and P2P off. Check that its height does not change over a few block times,
    that it is at least at the noted height minus one, and that the noted block is the same as
    the host's. (A node that mines would rebuild the same empty blocks without any backup.)
13. From then on, follow `docs/OPS_CHECKLIST.md`: pull the weekly backup, and run a restore test
    every month.
