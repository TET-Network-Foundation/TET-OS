# Project rules

## Regression guards must be verified non-vacuous

Every regression guard must be verified non-vacuous before commit: restore the bug (or invert the
key assertion), run the test, and confirm it **FAILS**. Record the negative-control result in the
commit body. A guard that passes with the bug present is decorative and must not be merged.

This is not hypothetical. Two guards in this repository passed with their bug fully present before
the control caught them — one drove a public entry point that rejected the test input on an
unrelated earlier check, so the assertion was true for the wrong reason; another guarded a wire
path that worked regardless of the fix it claimed to protect.

## Never delete or weaken a test

If a test will not compile or fails, fix it, or mark it `#[ignore = "<reason>"]`, and say so
explicitly in the PR body: the test's name, what broke, and which of the two you did. Never delete
it, and never loosen what it asserts to make it pass. Changing an assertion counts as weakening it
unless the old assertion was wrong, and then the commit body says why.

This is not hypothetical either. On 2026-10-04 an unattended session hit a compile error in a new
guard (`Keypair::generate_ecdsa` is not available with this crate's libp2p features), deleted the
test, and did not mention it in its summary. The deletion was found only by reading the run log.

## A signable `TxV1` variant is not an appliable one

Before routing any REST write through the mempool, confirm `apply_consensus_block_batch` has an
arm for that `TxV1` variant. A signable variant is not an appliable one.

Its catch-all returns `Err("unsupported tx in consensus block")` rather than ignoring the tx, so
enqueueing a variant it does not handle does not silently drop the write — it makes **every node
reject the whole block**. `TxV1::GenesisBridge` is exactly this case: present in the enum, signed
and verified by its handler, and absent from the apply match.

## A mock-only path counts as untested

**Any path with a mock variant must have at least one test on the real variant.** A path exercised
only through its mock is untested, however many tests point at it.

This is not theoretical. Two defects found on 2026-09-24 had both survived for months behind
`MOCKJ1:` / `MOCKZC1:` receipts, because every ZK test in the repo used them:

- `decode_journal_bytes` parsed journals with **bincode**, but `env::commit` writes **risc0
  word-aligned serde**. bincode does not fail on those bytes — it consumes the first 72 of 264 and
  returns a struct of garbage. `compute_reward_for_block` reads `flops_u64` out of that journal and
  folds it into the block reward, so a real receipt would have put a nonsense value into consensus.
  Mock journals are bincode by construction, so the mock path and the real path disagreed about the
  wire format and only the mock path ever ran.
- The production zk image shipped an **empty guest ELF** (`RISC0_SKIP_BUILD=0` defect). Nothing
  noticed, because nothing ever needed a real guest.

The tell in both cases was the same: a green suite over a code path that had never executed with
real inputs. When a mock exists, ask what it is standing in for and whether anything tests that.

## When a guard passes, ask what else could have made it pass

Caches, fallbacks, retries and default values are the usual culprits. **Disable the fallback inside
the guard** — clear the cache, remove the retry, unset the default — so the test can only pass
through the path it names.

Twice in one week a guard here was true for the wrong reason, and both times a *fallback* was
answering:

- The AT-4 burn guards passed with ciphertext removal disabled, because the fixture had already
  expired and `get_inbox` filtered it out on TTL.
- The registry flood guard passed with epoch gating removed, because the **memo cache** still held
  the honest root; recomputation would have disagreed. It now clears the cache before asserting,
  and asserts the cache is too small to hold every root.

The negative control is what caught both. A guard that cannot fail is worse than no guard, because
it is counted.

**A collision guard must use inputs that contain the separator; inputs that don't only measure the
separator (C5b).** A guard that two encodings cannot collide has to be fed the character the encoding
uses to divide fields, or it is testing the divider rather than the defence.

The agent payload encoding is length-prefixed, `<len> SP <field> SP`, so that no two field lists can
produce the same bytes. Its guard compared `("a","bc")` with `("ab","c")` — and passed with the length
prefixes **removed**, because the trailing space still landed in a different position. It was
measuring the space. A length-free encoding only collides when a field contains the separator, so the
cases now do: `("a","b c")` against `("a b","c")`, plus payloads that imitate the length prefix
itself. With those, the control fails as it must.

**For a hybrid check, the negative control must break exactly ONE half at a time; breaking the payload
breaks both and proves nothing about either (C4).** Every TET signature has an Ed25519 half and an
ML-DSA-44 half, and the obvious tampering — edit the payload, edit a signed field — invalidates both
at once. A verifier that silently stopped checking one half passes every such test.

The agent payload suite had exactly that hole. Deleting the ML-DSA verification entirely left it
green, because no case distinguished the halves. It now swaps in a **valid** signature from a
different payload, once per half, so precisely one is wrong and only a verifier that checks that half
can refuse it. With those cases the control fails as it must.

The same shape applies wherever two independent checks guard one thing: break them one at a time, or
you have measured their disjunction and learned nothing about either.

**Never give two workflows the same name or concurrency group; a mirror that reports the same check
names can mask the real run.** `${{ github.workflow }}` is the workflow's *name*, so two files sharing
a name share any concurrency group built from it — and with `cancel-in-progress` one silently kills
the other.

This repository had `ci.yml` (`paths-ignore`) and a no-op `ci-noop.yml` (the complementary `paths`),
both named `CI`, both declaring the same five job names, so that a required check would be reported
whichever ran. Complementary path sets are **not** mutually exclusive: one push can change files in
both, and then both fire. On 2026-10-01 a push touching `.github/**` and `docs/FLIP_DAY.md` did
exactly that. The mirror cancelled the real run — `started=never` on all five jobs — and then
reported all five names green. Required checks would have been satisfied by a workflow that did
nothing. Even without the cancellation the hole remains, because two check runs sharing a name resolve
to the most recent one.

The fix is one workflow that always runs, a `gate` job that decides whether the expensive work is
needed, and named jobs that **always start** so their check names are always reported — a job skipped
by a job-level `if:` reports "skipped", which is not a pass. And the concurrency group is a literal,
never `github.workflow`.

## In a must-be-refused assertion, never accept multiple reasons with `||`

**Assert the specific error the test is named for.** If a cheaper check rejects first, construct the
input so it passes every earlier check — otherwise the check under test is never reached and the
guard is measuring something else.

Two guards here were vacuous for exactly this reason, and both looked green:

- **M1** (`s8_registration_signed_by_another_wallet_is_refused`) mutated `wallet_id` *after*
  signing. `wallet_id` is inside the pre-image, so the **signature** rejected it and the
  `signer == wallet_id` check never ran. The real forgery is a *correctly signed* registration: A
  signs, with A's own key, a pre-image naming B.
- **O3** (`s8_anonymous_envelope_journal_must_match_the_receiver`) re-pointed `receiver_wallet_id`
  after signing, so again the signature fired first and the journal binding was never reached. Its
  assertion allowed either reason via `||`, which is what let it pass. It now **re-signs** after
  mutating, so the signature is genuinely valid and only the journal binding can refuse.

An `||` in a rejection assertion is a smell: it usually means the author was not sure which check
would fire, which is the thing the test exists to pin down.

## Bound every config- or input-driven loop, and make the bound observable

**Every loop or scan driven by configuration or input needs an explicit upper bound, and the
effective bound must be observable — logged or exposed — not silently truncated.**

`accepts_anon_root` walked `window_ms / epoch_ms` epochs and built a Merkle tree per miss. With a
1 ms epoch that is 3.6 million tree builds per verification: a self-inflicted denial of service
that a *smaller* configured value makes *worse*, which is the direction nobody checks. It is now
capped at 128 epochs, and `GET /tmail/anon/root` reports the effective window
(`min(window, 128 * epoch)`) so a configuration whose real window is shorter than its setting is
visible rather than a surprise during an incident.

Silent truncation is the specific failure to avoid: a bound nobody can see is a bound nobody can
debug.

## A committed build artifact must be reproducible from the repo in CI

**A stale artifact can hide a broken source.** If a build output is committed, CI must rebuild it
from the pinned manifest and fail when the result differs. Never commit an artifact nobody can
reproduce.

This is not hypothetical, and the failure was worse than staleness. `wallet_client_bundled.js` is
committed, embedded into the node binary with `include_str!`, and served to browsers. It could not
be reproduced: seventeen builds across every plausible version of five dependencies failed to match
it, because the artifact predated its own source and lockfile.

The dangerous part was what that concealed. The entry source signed with **ML-DSA-65** while the
node verifies **ML-DSA-44** — so an honest rebuild would have rejected every browser-signed request
on the network. Nobody had noticed because the stale bundle still signed 44. **The artifact was
correct by accident and was the only thing holding the system together**, and the "safe" act of
leaving it alone was what kept the bug alive.

Two guards, because they catch different things:

1. **Reproducibility** — CI rebuilds and compares hashes. Catches the artifact drifting from the
   source at all.
2. **Behaviour** — fixtures produced by the real artifact, verified by the code that consumes them
   in production. Catches the artifact being rebuildable *and wrong*.

The second one is what a hash check cannot give you: a matching hash proves only that the output is
the one the source produces, never that the source is right.

**When the artifact cannot be byte-reproducible, say so and guard the behaviour instead.** Not every
build output is deterministic across toolchains. `wasm-pack` is not: on 2026-09-30 a fresh build of
`tet-pqc-wasm` matched **neither** committed copy of the signer, while producing identical public
keys and identical signatures for all four interop vectors. A hash diff against a fresh build would
have gone red on the next compiler bump and said nothing about the crypto, and a guard people learn
to ignore is worse than no guard. So the hash comparison is pinned where it is meaningful — between
the copies, which must be identical to each other — and the rebuild is held to the *fixture the
consumer verifies*.

**Count the copies — and check which ones are actually committed.** The ML-DSA signer
(`tet-agent-sdk/vendor/`) was five months behind what its source builds, unreferenced by any guard,
and still being shipped. It happened to behave identically to a fresh build; that was luck.

The guard written for it then got the repository wrong, which is the more useful half of the story.
It compared "the two committed copies" — `tet-agent-sdk/vendor/` against
`tet-network/ui/public/pqc/` — and passed locally, because a developer's tree holds both. But
`ui/public/pqc/` carries its own `.gitignore` containing `*`: it is a build output and is **not**
committed. On the guard's first ever execution in CI (run 36846005558) it failed, comparing a
committed file against one that does not exist in a clean checkout.

Two lessons, and the second is the one that keeps costing: an artifact committed in two places is one
artifact with two chances to go stale, so either dedupe it or assert the copies match — and **a guard
that has never executed is a guess**. Run it where it will run, in a clean checkout, before believing
it. `git ls-files <path>` answers "is this committed?"; the presence of the file on your disk does
not.

## Design principle — check every new replicated field against it

> **Your keys, your data, your device — TET only proves, never stores.**

Secrets (passwords, personal data, biometric/neural data, private keys) live only on the user's
device. The chain holds only public keys and proofs. **Any design that would put a secret — or
anything derived from one that could re-identify it — on chain or in replicated state is rejected.**

**Review rule: before adding any new on-chain or replicated field, check it against this.** Ask what
an observer holding the whole replicated state can recover, not what the field is called. The
failure mode is never a field named `private_key`; it is a derivative that turns out to be
invertible or linkable.

Three decisions this week already turned on it, all of which looked fine until that question was
asked:

1. **Client-side audit trail (S8, spec §A.4.4).** The spec stored
   `tmail_anonymous_audit_v1:{anchor_wallet}` → `{ephemeral_id_hash, …}` in replicated ledger meta
   and claimed third parties could not link ephemeral → anchor. They could: take the ephemeral off
   the wire, hash it, scan the rows, read the anchor out of the key. **An unsalted hash of a public
   value is not a hiding commitment.** Now regenerated client-side from the anchor seed; nothing
   replicated.
2. **Ring signatures / stealth addresses removed (spec §A.1.2).** ECC-based, so quantum-vulnerable —
   the privacy layer would have been the one classical component in a post-quantum chain.
3. **Groth16 wrapping rejected (spec §A.4.3).** Pairing-based on BN254. Compressing a hash-based
   STARK into it would put anonymity on an assumption a quantum adversary breaks, while the rest of
   the chain still stands. Plus a trusted setup, which contradicts the premise twice.

Note what 2 and 3 have in common: the tempting option was the *convenient* one — smaller proofs, a
simpler envelope — and the principle is what made the cost visible. Expect it to argue against
convenience most of the time it applies.

## Devlog
The public site repo is at ~/site (github.com/Nexus-Network-Foundation/site).
At the end of every session where something shipped, was fixed, or was found:
1. Append ONE entry to the END of window.POSTS in ~/site/content.js:
   { date: "YYYY-MM-DD", project: "tet" | "unfog" | "kpee", title: "...", body: "..." }
2. If a project's "Where it is now" / "What's live" list, or window.NOW, is now wrong, fix it in the same file.
3. If there's a screenshot worth showing, save it to ~/site/images/<project>-<topic>.jpg
   (max 1100px wide) and put ![caption](images/<name>.jpg) in the body.
4. After writing an entry, run `cd ~/site && node tools/sign.mjs`. The build fails on unsigned entries.
   The agent key comes from the macOS Keychain; nothing to pass. If you changed an entry that was
   already signed, sign.mjs refuses and names it: re-sign that one with `--resign <id>`, and only if
   the edit is meant.
5. cd ~/site && git add -A && git commit -m "log: <title>" && git push
Writing rules for the entry:
- First person, plain, short sentences. Write what happened, with the real numbers.
- Say what didn't work too. If an earlier post was wrong, say so in the new one.
- No hype words, no "excited to announce", no emojis, no hashtags.
- Never write secrets: no keys, tokens, passwords, private IPs, personal addresses, school name.
- Don't claim anything the code doesn't do yet.
