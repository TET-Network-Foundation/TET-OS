# Machine notebook

**Status: prototype.** Local only. Not for military or dual-use systems.

A machine keeps its own notebook: a device (a Mac today, a Raspberry Pi or Jetson later) records
sensor readings, signs each one with its own TET key, and chains every record to the one before it.
Anyone holding the folder can later replay the log and see whether it is intact and in order. It adds
no new cryptography: signing and checking are `tet-cli agent sign` and `tet-cli agent verify` (the
agent envelope in [docs/AGENT_IDENTITY.md](../../docs/AGENT_IDENTITY.md)).

Why it exists: it is the opening step of the robot line, a machine that keeps its own notebook.

## What `verify` shows, and what it doesn't

Shows:
- which key signed each record
- that the records are in this order
- that each record existed before the next one in the same chain

Does not show:
- that the reading is true
- that the device clock was right
- where the device was
- who operates the device
- that the key was not copied

## The device key

`init` makes a **new** key for the device. It is never the owner's key, and the owner's phrase never
goes near this tool. The device's 12 words are written to `<dir>/device.key` with mode 0600, and only
the key id is printed. tet-cli receives the words through the `TET_MNEMONIC` environment variable,
never as an argument (arguments are visible to every process through `ps`). Anyone who copies
`device.key` can sign as the device, which is why "the key was not copied" is on the list above.

## Run it on the Mac

```sh
cargo build -p tet-cli --release        # the only build step
export TET_CHAIN_ID=… TET_GENESIS_HASH=…  # the chain to sign for: a node's GET /chain shows both
python3 tools/machine-notebook/notebook.py init   --dir ~/notebook          # prints the key id
python3 tools/machine-notebook/notebook.py record --dir ~/notebook --source loadavg
echo '{"value": 21.5, "unit": "celsius"}' | python3 tools/machine-notebook/notebook.py record --dir ~/notebook --source stdin-json
python3 tools/machine-notebook/notebook.py run    --dir ~/notebook --source loadavg --every 60   # stops at 22:00
python3 tools/machine-notebook/notebook.py verify --dir ~/notebook
```

`init` saves the chain in `<dir>/chain.json`; every later command uses it, so a log is always signed
and checked against the same chain. `run` loops in the foreground and stops by itself at `--until`
(default 22:00, local time). There is no daemon, launchd job or cron entry.

## Run it on a Pi

The same commands. Build `tet-cli` on the Pi (`cargo build -p tet-cli --release`) or copy an aarch64
build to it, then pass `--tet-cli /path/to/tet-cli` or set `TET_CLI`. On Linux `--source cpu-temp`
reads `/sys/class/thermal/thermal_zone0`; on macOS it refuses. Python 3 with the standard library
is all it needs.

## What a record holds

```json
{"kind":"tet_machine_log_v1","local_clock":"2026-11-07T18:52:52Z","prev":"<sha256 of the record before, or 64 zeros>","reading":{"source":"loadavg","unit":"load-1m","value":1.92},"seq":1,"v":1}
```

Canonical JSON (sorted keys, no spaces) in `records/<seq>.json`, its envelope in
`records/<seq>.json.sig.json` (payload type `application/vnd.tet.machine-log+json`), and its SHA-256
appended to `chain.txt`. The clock is the device's, in UTC, so a record carries no time-zone offset.
No hostname, IP address, location or name goes into a record or a log line. `stdin-json` accepts
exactly `{"value", "unit"}`, so nothing else can ride along.

## Publishing (off unless you name a node)

`publish --dir <dir> --seq <n> --node <url>` puts one record's hash in the node's public registry
(`POST /sigs/publish`). The node stores hash-only records, so the notebook signs the record's
SHA-256 as `application/vnd.tet.sha256` (saved as `records/<n>.hash.sig.json`) and a consent over
that envelope's SHA-256 (`tet sig publish v1`), both with `tet-cli agent sign`, exactly as
`tet-core/src/sigs.rs` checks them. The reading itself never leaves the device. Sign for the node's
own chain (`TET_CHAIN_ID`, `TET_GENESIS_HASH` at `init`), or it refuses the record.

`verify --node <url>` finds each published record on that node and re-checks its anchor the way the
page does (`checkStamp`): a mined file-stamp transaction in a canonical block that names that
record. An anchor places a record before a block on that node's chain; blocks carry no time yet.
Without `--node`, verify prints `stamp: not checked (no node)`.

## The guard

`python3 tools/machine-notebook/test_notebook.py` (CI's rust job, and `scripts/run_guards.sh`). Three
records under a temporary key; one byte flipped, two records swapped, one deleted, and one re-signed
with a `prev` that skips its predecessor must each read INVALID for their own reason. It needs a built
`tet-cli` and fails, rather than skips, without one.
