# tet-tag-verify

Offline pieces of the genuine-tag plan ([docs/plans/GENUINE_TAG.md](../docs/plans/GENUINE_TAG.md)).
No node. Everything except `serve` works on text and bytes with no network; `serve` listens on
localhost by default.

## What it verifies

- **One tap of an NXP NTAG 424 DNA tag**: the SUN URL the tag writes, checked against a 16-byte
  AES key, per NXP AN12196. Plain mirroring (UID, counter, SDMMAC) and encrypted PICCData (tag
  byte 0xC7) are read. The result: whether the signature is valid for that key, the UID, the
  counter, and the tag ID (SHA-256 of `"tet tag v1"` and the UID).
- **One tag's key from a master key**, per NXP AN10922 (AES-128): the diversified key for
  UID ‖ AID ‖ system identifier. The worked example in AN10922 section 2.2.1 checks. An input of 15 bytes or less (so
  0x01 ‖ input fits one block) is read as still running two blocks; no published vector covers
  that case yet.
- **The two tag documents**, `tet_tag_registration` and `tet_tag_claim` (`v: 1`): their
  canonical JSON (keys sorted, no whitespace, nulls written) and its SHA-256. A change to that
  form means a new version, not a new hash.

Not done yet: LRP mode, needed before any real registration. Diversification is implemented;
its vector is AN10922's own example, and the short-input case is still unverified (see
`tests/diversify_vectors.rs`). The SUN test vectors come from sdm-backend's tests, which cite
AN12196; the first physical tag is the real check.

## What a valid tap shows

- The chip that made this URL knew this key when it was tapped, at that counter.

## What it does not show

- It does not by itself show the item is genuine. A tag can be removed and moved; this is about the chip, not the object it is on.
- It does not show who holds the item. Ownership is a separate record on TET.
- A copied link checks the same as the tap that made it. Only a counter that went up since the last tap seen tells a fresh tap from a copy.
- This check ran on this computer with the key you gave. TET's chain did not check it.

## Commands

```
tet-tag-verify verify --key <32 hex> --url <sun-url> [--json] [--last-counter N]
                      [--mac-key <32 hex>] [--mac-input-from <param>]
tet-tag-verify doc registration --uid <hex> --chip ntag424dna|ntag424dna_tt --product <label>
                      [--ref <text>] [--image-sha256 <hex>]... --verifier-url <https://…> --counter N
tet-tag-verify doc claim --uid <hex> --registration-sha256 <hex> --new-owner <id> --counter N
                      --attestation-sha256 <hex> [--previous-claim-sha256 <hex>]
                      [--release-sha256 <hex>] [--tamper closed|open]
tet-tag-verify doc hash <file.json>
tet-tag-verify derive --master <32 hex> --uid <14 hex> --aid <6 hex> --sid <hex, up to 21 bytes>
```

`verify` exits 0 when the signature is valid, 1 when it isn't, 2 on bad input. `doc registration`
and `doc claim` print the canonical JSON, then its SHA-256. `doc hash` prints the SHA-256 of a
document file's canonical form, and exits 1 if the file isn't a valid document. `derive` prints
the tag's diversified key as 32 hex characters (exit 2 on bad input); the master key never
leaves the computer it is typed on.

## serve (prototype)

```
tet-tag-verify serve --keys <file> --state <file> [--listen 127.0.0.1:8787]
```

It answers `GET /tap?<the tag's SUN parameters>` with the `verify` report. The parameters are the
ones `verify` reads: `picc_data` (or `e`) and `cmac` (or `c`) for encrypted PICCData, or `uid`,
`ctr` and `cmac` for plain mirroring. The answer is an HTML page, or, with
`Accept: application/json`, the `verify --json` fields plus `result`, `reason` and `replayed`.
That full answer is only for an accepted tap. A refused tap gets `result`, `reason` and
`replayed` and nothing else: no UID, no counter, no tag ID (the HTML page shows only the result
and the "does not show" list).

- **Keys file**: JSON, all hex, mode 0600 (it refuses to start otherwise). Either one key per tag,
  `{"<uid>": "<key>", …}`, used for both the PICCData and the MAC; or `{"master": …, "aid": …,
  "sid": …}`, with each tag's key derived per AN10922. With a master key, encrypted PICCData also
  needs `"meta"`, the PICCData key. That key is per batch while the MAC key is per tag, because the
  UID is inside the PICCData and must be read before a per-tag key can be chosen. Keys are never
  logged, echoed or quoted in an error.
- **State file**: the last accepted counter per UID. It is rewritten after each accepted tap
  (temporary file, then rename), and a tap is not accepted unless that write succeeded.
- **Accepted** only when the signature matches and the counter is above the stored one. Otherwise
  the result is `INVALID`, with one of two reasons. `replayed`: the signature matches but the
  counter is not above the stored one. `not valid for any key here`: everything else, whether the
  signature is wrong or there is no key for the tag; the answer doesn't say which, and both cases
  do the same checking work, so they take about the same time.
- **Log**: one line per request, `tag_id=… counter=… result=…`. Nothing else. The tag ID and
  counter are written only when the signature matched (accepted or replayed), `-` otherwise.

What it shows: what a valid tap shows (above), and that this verifier had not accepted that
counter, or a higher one, for this tag before.

What it does not show: everything in the list above still applies. In particular, a copied link
that reaches this verifier before the real tap is accepted, and the real tap is then refused as
replayed. The counter only orders taps; it can't say which one came from the person holding the item.

Limits of the prototype:

- No rate limiting yet (planned).
- Localhost only by default, plain HTTP, no TLS. Putting it on a public address is not part of this
  prototype.
- Only the usual empty MAC input (no `--mac-input-from`). An encrypted tap is tried against each
  per-tag key, at most 100000 keys; the count loaded is printed when it starts.
- Answers are kept in one process with one state file; two copies running on the same state file
  would not see each other's taps.

To see the output without a tag: `tet-tag-verify/examples/an12196_demo.sh` (from the repo root; it checks the AN12196 page 12 example with the all-zero key, no download).

Planned, not wired: the registration hash is meant to be anchored through the existing hash-only stamp (#148).
