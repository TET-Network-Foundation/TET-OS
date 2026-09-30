# Flip day — making TET-OS public

**Read-only document. Nothing here has been executed.** Prepared 2026-09-29.

The order matters and is not arbitrary: each step either cannot be undone, or makes the next step
safe. Steps 3 and 4 in particular must happen **within minutes** of step 2, because between the flip
and the ruleset the repository is public and unprotected.

---

## 0. Blockers — none of this runs until these are true

| Blocker | Why it blocks | Status 2026-09-29 |
|---|---|---|
| **GitHub Actions billing** | Nothing has been CI-verified since `36147565171`. Flipping public with a red CI badge and no passing run is worse than waiting. Public repos get free minutes, so this may self-resolve at the Oct 1 reset — verify, don't assume | ❌ blocked, resets Oct 1 |
| ~~**The public seed is down**~~ | **Retracted 2026-09-29 — it was never down.** The laptop's network blocked 22/8002/ICMP; healthchecks.io showed the seed pinging every minute throughout. See ["I can't reach the seed" is not "the seed is down"](#i-cant-reach-the-seed-is-not-the-seed-is-down) below | ✅ seed healthy |
| **SSH reachable from wherever you are flipping** | The flip itself needs no SSH, but step 7's devlog and any incident response do. Outbound 22 is blocked on at least one network Steve uses | ⚠️ sshd on 443 pending (see `RUNNING_A_NODE.md`) |
| **Seed running the current binary** | The mempool-persistence fix (`2efe104`) is not deployed. Not release-blocking, but the redeploy should happen while nobody is watching, not during a launch | ⚠️ pending, needs the host back |

If the seed cannot be restored, **do not flip**. A single-seed network with the seed down is not a
testnet, and SECURITY.md already names the single seed as the top limitation. Publishing while it is
dead turns a documented weakness into a live demonstration of it.

## "I can't reach the seed" is not "the seed is down"

**Check healthchecks.io first.** The on-box probe (`deploy/seed-healthcheck.sh`) pings it every
minute **from inside the seed**, so it is the only one of these signals that reports on the seed
rather than on the path to it. If the last ping is recent, the seed is up and the problem is
between you and it.

This was got wrong on 2026-09-29: SSH, 8002 and ICMP all timed out from a laptop, and the
conclusion drawn was "the host is down". It was not. The school network blocked outbound 22, 8002
and ICMP while passing 443. The seed had been healthy throughout, pinging healthchecks.io every
minute the whole time.

"GitHub is reachable, therefore my connection is fine" does **not** follow. It shows 443 works to
one host. It says nothing about other ports, or about any particular destination.

**The discriminating test** — does the port work to a *third party*?

```bash
nc -z -G 6 github.com 22        # filtered here too => YOUR network blocks 22, not the seed
nc -z -G 6 95.217.158.153 443   # connects => the path to the seed is fine on this port
```

If `github.com:22` is also filtered, stop diagnosing the seed. Nothing about it is broken.

---

## 1. Confirm one green CI run

```bash
gh run list --workflow=ci.yml --limit 3
gh run view <id>          # all four jobs green: rust, ui, shell, wasm, docker
```

Required: a green run **on `main`, on the current HEAD**. Not a green run from last week, and not a
`ci-noop` run — the no-op mirror reports the same four check names by design, so read the workflow
file that produced it, not just the check names.

Also worth one look: the `zk-real` job has never run on GitHub. Trigger it once manually
(`gh workflow run zk-real.yml`) and let it finish. It takes up to ~3 hours cold; start it early.

## 2. Flip to public

Settings → General → Danger Zone → Change visibility → Public.

**Irreversible in one respect:** anything visible while public may be cloned, cached or indexed
within seconds. Flipping back (step 8) removes access, not copies.

Immediately after, confirm the history is still what we think it is:

```bash
git ls-remote https://github.com/TET-Network-Foundation/TET-OS.git
# expect exactly: HEAD and refs/heads/main. NOTHING else.
```

## 3. Secret scanning + push protection — do this first, before anything else

Settings → Code security and analysis:

- **Secret scanning**: Enable
- **Push protection**: Enable

Free only once public, which is why it cannot be done in advance. It is first because it is the
control that would have refused the original key commit outright, and because the window between
"public" and "protected" is the only window where a mistake is unrecoverable.

## 4. Ruleset on `main`

Settings → Rules → Rulesets → New branch ruleset. Target `main`. Enable:

- **Require a pull request before merging** (1 approval; self-approval is fine for a solo project —
  the value is the diff review, not the second pair of eyes)
- **Require status checks to pass**, selecting all five:
  - `rust (build, test, guards)`
  - `ui (next build)`
  - `shell (shellcheck deploy scripts)`
  - `wasm (tet-pqc-wasm → ui/public/pqc)`
  - `docker (images build)`
- **Block force pushes**

