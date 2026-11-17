# Key operations: backup, a second device, rotation, revocation

**Status: idea.** Nothing here is built, planned for a phase or reviewed. It has two parts: what the
tools on `main` do today when someone loses a device, loses their 12 words, adds a second device or
thinks their key leaked (each with real output), and the smallest design for each that reuses shapes
already in the repository. No new cryptography is proposed. Everything in the second part waits for
the outside cryptography review, and the last section lists five questions for it.

## Part 1: what the tools do today

The commands below were run on 2026-11-17 against `main` at `6e628a4`. `tet-cli` was a release
build from another checkout, built from a commit whose `tet-cli/` sources are identical to `6e628a4`.
Its `tet-core` differs only by one added test, and its `Cargo.lock` differs in the versions of some
dependencies. Any uncommitted changes at build time cannot be checked, so a fresh build from `main`
is what counts. The key was a throwaway made for this note. The 12 words
never reached the screen: below, they are replaced by a marker, and long keys are cut short. The
chain was an example id that no node runs (`TET_CHAIN_ID=tet-example-key-ops`).

### One phrase is the whole identity

`tet-cli keys generate` prints a phrase and two public keys. It writes nothing to disk. Run with
an empty `HOME`, nothing appeared under it afterwards:

```
$ tet-cli keys generate --words 12
==================== TET WALLET GENERATED ====================
Public Address (ed25519 vk, hex):
35f45f76441dfec72c0c046cdf64e6fb945589f4a93b5fc4f1dfdbc858cd7423

ML-DSA Public Key (base64):
3cLiesYaRyvgYolhK8uKxM9CrjGsCkjPGVivsvkH...(1752 chars)

Mnemonic (DO NOT SHARE):
NEVER SHARE THIS MNEMONIC. ANYONE WITH IT CAN STEAL YOUR FUNDS.
<the 12 words: left out of this note>
==============================================================
```

Both signing keys come from that one phrase. The Ed25519 key comes straight from the BIP39 seed,
and the ML-DSA-44 key is derived from the same seed under its own label (`tet-core/src/wallet.rs`).
The browser's messaging keys (X25519 and Kyber-768) come from the same phrase under labels of their
own (`tet-network/ui/app/lib/tmail_keys.ts`). `tet-cli` has no `import`, `export`, `restore`,
`rotate` or `revoke` command. `keys` has only `generate`, plus a `dummy` placeholder. Every command
that signs takes the phrase again.

### "I want a second device"

Today a second device is the same phrase typed in again. I signed a file in a fresh directory with
a separate `HOME` and the phrase passed in through `TET_MNEMONIC`:

```
$ TET_MNEMONIC=… tet-cli agent sign --in note.txt --payload-type text/plain
signed 20 bytes as text/plain
chain      : tet-example-key-ops
keyid      : tet-ed25519:35f45f76441dfec72c0c046cdf64e6fb945589f4a93b5fc4f1dfdbc858cd...
keyid      : tet-mldsa44:166771b3e5203c2eeb752f9d259aefb589689e649a89bba4c53efa105261...
envelope   : note.txt.sig.json

$ tet-cli agent verify --sig note.txt.sig.json --payload note.txt
chain      : tet-example-key-ops
payloadType: text/plain
signer     : 35f45f76441dfec72c0c046cdf64e6fb945589f4a93b5fc4f1dfdbc858cd...
payload    : note.txt matches (20 bytes)
OK         : ed25519 + ML-DSA-44 both verify
```

The signer is the same key that `generate` printed. So this works, but every device then holds the
whole identity: the same signing keys and the same messaging keys. Nothing marks which device signed
something, and you can't take one device back without changing everything.

In the browser, the words are restored on the restore screen. On `/try`, the browser keeps them only
if you ask it to, encrypted with your passphrase (AES-256-GCM, PBKDF2-SHA-256 at 600,000
iterations). "Forget this device" removes them (`tet-network/ui/app/lib/device_store.ts`).

### "I lost the device"

- **CLI:** nothing was stored on it, so nothing is lost. Type the phrase on the next machine.
- **Browser:** restore the words on a new device; the old device keeps its encrypted copy until it
  is wiped, so if you think it is in someone else's hands, treat it as a leak (below).
