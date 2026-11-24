Simulation, design sketch: not a format

# One record two parties both sign, kept in both notebooks

Local only, throwaway. No machine, organisation or deal took part; nothing is sent anywhere. Test keys
on a made-up chain. The design it sketches is under outside review and may change completely.

Two machine notebooks (`tools/machine-notebook/notebook.py`), each with its own key, agree on a thing
named by a SHA-256 and a short summary. Both sign the same bytes with `tet-cli agent sign` (Ed25519 and
ML-DSA-44). Each appends the record to its own notebook at the record number written into those bytes,
after the record those bytes name, or refuses. A third party with the bytes, both signatures, both pins
and the exports checks it with no key.

The pre-image is netstrings in a fixed order: the tag `tet-demo/two-party-record/v0.1`, each party's two
key ids, the record number it will write at and the hash of its record before that, the agreed hash, a
summary (NFC, single spaces, no control characters, at most 200 bytes; refused otherwise, never
normalised), and an optional one-time permit (which party holds it, its id). No time, place or name.

Changes in v0.1:

- the two parties must name two different ML-DSA-44 keys, as they already had to name two different
  Ed25519 keys; otherwise one party could reuse the other's ML-DSA-44 half as its own;
- the agreed hash is `agreed_of(document, random value)`: SHA-256 over netstrings of the tag
  `tet-demo/two-party-agreed/v0.1`, a fresh 32-byte random value and the document. The value stays beside
  the document, never in the record;
- a side signs only a record that names the counterparty it pinned and the agreed hash it computed;
- the check prints two verdict lines, `SIGNATURES:` and `LOGS:`. A log conflict is not a bad signature,
  and the line says the cause is not shown.