> **The path-filter interaction — read this before ticking "require status checks".**
>
> `ci.yml` skips itself on docs-only commits via `paths-ignore`, and a skipped workflow reports **no
> status at all**, not success. Required checks would therefore leave every docs-only PR permanently
> unmergeable.
>
> `ci-noop.yml` exists precisely for this: same workflow name, same five job names, triggered on
> exactly the paths `ci.yml` ignores. Whichever runs, the five names are reported.
>
> **So:** the two files must stay in lockstep. Change a job name or a path in one and docs-only PRs
> quietly become unmergeable again. Both files carry that warning in their headers. After enabling
> the ruleset, **test it**: open a docs-only PR and confirm it becomes mergeable.

Force-push protection matters here beyond hygiene: this repository was force-pushed three times in
September, and the last of those was recovering from key material in history.

## 5. Verify the refs are still clean

```bash
git ls-remote https://github.com/TET-Network-Foundation/TET-OS.git
```

Expect **only** `HEAD` and `refs/heads/main`. In particular there must be no `refs/pull/*`: those
survive force-pushes and branch deletion, they served the purged ML-DSA keys, and destroying the old
repository object is the only thing that removed them. If any appear later they belong to new PRs
and are harmless — it is the *old* ones that mattered.

Then, from a clean directory:

```bash
git clone https://github.com/TET-Network-Foundation/TET-OS.git /tmp/flip-check
cd /tmp/flip-check
git log --all --diff-filter=A --name-only --format="" | sort -u | grep -E "node_mldsa65|tet-recipient-wallet|FOUNDER_NOTES"   # expect nothing
git cat-file -e 644edf93411e83ab33b2daaf5f36186646c7ec5e && echo "LEAK" || echo "absent"
git log --all --format='%an <%ae>' | sort -u   # expect only the noreply identity and GitHub
rm -rf /tmp/flip-check
```

## 6. File the GitHub Support request

Ask them to garbage-collect unreachable objects on the repository. The recreate removed the PR refs,
so this is belt and braces — but GitHub keeps unreachable objects fetchable by direct SHA until its
own GC runs, and the pre-scrub history existed on the old object store.

## 7. Publish the devlog entry

`~/site/content.js`, then `git add -A && git commit -m "log: <title>" && git push`. Draft prepared in
[`FLIP_DAY_DEVLOG_DRAFT.md`](./FLIP_DAY_DEVLOG_DRAFT.md) — review it on the day; some numbers will
need refreshing, and it currently says the seed is healthy.

Publish this **before** Show HN, not after: the post is the honest version of the story, and it
should be findable by the first person who goes looking.

## 7b. Confirm both seeds are serving

```bash
for h in 95.217.158.153 46.224.223.54; do
  ssh -p 443 root@$h 'curl -s localhost:5010/metrics | grep ^tet_block_height'
done
```

Heights should match within a block or two. Helsinki produces; Nuremberg follows and serves.
If Nuremberg is behind by more than a few blocks it is catching up, not broken — check again
before worrying.

The README quickstart lists both, so a stranger joining does not depend on either one
individually. Block production still depends on Helsinki alone (spec risk R10).

## 8. Show HN

Only after 1–7. The title and first comment should say what the QA matrix says: what works, what is
red on purpose, and that it is unaudited with one seed.

Do not post on a Friday, and do not post and walk away — the first hour is when the questions come.

---

## Rollback

**Flipping back to private:** Settings → General → Danger Zone → Change visibility → Private.

Takes seconds and stops further access. It does **not** retract anything already cloned, cached or
indexed, and it does not undo a secret that was pushed while public. So:

- **For a bug, even a serious one:** do not flip back. Fix it in the open. Flipping back is louder
  than the bug and reads as panic.
- **For leaked credentials or personal data:** flip back immediately, then rotate. Rotation is the
  real fix; the flip only narrows the window.
- **For a takedown-worthy legal issue:** flip back, then take advice before anything else.

Losing the ruleset and secret scanning on flip-back is expected — both are public-repo features.
They must be re-enabled when going public again, and they are easy to forget.

## Who to tell

- **Manu** — first, and before Show HN. He was promised a note on how to join: `docker compose up`,
  the seed multiaddr, and the libp2p finding. He should hear about the repository going public from
  Steve rather than from HN.
- **Nobody else needs to know first.** There is no team, and saying so plainly is better than
  implying a launch committee exists.

## What NOT to do on flip day

- Do not redeploy the seed. Do it before, or days after.
- Do not merge anything that has not had a green CI run.
- Do not fix the two remaining LOW Dependabot alerts. They are dev-only and Groth16-transitive, they
  are documented, and touching dependencies on launch day is how the launch breaks.
- Do not rebuild `wallet_client_bundled.js`. The CI reproducibility guard will block it anyway, and
  the last rebuild attempt found a real ML-DSA level bug.
