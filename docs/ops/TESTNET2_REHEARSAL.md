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

## Part 2: a second operator joins (local rehearsal)

Two nodes on one Mac: operator 1 runs the producer, operator 2 starts a follower in an empty folder
with its own new P2P key, joins, sees the same block, stops and restarts, and then undoes the join
(the rollback). Everything is on 127.0.0.1. Nothing is installed; every file is under one throwaway
folder that the last step deletes.

It was followed on 2026-11-19 by someone who had read only this section. Where they had to guess,
the text was changed: the stop commands stopped a wrapper shell instead of the node (so the restart
and the rollback did not happen), the clone path was not marked as one to change, and step 3 asked
for a hash that step 2 did not print. After those changes every block below ran in one `bash`, in
order, and printed what each step says it must.

`python3 tools/testnet2-rehearsal/test_runbook_commands.py` (also run in CI) checks that every
setting, log line and REST route these blocks use still appears in the node's source, that every
file and command exists, and that it fails,
naming the item, when one is renamed.

You need: macOS (for `sandbox-exec`), `bash`, `python3`, `curl`, `lsof`, and a `TET-Core` release
binary. Ports 18101, 18102, 18201 and 18202 must be free.

**Why the sandbox.** With P2P on, the node always starts mDNS, which sends on every network
interface, not only loopback. `tools/testnet2-rehearsal/no-mdns.sb` refuses port 5353, so mDNS
cannot start (the log shows `failed to create InterfaceState` once per interface; that is expected).
The other sockets are on 127.0.0.1 because every listen setting below names 127.0.0.1, not because
of the sandbox; step 3 and step 5 check this with `lsof`. The one-off run in step 2 has P2P off and
is not sandboxed.

### Step 1. Set up (both operators, one terminal)

Run every block in `bash`, in one terminal, in order: later blocks use the variables and the
functions set here. macOS opens `zsh` by default, so type `bash` first; the `/bin/bash` that comes
with macOS (3.2) is enough. Change the first line to the folder where you cloned the repository.

```bash
REPO=~/TET-OS                                 # change to the folder of your clone
TET_CORE_BIN=$REPO/target/release/TET-Core    # or the path of the binary you were given
test -x "$TET_CORE_BIN" && echo "binary ok"
for p in 18101 18102 18201 18202; do lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null && echo "port $p is in use"; done
W=$(mktemp -d /tmp/tn2-op.XXXXXX) && mkdir "$W/n1" "$W/n2" && echo "work folder $W"

start_node() {  # start_node <n1|n2> <REST port> <P2P port> [VAR=value ...]
  local n=$1 d="$W/$1" rest=$2 p2p=$3; shift 3
  ( cd "$d" || exit 1
    env -i PATH="$PATH" HOME="$d" $(cat "$W/chain.env") \
      TET_GENESIS_FILE="$d/genesis.json" TET_DB_DIR="$d/tet.db" \
      TET_REST_BIND=127.0.0.1:$rest TET_P2P_LISTEN=/ip4/127.0.0.1/tcp/$p2p "$@" \
      nohup sandbox-exec -f "$REPO/tools/testnet2-rehearsal/no-mdns.sb" "$TET_CORE_BIN" \
      > "$d/node.log" 2>&1 &
    echo $! > "$d/node.pid" )
  sleep 1
  ps -o comm= -p "$(cat "$d/node.pid")" | grep -q 'TET-Core$' && echo "$n started, pid $(cat "$d/node.pid")" \
    || echo "$n: node.pid is not a running TET-Core; read $d/node.log"
}
stop_node() {  # stop_node <n1|n2>: stops it by the pid in node.pid, waits up to 30 s
  local p; p=$(cat "$W/$1/node.pid") || return 1
  kill "$p" 2>/dev/null
  for i in $(seq 60); do kill -0 "$p" 2>/dev/null || { echo "$1 stopped"; return 0; }; sleep 0.5; done
  echo "$1 (pid $p) did not stop in 30 s: stop here and look at it with ps -p $p"; return 1
}
wait_live() {  # wait_live <REST port>: waits up to 60 s for the node to answer
  for i in $(seq 120); do curl -s -m 1 127.0.0.1:$1/status/live >/dev/null && return 0; sleep 0.5; done
  echo "nothing answers on $1 after 60 s: read the node.log"; return 1
}
live() {  # live <REST port>: prints "height peers"
  curl -s 127.0.0.1:$1/status/live | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["height"], d["peers"])'
}
```

It must print `binary ok` and the work folder, and no `port … is in use` line.

### Step 2. Operator 1 makes the chain's settings

The founder and treasury ids here are throwaway public ids for this rehearsal only. On the real day
they come from the owner (checklist step 1). The node prints the right genesis hash when the file's
hash is wrong; part 1 explains why that is acceptable here and not on the real day.