Changes in v0.2 (the record bytes are the same as in v0.1; only the signer's side changed):

- `sign()` reserves the record number it signs at, for that one record, in the notebook folder. Until the
  record is appended or `abort()` writes an abort entry there, `sign()` and `append()` refuse any other
  record at that number. On v0.1 an honest side that signed two deals at one number was shown as the side
  with a conflict; a test runs that case on v0.1's code and the refusal on v0.2's. The reservation binds
  this sketch's own calls, not the key: see "Does not show";
- `sign()` takes the summary and the permit (none, or which side holds it and its id) this side was given,
  and refuses a record that names another, so a counterparty cannot make it spend its own one-time permit;
- `append()` checks after writing that the entry landed at the number the record names. Another write in
  between is found and refused, not prevented.

## Run the tests

```sh
RISC0_SKIP_BUILD=1 cargo build -p tet-cli --release
TET_CLI=$PWD/target/release/tet-cli python3 -m unittest prep/demos/two-party-v0/test_twoparty.py
TET_CLI=$PWD/target/release/tet-cli python3 prep/demos/two-party-v0/controls.py
```

`test_twoparty.py`: 54 tests through the real notebook.py and tet-cli. Each refusal test asserts the
exact list of problems. `controls.py`: 37 controls; each removes one check in a scratch copy, and every
test it lists must then fail on its own.
`Reservation.test_on_v01_two_deals_at_one_position_frame_the_honest_side` runs the two-deals case on v0.1's
code, loaded from commit 1d3186a0. A clone of the public repository does not hold that commit, so there this one test is skipped and prints why, and 53 run.

## Sample records for an exchange

A set of sample records that someone else can check with one command, and the expected result for each.

```sh
RISC0_SKIP_BUILD=1 cargo build -p tet-cli --release
export TET_CLI=$PWD/target/release/tet-cli
python3 prep/demos/two-party-v0/samples.py make samples-out        # writes a new folder
python3 prep/demos/two-party-v0/samples.py check samples-out/honest-1
python3 prep/demos/two-party-v0/samples.py check-all samples-out
```

`make` writes nine folders: `honest-1`, `honest-2-permit` (it cites a one-time permit) and `honest-3`, and
six broken ones, each changed in one way: `broken-a-ed25519-half` and `broken-b-ml-dsa-half` (one side's
half of that kind replaced by the same key's valid half over another record, one kind at a time),
`broken-c-summary-changed` (after both signed), `broken-d-permit-used-twice` (a second record citing a
permit the side's export already shows used), `broken-e-number-skipped` (the record names a number past
the next one in that side's export) and `broken-f-one-key-both-parties`.

A folder holds the record's bytes (`record.bin`), both signatures (`sig-a.json`, `sig-b.json`), both
pins (`pin-1.txt`, `pin-2.txt`), the chain the signatures are bound to (`chain.json`), each side's
notebook export (`export-1/`, `export-2/`; `broken-c-summary-changed` has none, so that its result is
the signatures alone) and `WHAT.txt`: one line on what was done to it, then the exact lines `check` must
print before "Shows:". No folder holds a private key.

`check` prints what `twoparty.check()` finds, through `twoparty.report()`, wording unchanged, and exits
0 only when there is no problem. `check-all` prints one line per folder (name, expected, got, MATCH or
DIFFERS) and exits 1 on any DIFFERS.

The keys, hashes and permit ids are new in every run, and so is which side is `a` and which is `b`
(the side whose Ed25519 key id sorts lower is `a`). The folder names, the first line of each `WHAT.txt`
and the two verdict lines up to that letter are the same in every run; the lines after them carry the
letters, record numbers, permit ids and byte counts of that run.

**The time in a sample is not real.** The record itself (`record.bin`) carries no time. The notebook
entries in `export-1/` and `export-2/` do: every `records/<n>.json` has a `clock_utc` field, which a
real notebook fills from its device clock. In a sample set it is always `1970-01-01T00:00:00Z`, the
Unix epoch, for every entry in every run: `make` runs the real `notebook.py` through `sample_clock.py`,
which fixes its clock there, and writes the same value into the entries it writes by hand. No clock of
the machine that made the set is read for it. Every file and folder of the set also gets that time as
its modification time, so a copy of the set does not carry the time it was made either.

Samples (a) and (b) borrow one half from the same key's signature over another record, made with
tet-cli directly. Samples (d), (e) and (f) are made by a side acting outside this sketch's `sign()` and
`append()`, which would refuse them: (d) and (e) write their own notebook entry, (e) and (f) sign with
tet-cli directly. A side with its own key can always do that; the check is what finds it.

`check` also exits 0 when an export is missing and nothing else is wrong; the second line then says
which side gave no export.

What the samples do not show: the content is made up, the keys are throwaway test keys on a made-up
chain, and the layout of a folder is a sketch, not a format.

`test_samples.py` makes one set and asserts each folder's exact problem list. `controls_samples.py`
makes each broken sample honest again, one at a time, and the test for it must then fail; it also makes
`check` print a wrong verdict and puts a device key into a sample, and the tests for those must fail.
Three more switch off a check inside `twoparty.py` (tet-cli's refusal, the export check, the two-keys
rule) and the tests of the samples that rest on it must fail. Four put the machine's clock back, one
way at a time (`notebook.py` run directly, `sample_clock.py` leaving the clock alone, the hand-written
entries reading the clock, the file times left as written), and the tests that the set carries only the
sample time and nothing of the machine that made it (no user name, home path, host name, temporary
folder, date after 1970, or number near the time it was made) must fail.

## Shows

- that both pinned keys signed exactly this record, each with both halves
- which two keys the record names, that they are the two pins given, and that the parties name two different keys of each kind
- with a party's export: that this export holds the record at the named number, after the named record
- with a cited permit and that party's export: that this export cites the permit once, from that record

## Does not show

- that what was agreed is true, or what the agreed document says (only its hash is here)
- that either side still holds the agreed document and its random value, or that anyone received them; without the value nobody can open the agreed hash in a dispute
- that the random value was fresh: nothing enforces it, and one document and value used for two deals link their records
- when anything happened: the record shows order inside each log, never a date
- who signed before the other, that either side received the other's signature, or that both logged it at about the same time
- which person or organisation holds a key, that a key was not copied, or that a person and not software decided to sign
- with one signature: only that one key signed; it is not a deal, and it does not show that the other side saw it
- without a party's export: that it kept its copy
- that a party keeps only one log: its key holder can copy the folder and write another record at the same number
- who caused two records at one number: there is no fair exchange, so a side that held back its signature can complete an old record later
- that a key signed only one record per number: the reservation binds this sketch's sign() and append(), not the key; a signature made with another tool, an ordinary notebook entry or a copied folder can still take the number
- that a log was not cut back or rewritten after the last position a counterparty holds; before it, only if the counterparty brings its record
- that anyone but the device allowed anything: the permit is signed by the same key that cites it, and its terms are not in the record
- that a permit was not used in another notebook: once is once per notebook
- privacy of the rest of the log: an export holds the whole log, and the same two key ids link every record of one pair
- that the summary looks like what it says: control and format characters are refused, but look-alike letters and other invisible fillers pass
- that the summary holds no name: the tool cannot tell
- anything against a quantum forger for a checker whose pins came over a channel such a forger can fake
- that the format is final: this is a design sketch in review

The per-half signature check is tet-cli's. The tests break each half alone, with a valid half by the
same key over another record; the control for them can only remove the call to tet-cli.
