# Prepared PR: rust-libp2p — gossipsub debug log for additional connections

**Opened as [libp2p/rust-libp2p#6635](https://github.com/libp2p/rust-libp2p/pull/6635).**

- **Fork:** `Nexus-Network-Foundation/rust-libp2p` (local clone at `../rust-libp2p`)
- **Branch:** `gossipsub/log-secondary-connection`, off `master`
- **Commit:** `92a92b97e`
- **Diff:** 2 files, +9 −0 (`protocols/gossipsub/src/behaviour.rs`, `protocols/gossipsub/CHANGELOG.md`)

---

## Suggested PR title

Conventional commit, since the repo squash-merges and the title becomes the commit message:

```
feat(gossipsub): log when an additional connection is not sent subscriptions
```

## Suggested PR description

> ### Description
>
> `Behaviour::on_connection_established` sends our topic subscriptions only on the first
> connection to a peer; any further connection returns early at `other_established > 0`. That is
> correct, but it happens silently — nothing in the logs or the event stream indicates that a
> particular connection will never receive the remote's topic set.
>
> This matters for a process that runs more than one `Swarm` on the same identity keypair. Those
> swarms present the same `PeerId`, so if two of them connect to the same remote listener, the
> remote's gossipsub advertises to whichever arrives first and says nothing to the second — while
> locally that second connection belongs to a *different* `Behaviour` instance, which is left with
> no record of the remote's subscriptions. `publish` on that instance then fails with
> `NoPeersSubscribedToTopic`, which is indistinguishable from the ordinary "mesh has not grafted
> yet" condition that follows any connection, and stays that way for the life of the process.
>
> Running several swarms on one keypair is arguably a misuse; the point of the log is that the
> misuse becomes visible where it happens, instead of surfacing far away as
> `NoPeersSubscribedToTopic`.
>
> One debug line naming the peer and the established-connection count makes this visible at the
> moment it happens.
>
> Behaviour is unchanged: this only adds a `tracing::debug!` before the existing early return.
>
> ### Change checklist
>
> - [x] I have performed a self-review of my own code
> - [x] I have made corresponding changes to the documentation — n/a, no API or behaviour change
> - [x] I have added tests that prove my fix is effective or that my feature works — n/a, log-only
> - [x] A changelog entry has been made in the appropriate crates

## The diff

```rust
         if other_established > 0 {
+            tracing::debug!(
+                peer=%peer_id,
+                %other_established,
+                "Not sending subscriptions: this is an additional connection to a known peer"
+            );
             return; // Not our first connection to this peer, hence nothing to do.
         }
```

Field style (`peer=%peer_id`, then the message) matches the neighbouring
`tracing::debug!(peer=%peer_id, "Ignoring connection from blacklisted peer")` and the multi-field
form used elsewhere in the file.

## Changelog

Added as the first bullet under the existing `## 0.51.0` heading in
`protocols/gossipsub/CHANGELOG.md`, matching the neighbouring entries' shape (statement, then
`See [PR ...]` on its own line).

**No version bump.** `docs/release.md` requires a new heading and a `Cargo.toml` + workspace
`[workspace.dependencies]` bump only when the top-listed version is already released. `0.51.0` is
the top heading and crates.io's latest published version is `0.50.0`, so `0.51.0` is still
unreleased and the entry belongs under it. Verified against the crates.io versions API rather than
assumed.

## Verification

| | |
|---|---|
| `cargo fmt -p libp2p-gossipsub -- --check` | clean |
| `cargo clippy -p libp2p-gossipsub --all-targets` | no new warnings (one pre-existing in `libp2p-identity`, untouched) |
| `cargo test -p libp2p-gossipsub` | 155 passed, 0 failed |

Note: the repo's `rustfmt.toml` sets `imports_granularity`, `group_imports` and
`normalize_comments`, which are nightly-only. On stable `cargo fmt` warns and skips them. This diff
touches no imports or comments, so it is unaffected — but a nightly `cargo fmt` is what their CI
runs.

## Manual steps

1. ~~Replace the changelog placeholder.~~ Done: `PR 6635` substituted, commit amended, branch
   force-pushed once with `--force-with-lease` before any review, per CONTRIBUTING's preference
   against force-pushes once review has started.
2. **AI Assistance Disclosure** — the PR template's required section. "Tools used" is required,
   and the attestation *"I have read every line of this diff, understand what it does, and can
   explain it in review"* is personal to the submitter. Not something that can be delegated.
3. ~~Push the branch.~~ Done.
4. Issue first: not required by CONTRIBUTING, and a PR alone is normal for a log-only change.

No DCO or sign-off requirement: neither `CONTRIBUTING.md` nor the PR template mentions one, and
there is no DCO bot config in `.github/`.

## Worth knowing before you post

Master already sends subscriptions as **a single hello RPC** rather than one per topic — that
landed in the 0.50.0 cycle. So the "a subset of the subscription RPCs can be delivered" concern
does not apply to current master; only the silent early return does. The PR is scoped to exactly
that and claims nothing more.