```bash
cd "$W"
python3 -c 'import os; print(os.urandom(32).hex())' > founder.txt
python3 -c 'import os; print(os.urandom(32).hex())' > treasury.txt
cat > chain.env <<EOF
TET_ENV=testnet
TET_CHAIN_ID=tet-testnet-2-rehearsal
TET_GENESIS_FOUNDER_WALLET_ID=$(cat founder.txt)
TET_TREASURY_ADDRESS=$(cat treasury.txt)
TET_DB_ENCRYPT=off
TET_ENABLE_P2P=1
TET_NEXUS_P2P_LISTEN=/ip4/127.0.0.1/tcp/0
TET_LEDGER_P2P_LISTEN=/ip4/127.0.0.1/tcp/0
TET_BLOCK_TIME_SEC=2
RISC0_SKIP_BUILD=1
RUST_LOG=info
EOF
gen() {  # gen <genesis_hash>: writes n1/genesis.json
  printf '{"chain_id":"tet-testnet-2-rehearsal","founder_wallet_id":"%s","treasury_address":"%s","genesis_hash":"%s"}\n' \
    "$(cat founder.txt)" "$(cat treasury.txt)" "$1" > n1/genesis.json
}
gen 0x0000000000000000000000000000000000000000000000000000000000000000
HASH=$(env -i PATH="$PATH" HOME="$W/n1" $(cat chain.env) TET_ENABLE_P2P=0 TET_GENESIS_FILE="$W/n1/genesis.json" \
  TET_DB_DIR="$W/n1/probe.db" TET_REST_BIND=127.0.0.1:18101 "$TET_CORE_BIN" 2>&1 | grep -o 'recomputed 0x[0-9a-f]*' | head -1 | cut -d' ' -f2)
echo "genesis hash: $HASH (${#HASH} chars)"
gen "$HASH"
```

It must print the hash and `(66 chars)`; note the hash, step 3 compares it. If it prints `0 chars`, the node did not refuse the zero
hash: stop and read the node's output by running the `env -i …` line on its own.

### Step 3. Operator 1 starts the producer

```bash
start_node n1 18101 18201 TET_AUTO_MINE=1 TET_VALIDATOR_IDS=local-wallet TET_PRODUCER_PEERS=
wait_live 18101 && sleep 6
live 18101
grep -m1 'startup\] public chain' "$W/n1/node.log" | grep -o 'genesis 0x[0-9a-f]*'
PEER1=$(grep -m1 -o 'libp2p PeerId: [A-Za-z0-9]*' "$W/n1/node.log" | cut -d' ' -f3) && echo "PEER1=$PEER1"
lsof -nP -a -p "$(cat "$W/n1/node.pid")" -i | awk 'NR>1 {print $9}' | grep -v '^127\.0\.0\.1:' || echo "loopback only"
```

It prints `n1 started, pid …`. `live` prints a height above 0 and `0` peers. The genesis line shows
the same hash as step 2.
`PEER1` starts with `12D3KooW`. The last line must print `loopback only` and nothing else.

### Step 4. Operator 1 hands over three things

On the real day these travel to the second operator by a channel you both trust. Here they are
copied within the work folder:

