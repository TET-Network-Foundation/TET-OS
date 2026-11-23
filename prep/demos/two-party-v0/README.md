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
One test loads v0.1's `twoparty.py` from git (commit 1d3186a0) to run the two-deals case on the old code;
it needs this repository's history.

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
