# Permit issuer: a permit signed by an owner, cited by the device

**Status: idea.** Nothing here is built. It answers a gap in today's one-time permits
(`docs/research/SIGN_IN_AND_PERMITS.md` on branch `docs/design-memo-manu`): a permit is signed by
**the same device key that later cites it**. `notebook.py permit` signs with `device.key`, and
`permit_problem` (`tools/machine-notebook/notebook.py`) refuses any permit not signed by "this
device's key". The agent example (`tet-agent-sdk/examples/agent_permit_once.mjs`) speaks of "the
owner's side" issuing the permit, but no owner key exists. So a permit today **limits** a key against
its own log. It cannot **grant** the key anything: whoever holds the device key can write any permit
it likes.

## The idea

Two keys, two signatures, two checks:

- **The owner key** signs the permit. It is a separate key from 12 words, kept off the device (on
  the owner's own machine). It is used only to issue permits.
- **The permit names the device**: `{"kind":"tet_machine_permit_v2", "permit_id", "action",
  "expires_seq", "device": "tet-ed25519:<device key>"}`, canonical JSON. It is signed with `tet-cli
  agent sign` by the owner key, payload type `application/vnd.tet.machine-permit+json`. No new
  cryptography.
- **The device cites it** in a record, signed with the device key, exactly as today
  (`record --permit <id>`).
- **`verify` checks both:**
  1. the permit is signed by **the owner key**, which `verify` is given out of band
     (`--owner <keyid>`) and does not read from the notebook folder. A file the device can write is
     no anchor, because the device could replace it;
  2. the permit's `device` is this log's device key;
  3. the record citing it is signed by **the device key**, as every record already is;
  4. the existing checks: cited at most once, not past `expires_seq`, the exact bytes, the id is the
     file's name.

`permit` on the device then only imports a permit file the owner made. It no longer signs anything.

## What it would show, and what it would not

**Shows:** the owner key allowed this device key to do this action once, up to record
`expires_seq`; the device claimed it once, in this record.
**Does not show:** that the owner key belongs to a particular person; that a copied device key didn't
cite the same permit in a second log (still once per log, not once in the world); that the action
happened.

## Guards it would need (CLAUDE.md: two checks, break one at a time)

Each case validly signed by the key that signs it, each asserting its own reason:
- a permit signed by the **device** key (today's v1 shape): refused, "not signed by the owner key".
  This is the case that fails if check 1 is dropped;
- a permit by the owner naming **another device**: refused, "issued for another device" (check 2);
- a record citing a genuine owner permit, signed by **a key other than the device's**: refused by the
  existing record-signer check (check 3);
- `verify` without `--owner`: refused outright, never "VALID with no owner check".

Negative control for each: drop that one check and the case must turn VALID.

## Open questions

1. Does `verify` take the owner key as a flag, or from a signed owner record kept elsewhere? The flag
   is simplest. It means every reader must know the owner key.
2. Should v1 permits (self-signed) remain readable as "limit only", or be refused once v2 exists?
3. Revocation: the owner can't take back a permit before `expires_seq`. Is a short `expires_seq`
   enough?
4. Batching: the owner must be online to issue each permit. Should one owner signature cover a
   numbered batch of permits?
