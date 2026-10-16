# tet-tag-verify

Offline pieces of the genuine-tag plan ([docs/plans/GENUINE_TAG.md](../docs/plans/GENUINE_TAG.md)).
No network, no node: it works on text and bytes.

## What it verifies

- **One tap of an NXP NTAG 424 DNA tag**: the SUN URL the tag writes, checked against a 16-byte
  AES key, per NXP AN12196. Plain mirroring (UID, counter, SDMMAC) and encrypted PICCData (tag
  byte 0xC7) are read. The result: whether the signature is valid for that key, the UID, the
  counter, and the tag ID (SHA-256 of `"tet tag v1"` and the UID).
- **The two tag documents**, `tet_tag_registration` and `tet_tag_claim` (`v: 1`): their
  canonical JSON (keys sorted, no whitespace, nulls written) and its SHA-256. A change to that
  form means a new version, not a new hash.

Not done yet: LRP mode and per-tag key diversification (AN10922). Both are needed before any real
registration. The test vectors come from sdm-backend's tests, which cite AN12196; the first
physical tag is the real check.

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
```

`verify` exits 0 when the signature is valid, 1 when it isn't, 2 on bad input. `doc registration`
and `doc claim` print the canonical JSON, then its SHA-256. `doc hash` prints the SHA-256 of a
document file's canonical form, and exits 1 if the file isn't a valid document.

To see the output without a tag: `tet-tag-verify/examples/an12196_demo.sh` (from the repo root; it checks the AN12196 page 12 example with the all-zero key, no download).

Planned, not wired: the registration hash is meant to be anchored through the existing hash-only stamp (#148).
