# Machine notebook: the opening half hour

**Status: prototype.** Everything here runs on your own machine. Nothing is sent anywhere. No public
TET node runs today, so this guide does not use one.

This is for a hobby maker with a laptop or a Raspberry Pi who wants a device to keep its own signed
log. By the end you will have a notebook folder with a few signed readings, a one-time permit that
was used once and refused the second time, and a check that reads the log as VALID. Steps 6 and 7
add thirty labelled items in a second notebook and a check by someone else on their own machine. The
[README](README.md) has the details behind every step.

Every command below is followed by what the tool printed when it was run on 2026-11-17 (Steps 6
and 7: 2026-11-19) on a Mac (Apple silicon, macOS, Python 3.14.4). The only edit to that output is
the home folder, shown as `~`. Your key id, permit id and load values will differ.

## What you need

- macOS or Linux. A Raspberry Pi running Linux should work the same way, but nobody has run this
  guide on a Pi yet. Windows is not supported (the `loadavg` source does not exist there).
- Python 3.9 or newer, standard library only. No pip packages.
- git and a Rust toolchain (`rustup`), to build `tet-cli`. After installing Rust, open a new
  shell so `cargo` is on your PATH.
- A C compiler and linker for the build: on macOS the Xcode Command Line Tools, on Debian or
  Raspberry Pi OS the `build-essential` package.

## Step 1: get tet-cli (this is the slow part)

There is no tagged release of `tet-cli` yet. Until v0.1 is tagged with binaries, getting it means
building it from the repository:

```sh
cd ~
git clone https://github.com/TET-Network-Foundation/TET-OS.git
cd TET-OS
RISC0_SKIP_BUILD=1 cargo build -p tet-cli --release
```

The `cd ~` puts the repository in your home folder, at `~/TET-OS`; this guide calls that folder the
repository root. Any other folder works if you remember where it is.

This block was run on 2026-11-19 from an empty folder, with a local copy of the repository in place
of the URL and with the crates already downloaded. Cargo's output is long and is not copied here; it
ends with a line that starts `Finished`. If it ends with `error` instead, see "Where people get
stuck" below.

How long that takes, honestly:

- On an Apple M3 Mac (8 cores, 16 GB), four builds into an empty `target/` took between 2 min 43 s
  and 4 min 17 s (two people, two runs, 2026-11-19; the slower ones while the Mac was busy with other
  work). In all four the crates were already downloaded. The first download on a new machine was not timed, so your first build will take
  longer, by however long your connection needs.
- It is the long step of this guide. It has not been timed on Linux or on a Pi.
- On a Raspberry Pi it has not been tried; expect it to be much slower than on a laptop, to need a
  lot of memory (a Pi with 1 or 2 GB may need `cargo build -j1` or more swap), and several GB of
  free disk for `target/`.
- So start the build before you plan to sit down with the rest of this guide.

Why `RISC0_SKIP_BUILD=1`: `tet-cli` depends on a crate that otherwise compiles a RISC Zero guest
program, which needs the RISC Zero toolchain. The notebook does not use that program; it only uses
`tet-cli agent sign` and `tet-cli agent verify`. CI builds with the same setting. The line without
the variable (`cargo build -p tet-cli --release`) will probably fail on a machine without the RISC
Zero toolchain; that has not been checked on a clean machine.

When it is done, `target/release/tet-cli` exists. Check it:

```console
$ target/release/tet-cli --version
tet 0.1.0
```

Run every command below **from the repository root**. The notebook looks for
`target/release/tet-cli` from where you stand. From anywhere else, add `--tet-cli <path>` or set
`TET_CLI=<path>`.

## Step 2: make a notebook with a new device key

A notebook signs for one chain. With no node to ask, any chain id and any 64 hex characters will do.
Pick them once and keep them; the notebook saves them in `chain.json` at `init`. The two `export`
lines last only for this shell, which is fine: after `init`, every command reads `chain.json`.

```sh
export TET_CHAIN_ID=maker-local
export TET_GENESIS_HASH=$(printf 'maker local' | shasum -a 256 | cut -c1-64)   # on Linux: sha256sum
python3 tools/machine-notebook/notebook.py init --dir ~/notebook
```

