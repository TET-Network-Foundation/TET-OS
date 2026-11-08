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
{"clock_utc":"2026-11-07T18:52:52Z","kind":"tet_machine_log_v1","prev":"<sha256 of the record before, or 64 zeros>","reading":{"source":"loadavg","unit":"load-1m","value":1.92},"seq":1,"v":1}
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

## Tested against a local node

2026-11-07, on a Mac: a dev node from this repository (`docker compose -f docker-compose.yml -f
docker-compose.dev.yml up -d --build tet-core`, P2P off, so it joined nothing), tet-core at 5dd6895.
A fresh folder and a new test-only device key. The phrase and `device.key` are not shown here.

```console
$ curl -s localhost:5010/chain
{"chain_id":"tet-local-dev","genesis_hash":"0x9d6ccb1354b31419ade378aef68de58e854938df795b69cf76777e3483efbb36"}
$ export TET_CHAIN_ID=tet-local-dev TET_GENESIS_HASH=0x9d6ccb13…efbb36    # exactly as /chain gives it
$ notebook.py init --dir $D
tet-ed25519:9ed6f592718e89b309a7cda44f80fb0a68f14709e37893e1327c7a834169ea7a
$ notebook.py record --dir $D --source loadavg      # three times
seq 1: 12.25 load-1m
seq 2: 12.25 load-1m
seq 3: 12.25 load-1m
$ notebook.py publish --dir $D --seq 2 --node http://127.0.0.1:5010
published record 2: TET-26XN-A7J1
$ notebook.py verify --dir $D --node http://127.0.0.1:5010
VALID
  3 records, all signed by tet-ed25519:9ed6f592718e89b309a7cda44f80fb0a68f14709e37893e1327c7a834169ea7a
  … (the Shows / Does not show lists)
stamp: record 1: not on this node
stamp: record 2: published, not anchored
stamp: record 3: not on this node
$ notebook.py verify --dir $D
VALID
  …
stamp: not checked (no node)
```

Two things this found, both fixed in `notebook.py` only:
- `init` refused the node's own genesis hash, because `/chain` writes it with `0x`. The signature
  binds that string as written, so the notebook now keeps it exactly as given. With the `0x`
  stripped by hand the node refuses the record: `the record's signatures don't verify:
  Ed25519("Ed25519Failed")`.
- `verify --node` listed only the records this notebook had published, so records 1 and 3 were
  missing rather than "not on this node". It now asks about every record, and a registry record
  made elsewhere counts only if it re-verifies here as this device's hash-only record of it.

Not tested against a node yet: an anchored record (that needs a mined file-stamp transaction; see
"Anchoring" below). The anchor check is covered by the guard against a stub.

## Anchoring: not possible from the notebook yet

`verify --node` re-checks an anchor, but the notebook cannot make one. Checked 2026-11-08 against
`main` (d06d799): no `tet-cli` command and no REST route stamps a given hash on its own. Every way
in needs a signature that only browser code makes today, and the notebook adds no cryptography.

Where the stamp is built today (all in `tet-network/ui/app/lib/`):

- `hash_stamp.ts`, `anchorRecord()`: the whole flow for a hash-only record. Upload the record,
  encrypted to its signer (`/files/upload`); get its `FileFee` transaction submitted; wait until that
  transaction is mined (`checkStamp()`); then give the node its hash (`publishAnchor()` in
  `proof_code.ts`, `POST /sigs/publish` with `anchor_tx`).
- `files_fee.ts`, `settleFileFee()`: the `FileFee` transaction. `"demo-sponsor"` posts a
  `SponsorFeeRequestV1`, signed by the file's sender, to `POST /demo/files/sponsor-fee`
  (`tet-core/src/demo_sponsor.rs`; only for files uploaded through that node, and only where a
  sponsor is configured). `"self"` signs a `TxV1::FileFee` and posts it to `POST /files/fee`.
- `files.ts`, `buildFileFeeEnvelopeV1()`: builds and hybrid-signs that `TxV1::FileFee`.
- `sign_anything.ts`, `stampFileId()`: the `file_id` a stamp carries, the leading 16 bytes of
  the record's SHA-256 as a UUID (`tet-core/src/sigs.rs`, `stamp_file_id()`, is the same).

What it would take: a `tet-cli` command that signs a `TxV1::FileFee` (or a `SponsorFeeRequestV1`)
with the same signer the node already verifies. That is a change to `tet-cli`, so it is the owner's
call, and it is not in this tool.

## The guard

`python3 tools/machine-notebook/test_notebook.py` (CI's rust job, and `scripts/run_guards.sh`). Three
records under a temporary key; one byte flipped, two records swapped, one deleted, and one re-signed
with a `prev` that skips its predecessor must each read INVALID for their own reason. It also checks
the chain binding is kept as `/chain` gives it, the publish body, and `verify --node` against a stub
(not on the node, published, anchored, an anchor for another file, another key's record). It needs a built
`tet-cli` and fails, rather than skips, without one.