- `genesis.json` (byte for byte the producer's file);
- `chain.env` (the same chain settings; it holds only public ids);
- the producer's bootnode line, `/ip4/127.0.0.1/tcp/18201/p2p/$PEER1`, which also carries the
  PeerId that operator 2 pins.

```bash
cp "$W/n1/genesis.json" "$W/n2/genesis.json"
cmp "$W/n1/genesis.json" "$W/n2/genesis.json" && echo "genesis copied"
```

### Step 5. Operator 2 starts a follower with a new key

The folder `n2` is empty apart from `genesis.json`, so the node makes a new P2P key in
`n2/tet.db/` on its first start. A follower does not mine (`TET_AUTO_MINE=0`), and under
`TET_ENV=testnet` it must pin its producer (`TET_PRODUCER_PEERS`) or it refuses to start.

```bash
start_node n2 18102 18202 TET_AUTO_MINE=0 \
  TET_BOOTNODES=/ip4/127.0.0.1/tcp/18201/p2p/$PEER1 TET_PRODUCER_PEERS=local-wallet=$PEER1
wait_live 18102 && sleep 10
PEER2=$(grep -m1 -o 'libp2p PeerId: [A-Za-z0-9]*' "$W/n2/node.log" | cut -d' ' -f3) && echo "PEER2=$PEER2"
test -n "$PEER2" && test "$PEER2" != "$PEER1" && echo "new key"
lsof -nP -a -p "$(cat "$W/n2/node.pid")" -i | awk 'NR>1 {print $9}' | grep -v '^127\.0\.0\.1:' || echo "loopback only"
```

It must print `n2 started, pid …`, `new key` and `loopback only`.

### Step 6. Both nodes have the same block

```bash
live 18101; live 18102
H=$(live 18102 | cut -d' ' -f1); echo "comparing block $((H - 1))"
curl -s 127.0.0.1:18101/explorer/block/$((H - 1)) | shasum -a 256
curl -s 127.0.0.1:18102/explorer/block/$((H - 1)) | shasum -a 256
grep -c 'REMOTE BLOCK APPLIED' "$W/n2/node.log"
```

Both `live` lines show `1` peer and heights within one or two blocks of each other. The two hashes
are the same. The count of applied blocks is above 0. Node 2 does not mine, so it can only have
these blocks from node 1.

### Step 7. Operator 2 stops and restarts the follower

```bash
stop_node n2
grep -c 'SHUTDOWN\] Signal received' "$W/n2/node.log"
cp "$W/n2/node.log" "$W/n2/node-before-restart.log"
curl -s -m 2 127.0.0.1:18102/status/live >/dev/null || echo "nothing answers on 18102"
BEFORE=$(live 18101 | cut -d' ' -f1); echo "producer at $BEFORE while n2 is down"
start_node n2 18102 18202 TET_AUTO_MINE=0 \
  TET_BOOTNODES=/ip4/127.0.0.1/tcp/18201/p2p/$PEER1 TET_PRODUCER_PEERS=local-wallet=$PEER1
wait_live 18102 && sleep 10
live 18102
test "$(grep -m1 -o 'libp2p PeerId: [A-Za-z0-9]*' "$W/n2/node.log" | cut -d' ' -f3)" = "$PEER2" && echo "same key after restart"
```

It prints `n2 stopped`, a shutdown count of `1` and `nothing answers on 18102`; if `stop_node`
says the node did not stop, stop there. After the restart (`n2 started, pid …`), node 2's height is at least `BEFORE`, it has `1` peer,
and it prints `same key after restart` (the key is kept in `n2/tet.db/`).

### Step 8. Rollback: undo the join

The rollback takes node 2 off the network and keeps its data, without touching node 1.

```bash
stop_node n2 &&
mv "$W/n2" "$W/n2.rolled-back" && echo "n2 data kept in $W/n2.rolled-back"
sleep 8
live 18101
curl -s -m 2 127.0.0.1:18102/status/live >/dev/null || echo "nothing answers on 18102"
```

It prints `n2 stopped`; if it does not, stop there and do not move the folder. Node 1 keeps
producing: its height is higher than in step 7, and its peers drop to `0`.
`nothing answers on 18102` must be printed. To rejoin later, move the folder back
(`mv "$W/n2.rolled-back" "$W/n2"`) and run step 5's `start_node` line again; the node starts from
its kept data with the same key.

### Step 9. Clean up

```bash
stop_node n1 && rm -rf "$W" && echo "removed $W"
```

It prints `n1 stopped` and `removed …`. If node 2 was left running (a step stopped early), run
`stop_node n2` first; if `stop_node` fails, the folder is not removed, and you stop the pid it names.

### What part 2 does not show

- **Both nodes are on one machine.** The traffic never leaves loopback: there is no real network
  between them, no NAT, no firewall, no latency or packet loss, and no provider in between.
- **One clock.** Both nodes read the same clock, so clock skew between operators is not tested.
- **No deploy.** Neither node ran through `deploy/provision-seed.sh`, Docker or Caddy. The real
  second operator follows `deploy/demo/README.md` (`TET_NODE_ROLE=demo` or `seed`, with
  `TET_BOOTNODES` and `TET_PRODUCER_PEERS`), which part 2 does not run.
- **No peer discovery.** Node 2 is given node 1's address and pins its key, so finding peers
  any other way (Kademlia, mDNS) is not tested.
- **No mDNS.** The sandbox turns mDNS off. A real host runs it; what it finds there is not tested.
- **A hand-over within one folder.** The genesis file, the settings and the bootnode line were
  copied, not sent between two people. Whether the second operator receives the right ones is a
  question for the real day (checklist step 3).
- **No transactions.** The blocks were empty. Part 2 shows that blocks reach the follower and are
  the same on both nodes, not that a transaction submitted on one node is applied on the other.
- **macOS only.** `sandbox-exec` is a macOS tool. On Linux the same rehearsal needs another way
  to keep the node on loopback.

### The real hosts: what needs the owner's explicit go

Each of these is a separate go, in the daytime, on Helsinki first and Nuremberg only after Helsinki
is checked:

1. Copying a release binary or a `git archive` of the release commit to Helsinki.
2. Running `deploy/provision-seed.sh` on Helsinki (it installs packages and Docker, rewrites the
   firewall and sshd, and starts containers).
3. Putting the testnet-2 `genesis.json` on Helsinki at `/etc/tet/genesis.json`.
4. Starting the testnet-2 producer on Helsinki.
5. Opening the P2P port in the provider's firewall for Helsinki.
6. The same copy, provision, genesis and start on Nuremberg as a follower pinned to Helsinki.
7. Opening the P2P port for Nuremberg.
8. Taking the first backup on each host and copying it off the host (`scp`).
9. A rollback on a real host (stopping a node and moving its data folder aside).