- **A machine's own key** (the machine notebook, `tools/machine-notebook/`): `init` writes the
  device's own 12 words to `device.key`, mode 0600, and prints only the key id. If the machine is
  lost, that key is gone with it. A second `init` refuses to replace a key:

```
$ notebook.py init --dir nb
tet-ed25519:09be1fa252823836...
$ ls -l nb            # run with umask 077; only device.key is forced to 0600 by the tool
-rw-------  120  chain.json
-rw-------   69  device.key
-rw-------   77  device.keyid
drwx------   64  records
$ notebook.py init --dir nb
error: …/nb/device.key exists; refusing to replace a device key
```

A new machine key starts a new log. Nothing links it to the old one (see
`docs/research/AGENT_STANDARDS_MAP.md`, "Key rotation").

### "I lost the 12 words"

Nobody can recover them, TET included (`docs/THREAT_MODEL.md`, "Recovery"). While a device still
holds the encrypted copy and you know its passphrase, you can still sign there. Move what matters to a
new phrase while you can.

The checksum catches some mistakes in a backup. With two words swapped, or with one word missing,
signing refused:

```
$ TET_MNEMONIC=<first two words swapped> tet-cli agent sign --in note.txt …
Error: signing failed: signing failed: InvalidMnemonic
$ TET_MNEMONIC=<11 of the 12 words> tet-cli agent sign --in note.txt …
Error: signing failed: signing failed: InvalidMnemonic
```

It does not catch all of them. A 12-word phrase carries a 4-bit checksum, so about one wrong word in
16 still gives a valid phrase. That phrase is a different key, and nothing says so. This is the
reason for the backup check in Part 2.

### "I think my key leaked"

There is nothing to run. No command rotates or revokes a key, on chain or off:

- **Funds:** `tx send` can move them to a new phrase. A thief holding the same phrase can do the
  same, so whoever is quicker wins.
- **Agent manifests:** `AgentManifestV1` expires, and expiry is its only revocation
  (`docs/AGENT_IDENTITY.md`). A manifest signed with the leaked key stays valid until
  `expires_at_ms`.
- **Signatures:** a signature made with the leaked key verifies exactly like one made by its owner,
  as the `verify` output above shows. Nothing in an envelope can tell them apart.
- **Messages:** the messaging keys come from the same phrase. Whoever holds it can open what was
  sent to that wallet.

## Part 2: the smallest design for each

Each piece reuses a shape already in the repository: a canonical-JSON record with its own `kind` and
payload type, signed with `tet-cli agent sign` and checked with `tet-cli agent verify` on both halves
(Ed25519 and ML-DSA-44). Every record is a file. None goes on chain or into replicated state, so
nothing here needs a `TxV1` variant.

### Backup: check it before you need it

- Write the words on paper. This is the same as today.
- **New: a backup check.** Type the written words back in, on the same device or another one, and
  compare the key id they give with the one shown at creation. Write the first 8 hex characters of
  that key id next to the words. A wrong word that passes the checksum then shows up as a different
  key id. Only public keys are compared, so this needs no new cryptography.
- No cloud copy and no recovery service. Either one would put a secret, or something that can unlock
  one, off the device.

### Adding a device: a key per device, vouched for by the owner

Two choices:

1. **The same words on every device**, as today. This is simplest. It costs the ability to revoke
   one device, and a leak from any device is a leak from all of them.
2. **Each device makes its own key** (as `notebook.py init` already does for machines), and the owner
   key signs a statement naming it. Its shape follows the owner-signed permit in
   `docs/research/PERMIT_ISSUER.md` and the machine ID (`tet_agent_id_v0`) in the agent identity
   draft on branch `agent-id/v0`, which pins both of the machine's key ids:
   `{"kind":"tet_device_v0", "device":"tet-ed25519:…", "device_mldsa44":"tet-mldsa44:…", "label":"…",
   "n", "prev"}`, signed by the owner key. It pins both key ids, because a TET wallet id names only
   the Ed25519 half. The device then signs with its own key, and a checker given the owner key out of
   band accepts it.

Choice 2 is the one that makes revoking a single device possible. Deriving device keys from the
owner's words (a label and a counter) would save backing up each device. That derivation was
proposed once and reverted from `main` to wait for the review, so it is not part of this design.

