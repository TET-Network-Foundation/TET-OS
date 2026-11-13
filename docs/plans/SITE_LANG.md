# Site language — the blocks a TET page is made of (plan, not built)

Companion to SITE_BUILDER.md. A page is an ordered, signed chain of edits; each edit adds, replaces
or removes one **block**. This file is the list of block types and, for each, what the page can
claim about it. Every block is rendered by fixed, deterministic templates: no code from the author
runs, and the same edits render the same bytes anywhere.

Wording rule for every block and the docs around them: say **"quantum-resistant signatures
(ML-DSA)"**. Never say or imply that TET is, runs on or uses a quantum computer.
Never use "quantum-proof", "quantum-safe" or "unbreakable" either.
(`try_privacy_guard` check 4 enforces both repo-wide, with a negative control.)

## v1: the six basic blocks

Proposed set (SITE_BUILDER.md named three; confirm or change these six):

| block | what it holds | rendering |
|---|---|---|
| heading | one line of plain text, level 1–3 | `<h1>`–`<h3>` |
| text | paragraphs with a tiny formatting set: links, bold, italic | `<p>`; no author HTML |
| image | a file hash + the file (public pages) or its encrypted copy (members-only pages) | `<img>` with the hash shown on hover/tap |
| list | ordered or unordered items of plain text | `<ol>` / `<ul>` |
| quote | quoted text and, optionally, who said it (a claim, not checked) | `<blockquote>` |
| link | a URL and a label | `<a>`, shown with its full host |

Every v1 page carries the site's proves line in its footer: "Every block here was published by this
site's key, in this order (version <hash>). That doesn't show who holds the key, or that a person
wrote the text."

## v2 blocks (planned)

None of these is built. Each one's proves / doesn't-prove line is shown with the block itself.

| block | what it is | proves | doesn't prove |
|---|---|---|---|
| **data** | an embedded CSV, its SHA-256, and the site key's signature over both; charts are drawn from it by a declarative spec (chart type, columns, axes), deterministically, with no code execution | that the chart came from this exact data | that the data is correct |
| **math** | a formula in a fixed subset of TeX, rendered server-side and deterministically to SVG; the source is kept next to the picture | that the rendered formula is exactly the signed source | that the mathematics is right |
| **code** | source code shown, never executed; code + its input data + its stated result are signed together as one block | that the code, data and result were published together | that the code produces that result |
| **cite** | a reference to another TET page by its version hash (and optionally one block in it) | that this page points at exactly that version, which can't change under the link | that the cited page is right, or that it supports the point made |
| **source** | the SHA-256 of an original document (for journalism), optionally stamped on chain | that the publisher had a document with this hash (by the stamp's block, if stamped) | what the document says, that it's authentic, or who wrote it |
| **submit** | a timestamped submission to a site that accepts them (for education: homework, applications), stamped on chain | that this exact submission existed by that block, signed by this key | who wrote it, or that the key belongs to the student |
| **cosign** | two or more signers' signatures on the same text, each with its own block height | that each listed key signed exactly this text | that the signers agreed to anything beyond these bytes. **Not a legal contract by itself.** |
| **badge** | the signature badge (SIGNATURE_BADGE.md) for a file on the page | that this key signed this hash at block N | that the work is original or human-made |
| **poll** | a members-only anonymous poll (MEMBERS_POLL.md), closing at the end of its UTC day | each counted vote came from a listed member, at most one per member | who voted what; the node still sees voters' IP addresses |
| **sealed** | text sealed now as a salted hash, revealed at a set date | that the revealed text is what was sealed at that time | that it was a good guess, or that the author didn't seal other versions too |
| **members** | a section encrypted end to end to the site's member set (same encryption as DM: X25519 + Kyber round 3, not yet the final ML-KEM standard); not indexed, not served readable on public routes | that only holders of a member key can read it | who among the members has read it; and it is not "perfect encryption" |

Rules that apply to all v2 blocks:

- **No execution.** data and code are shown, never run; charts and formulas come from fixed
  renderers. A block can't contain script or event attributes (the renderer's guard, with a control).
- **Hashes are shown.** Every block that rests on a hash (data, code, cite, source, submit, badge)
  shows it, so a reader can check it outside TET.
- **Stamps are optional** and, where used, anchor 128 bits of the hash at a block height (the stamp
  path from #59).
- **Each proves line is part of the block's template,** in every language; a guard checks each
  template keeps its line (same pattern as the try page's proves lines).

## Order

v1 ships with the site builder. v2 blocks come one PR each, after TetSearch; badge and poll reuse
their own PRs (SIGNATURE_BADGE, MEMBERS_POLL) and only add the block wrapper.