```console
tet-ed25519:eb08915b26807d3e7f7a9869260b8fb0baf4981fbb88d5bf259c2fc46e1b6e14
```

That line is the device's public key id. `init` made a **new** key just for this device. Its 12
words are in `~/notebook/device.key` (mode 0600) and are never printed. Never use your own wallet
phrase here. Anyone who copies `device.key` can sign as the device.

If you forget the two variables, `init` stops and says so:

```console
error: set TET_CHAIN_ID and TET_GENESIS_HASH (64 hex, 0x allowed) for the chain to sign for; a node's GET /chain shows both
```

Now keep the pin **outside** the folder. `device.pin` holds the device's two public key ids (one
for each half of its signature). The check needs a copy that the folder itself cannot change:

```sh
cp ~/notebook/device.pin ~/notebook.pin
```

This prints nothing.

## Step 3: record readings

The machine's 1-minute load average:

```sh
python3 tools/machine-notebook/notebook.py record --dir ~/notebook --source loadavg
```

```console
seq 1: 3.61 load-1m
```

A reading from your own sensor or script: pipe exactly `{"value", "unit"}` into `stdin-json`. The
value is a number, a string or true/false.

```sh
echo '{"value": 21.5, "unit": "celsius"}' | python3 tools/machine-notebook/notebook.py record --dir ~/notebook --source stdin-json
```

```console
seq 2: 21.5 celsius
```

Any other shape is refused, so nothing else rides along in the record:

```console
$ echo '{"temp": 21.5}' | python3 tools/machine-notebook/notebook.py record --dir ~/notebook --source stdin-json
error: stdin-json wants exactly {"value": <number|string|bool>, "unit": "<string>"}
```

On Linux, `--source cpu-temp` reads the CPU temperature. On a Mac it refuses:

```console
$ python3 tools/machine-notebook/notebook.py record --dir ~/notebook --source cpu-temp
error: cpu-temp reads /sys/class/thermal, which exists on Linux only
```

To keep recording for a while, `run` loops in the foreground and stops by itself at `--until`
(local time, default 22:00). It cannot run past midnight, and if `--until` has already passed it
does nothing. Stop it early with Ctrl-C.

```console
$ python3 tools/machine-notebook/notebook.py run --dir ~/notebook --source loadavg --every 20 --until 23:34
recording every 20.0s until 23:34 (local)
seq 4: 3.51 load-1m
seq 5: 3.64 load-1m
seq 6: 3.19 load-1m
stopped at 23:34
$ python3 tools/machine-notebook/notebook.py run --dir ~/notebook --source loadavg --every 60 --until 07:00
already past 07:00; nothing to do
```

(The `run` output above was taken after the permit steps below, which is why it starts at seq 4.)

## Step 4: a one-time permit

A permit is the device's own signed note that one action may be recorded once. `--expires-seq` is
the last record number that may cite it.

```sh
python3 tools/machine-notebook/notebook.py permit --dir ~/notebook --action open-valve --expires-seq 20
```

```console
5b63a530876366e9c5be23c1afbe3c2c
```

Cite it once. The record is written:

```sh
python3 tools/machine-notebook/notebook.py record --dir ~/notebook --source loadavg --permit 5b63a530876366e9c5be23c1afbe3c2c
```

```console
seq 3: 3.64 load-1m (permit 5b63a530876366e9c5be23c1afbe3c2c)
```

Cite it again. It is refused, and nothing is written:

```console
$ python3 tools/machine-notebook/notebook.py record --dir ~/notebook --source loadavg --permit 5b63a530876366e9c5be23c1afbe3c2c
error: not recorded: permit: 5b63a530876366e9c5be23c1afbe3c2c was already used by record 3
```

Use your own permit id, the one `permit` printed for you; copy it from the screen into both
`record` lines. A refused `record` exits with 2.

## Step 5: check the log, with the pin kept outside

```sh
python3 tools/machine-notebook/notebook.py verify --dir ~/notebook --pin ~/notebook.pin
```