### Revoking: an owner record, final

Reuse the owner record idea from the agent identity draft (branch `agent-id/v0`, design only, held
off `main` until the cryptography review): a record signed by the owner key, chained by `n` and
`prev` (the SHA-256 of the previous record), saying `op: revoke`, the device, and
`after_seq`. (The draft names the device by one key id. Naming both, as everywhere else here, is this
note's addition.) Signatures by that device after position `after_seq` in its own chained log are refused
by any checker that holds the record. This is an idea only here.

- **Final.** A later record cannot undo a revoke. So if the owner key leaks, the thief can't
  un-revoke a device the owner has revoked.
- **No clock.** The cut-off is a position in the device's log, not a time.
- **The limit:** a checker that has never been shown the record does not know about it, and offline
  checking cannot prove that no newer record exists. Where records are published is open (question
  4).

### Rotating: "same maker, new key"

When the owner moves to a new key, the old key signs a statement naming the new one. The new key
signs the same statement too:

`{"kind":"tet_key_successor_v0", "old":"tet-ed25519:…", "old_mldsa44":"tet-mldsa44:…",
"new":"tet-ed25519:…", "new_mldsa44":"tet-mldsa44:…", "n", "prev"}`

It has its own payload type, and both keys sign the same bytes.

**What it shows:** whoever held the old key when this was signed named this new key, and whoever
holds the new key agreed. The second signature stops anyone from naming someone else's key as their
successor.

**What it does not show:**
- that the person holding the old key was its original maker;
- when it was signed (there is no trusted time, only order within the chain);
- that no other successor exists. A checker that is shown one statement cannot know whether the
  same old key signed another.

**If the old key is the one that leaked,** the thief can sign a successor naming a key of their
own, and so can the owner. The checker then sees two successors from one key. The rule proposed
here: **two successors from one old key → the key is disputed.** Neither successor is accepted, and
the question goes back to something outside the keys (people who know the maker). A successor
statement cannot fix a leak by itself, because after a leak the old key no longer speaks only for
its maker.

One way to make the honest side win is to name the next key in advance. Each key's statement would
carry a hash of the next key before it is needed (as some other key systems do). Then a thief who
steals the current key cannot name a successor that matches the hash. This uses only hashing. It is
still a protocol of its own and needs the review (question 3).

**Privacy check** (CLAUDE.md, design principle). A successor statement links the old key to the new
one in public, permanently. That is its purpose, so it is not a secret. But someone who wants a clean
break should make a new key and publish nothing. The statement belongs only where the link is wanted.

## What waits for the outside cryptography review

- any key derived from the owner's words for a device or agent (the derivation reverted from `main`);
- the successor statement, the "disputed" rule, and naming the next key in advance;
- the owner record (revoke), which already sits behind that review on `agent-id/v0`;
- anything that would put any of this on chain. That would also need a `TxV1` variant with an arm in
  `apply_consensus_block_batch`, and none is proposed.

What does not wait: the backup check (it compares public key ids), and wording on the existing
screens that says plainly what Part 1 says.

## Five questions for the reviewer

1. **One seed, both halves.** The Ed25519 key is the first 32 bytes of the BIP39 seed, used
   directly. The same 64-byte seed is also the input to HKDF-SHA256 for the ML-DSA-44 seed and for
   the messaging keys, each under its own label. Is using the seed's bytes directly for one key and
   as HKDF input for the others sound, or should every key come from HKDF? Does a
   successor statement need to name both halves of each key, as proposed, or is one half enough?
2. **Cross-signing.** Is "old and new key sign the same canonical bytes, each under its own payload
   type" enough to stop a successor from naming a key whose holder did not agree, and to stop one
   record kind being passed off as another?
3. **After a leak.** Is "two successors from one key → disputed" the right rule? Is naming the next
   key in advance worth its cost here? What should a hash commitment cover (both halves, and the
   counter)?
4. **Withheld records.** Offline checking can't prove that no newer revoke or successor exists.
   What is the least a checker should require, such as a maximum age for the newest record it has
   seen, before it accepts a device key?
5. **Device keys from the owner's words.** Should device and agent keys be derived from the owner's
   words (label and counter), or kept independent? Derived keys mean one backup. Independent keys
   mean a leak of one device's key says nothing about the others.
