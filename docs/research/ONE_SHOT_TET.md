# One-shot TET: every signing permission written as a one-time thing

**Status: idea.** Nothing here is built or planned for a phase. Nothing quantum runs in TET, and
nothing in this note says it does.

## The principle

A permission to sign should say how often it may be used, and the default should be **once**. A key
that may sign anything, any number of times, until someone notices, is the shape behind most of the
failures TET is meant to make visible: a replayed message, a double vote, a block signed twice for
the same height, a tag "registered" again after it was sold.

Written as a rule for designs: *for every signature a TET component accepts, name the thing that
makes a second use of the same permission detectable or impossible, and say which of the two it
is.* "Detectable" means a later reader can see the second use and refuse it. "Impossible" means the
second signature cannot be made at all. Today TET only does the former.

## Where TET already does it

| Mechanism | What is used once | What enforces it | Where |
|---|---|---|---|
| **Anonymous membership nullifier** | One message per (member, receiver, time bucket); one welcome grant per member, ever; one poll vote per (member, the poll's receiver, day) | The node stores each nullifier and refuses a second message, claim or vote that carries it | `tet-core/src/tmail/anon.rs`, `tmail/poll.rs`, `grants.rs`; the guest in `methods/` computes `tet_anon_nullifier_v1` |
| **Machine notebook sequence** | Each record's `seq` exactly once, each `prev` naming the record before | `verify` refuses a gap, a swap, a duplicate `seq` or a `prev` that skips | `tools/machine-notebook` |
| **Notebook one-time permits** | A device-signed permit cited by at most one record, not past its `expires_seq` | `verify` refuses a second citation, an expired one, or a permit another key signed | branch `tools/notebook-one-time`, not merged yet |
| **Genuine tag read counter** | Each tap of an NTAG 424 DNA tag carries a counter that must go up | The brand's SUN verifier attests only to a tap whose counter rose; a claim cites the counter | `docs/plans/GENUINE_TAG.md` on branch `plan-genuine-tag`; design only |

All four are **detectable**, not impossible. The key could sign a second time. The second use is
caught by whoever keeps the record: a node's nullifier store, a reader running `verify`, or a brand
verifier. That holds only within what that record-keeper sees. The notebook permits say so plainly:
a copied key can start a second log, and nothing in the original log can see it.

## Where it doesn't, yet

- **Validator slot keys.** Blocks carry no producer signature today; the producer is pinned by its
  libp2p PeerId (`RUNNING_A_NODE.md`), and producer signatures come in Phase 1. As planned, that is
  one long-lived key signing every block. A one-time shape would be a key per slot, or a
  per-height counter in what the producer signs, so that two blocks signed for the same height are
  a visible equivocation rather than a fork the network has to resolve.
- **Maker batch keys.** In the genuine tag design, a brand's registering key (capability
  `register-tags` in its manifest) signs the registrations of a whole production batch, and stays
  valid until the manifest expires. A one-time shape would bind the key to one batch: it names the
  batch's tag IDs, or their count, and a registration outside that list is refused.
- **Agent and owner manifests** (`AgentManifestV1`): a delegated key is limited by expiry and
  capabilities, not by count. A capability could carry a use count, kept by the same kind of
  record-keeper that keeps permits.

Each of these is a design change with its own review, and none is proposed here.

## What a quantum one-shot key would replace

A **one-shot signature** is a quantum secret key that can sign exactly one message: signing uses
the key up, and because a quantum state cannot be copied, there is no second copy to sign with.
The one-time property would be enforced by the key itself instead of by whoever keeps the record.
The idea is from Amos, Georgiou, Kiayias and Zhandry (STOC 2020). The owner asked for two recent
references to be read with it: **IACR ePrint 2025/486** and **arXiv 2510.10899**.

> Written offline: neither paper was opened for this draft. Before this note leaves "idea", their
> titles, their assumptions and what they claim to achieve must be checked against the papers
> themselves, and every sentence here that leans on them corrected.

If such keys existed in practice, they would replace the **detectable** half of each row above with
**impossible**, where the signer is the one to be limited:

- **Validator slot keys:** a producer holding one one-shot key per slot could not sign two blocks
  for the same slot at all. That removes equivocation without anyone having to catch it.
- **Permits and maker batch keys:** a permit held as a one-shot key could not be used in a second
  log, even by someone holding a copy of the device's ordinary key, because there would be no copy
  of the one-shot key. This is exactly the gap the notebook permits name today.
- **Delegated capabilities:** "sign once on my behalf" would be a key handed over, not a rule
  checked afterwards.

It would **not** replace:

- **Nullifiers for anonymity:** a nullifier hides which member acted while showing that a member
  acted once. A one-shot key limits a signer; it does not hide one among many.
- **Ordering and anchoring:** "existed before block N" still comes from a chain.
- **Trust in a brand verifier or a sensor:** a one-shot key limits how often something is said,
  not whether it is true.

## Why write it down now

The principle is useful without any quantum hardware: every new signing permission in TET can name
its "once" and say who enforces it. When one-shot keys become practical, the places that would use
them are then already marked, and each one already says which of today's record-keepers it would
make unnecessary.