```console
VALID
  3 records, all signed by tet-ed25519:eb08915b26807d3e7f7a9869260b8fb0baf4981fbb88d5bf259c2fc46e1b6e14
  permit 5b63a530876366e9c5be23c1afbe3c2c (open-valve): used once, by record 3; open until seq 20
Shows:
  - which key signed each record
  - that the records are in this order
  - that each record was written before the next one
  - that no one-time permission was used twice in this log, or after it ran out
Does not show:
  - that the reading is true
  - that the machine's clock was right
  - where the machine was
  - who runs the machine
  - that the key was not copied
  - that a copied key did not use the same permission in another log
  - that the signature format is final: it is in outside review, and logs from this test may need re-signing
stamp: not checked (no node)
```

The last line is about anchoring a record on a node. No public node runs today, so it stays "not
checked" (see the end of this guide).

The check refuses the pin that sits inside the folder, because whoever can edit the folder could
edit that file too:

```console
$ python3 tools/machine-notebook/notebook.py verify --dir ~/notebook --pin ~/notebook/device.pin
error: --pin ~/notebook/device.pin is inside the folder being checked; give a copy kept outside it
```

What a change looks like: copy the folder, then change the reading in record 1 of the copy. The run
below changed the value `3.61` to `9.99`. Your log has its own values: open
`~/nb-copy/records/1.json`, pick the number after `"value":`, and use it in place of `3.61`. Any
text editor works as well. (`sed -i ''` is the macOS form; on Linux it is `sed -i`.)

```console
$ cp -R ~/notebook ~/nb-copy
$ sed -i '' 's/3.61/9.99/' ~/nb-copy/records/1.json
$ python3 tools/machine-notebook/notebook.py verify --dir ~/nb-copy --pin ~/notebook.pin
INVALID
  record 1: signature: ~/nb-copy/records/1.json is not the 213 bytes this envelope signed
  record 1: chain.txt: hash differs from the record
  record 2: prev: does not name the record before it
```

(Only the top four lines are shown here; the Shows / Does not show lists follow.)

`verify` exits with 0 when it prints VALID and 1 when it prints INVALID. It exits with 2 when it
refuses to check at all, as with the pin inside the folder above.

## Step 6: thirty items, one record each

If you are labelling things you made, give each one a label and record it once. A new notebook keeps
this log apart from the readings above. The labels here are `tag-01` to `tag-30`; use your own.

```sh
cd ~/TET-OS
export TET_CHAIN_ID=maker-local
export TET_GENESIS_HASH=$(printf 'maker local' | shasum -a 256 | cut -c1-64)   # on Linux: sha256sum
python3 tools/machine-notebook/notebook.py init --dir ~/tags &&
cp ~/tags/device.pin ~/tags.pin &&
for n in $(seq -w 1 30); do
  echo "{\"value\": \"tag-$n\", \"unit\": \"tag\"}" | python3 tools/machine-notebook/notebook.py record --dir ~/tags --source stdin-json
done
```

The `cd` and the two `export` lines are Step 1's and Step 2's again, because a new shell has
forgotten them. The `&&` at the
ends of lines stops the block if `init` fails, instead of trying thirty records with no key. `init`
prints a new key id, as in Step 2. Then one line per item:

```console
seq 1: tag-01 tag
seq 2: tag-02 tag
seq 3: tag-03 tag
...
seq 30: tag-30 tag
```

This records a label you chose, signed by this notebook's key. It does not read a physical tag, and
it does not show that the label is on the object.

## Step 7: hand the log to someone who checks it

The person who checks the log needs four things from you, and must never get a fifth.

1. **The log without its key.** `device.key` can sign as the device. Leave it out:

   ```sh
   cd ~ && tar -czf tags-log.tgz --exclude device.key tags
   ```

   This prints nothing. The archive holds `chain.json`, `chain.txt`, `device.keyid`,
   `device.pin` and `records/` (and `permits/`, if you made any), and no `device.key`. To see
   for yourself, `tar -tzf ~/tags-log.tgz | grep -cx 'tags/device.key'` should print `0`: no
   line is exactly `tags/device.key`. (grep then exits with 1, which here means "not found", the good
   result. Without `-x` it would also count `tags/device.keyid`, which is public and meant to be
   there.)

2. **The pin, by another route.** Send `~/tags.pin` separately from the archive: a different
   message, a different channel, or read the first line out loud and let them compare it. If the
   log and the pin travel together, whoever can change one can change both, and the check would
   then read VALID for their key, not yours. The `device.pin` inside the archive does not help here,
   for the same reason, and `verify` refuses it.

3. **The key id.** The line `init` printed for `~/tags`, which is also the first line of
   `~/tags.pin`. It may travel with the pin, by the same route, as long as that route is not the
   archive's: put it in the same message as the pin, or read it out to them. They compare it with
   what `verify` prints.

4. **The same tools.** They need everything under "What you need" on their own machine, and Step 1
   run there in their own home folder: the same `cd ~`, `git clone` and `cargo build` lines, which
   give them `~/TET-OS`. They run `verify` from that folder.

On their machine, in an empty folder (here `~/friend`), with the archive and the pin you sent saved
as `~/tags-log.tgz` and `~/tags.pin` in their own home folder:

```sh
mkdir ~/friend && cd ~/friend && tar -xzf ~/tags-log.tgz
cd ~/TET-OS
python3 tools/machine-notebook/notebook.py verify --dir ~/friend/tags --pin ~/tags.pin
```

```console
VALID
  30 records, all signed by tet-ed25519:3d62b7357c558d229d43e86d79b29ce156c86ed091403ad4dbff78595a34d73b
```

(The Shows / Does not show lists follow.) They compare that key id with the one you sent. A match
shows the thirty records were signed by the key whose pin they hold, in this order. It does not
show which machine held the key.

Then they change one record in a copy and see the check refuse it:

```console
$ cp -R ~/friend/tags ~/friend/tags-copy
$ sed -i '' 's/tag-17/tag-71/' ~/friend/tags-copy/records/17.json
$ python3 tools/machine-notebook/notebook.py verify --dir ~/friend/tags-copy --pin ~/tags.pin
INVALID
  record 17: signature: ~/friend/tags-copy/records/17.json is not the 217 bytes this envelope signed
  record 17: chain.txt: hash differs from the record
  record 18: prev: does not name the record before it
```

(On Linux the `sed` line is `sed -i 's/tag-17/tag-71/' ...`, as in Step 5.)

It exits with 1. The check is once per log: it reads this folder only, and a second log signed with
the same key is a separate log it never sees.

## Read the two lists

Read "Shows" and "Does not show" before you rely on the log for anything.

- **Shows** is what the check holds against the device's own key: who signed, the order, and that
  no permit was used twice **in this log**.
- **Does not show** matters as much. The log cannot tell you the reading is true, or that the clock
  was right. If someone copies `device.key`, they can start a second log and use the same permit
  there; one-time means once per log, not once in the world.
- The last line is about the format itself: the signature format is in outside review, and logs
  you make now may need re-signing when that review is done. Treat this notebook as a test log, not
  a record you need to keep for years.

## Where people get stuck

Found by running this guide from an empty folder on 2026-11-17 (Mac only, with `tet-cli` already
built, so the build step itself was not part of that run), and again on 2026-11-19 (Mac only, with
the build, thirty records and a second person's check):

1. **The build.** It is the long step. Use the line in Step 1, with `RISC0_SKIP_BUILD=1`.
2. **Not in the repository root.** From another folder every command stops with
   `error: tet-cli not found at target/release/tet-cli (build it: RISC0_SKIP_BUILD=1 cargo build -p tet-cli --release, or pass --tet-cli)`.
   (That is the message as of 2026-11-18; the 2026-11-17 run printed an older one without the
   variable.) Go back to the root, or pass `--tet-cli`.
3. **The chain variables.** The README says to read them from a node's `/chain`. No public node runs
   today; a made-up local pair, as in Step 2, is what works.
4. **Forgetting `--pin`.** `verify` without it stops with
   `the following arguments are required: --pin`. And `--pin ~/notebook/device.pin` is refused; use
   the copy outside the folder.
5. **`run` in the evening.** With the default `--until 22:00`, a `run` started after 22:00 does
   nothing. Pass a later `--until`, before midnight.
6. **Handing over the whole folder.** A plain copy of the notebook folder includes `device.key`, and
   whoever holds it can sign as the device. Use the `tar --exclude device.key` line in Step 7.
7. **The pin in the same message as the log.** Then the check shows only that the log matches the pin
   that came with it. Send the pin by another route (Step 7).

Not covered here: `publish` and `verify --node`. They need a TET node, and no public one runs today.
