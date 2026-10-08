# Thread-style site builder — plan (not built)

FUTURE_IDEAS #22. Part of #19 "Signed web".

## What it is

You build a page the way you post to a thread: add a block (heading, text, image), and it appears.
Fixed templates render the blocks into a static page. No AI anywhere in the path. Every edit is
signed by the site's key and versioned.

- **Proves:** every block on the page was published by the site's key, in this order, and which
  version you are looking at.
- **Doesn't prove:** who holds the key, or that a human wrote the text.

## Public or members only, per page

Each page is one or the other, chosen when it's created:

- **Public:** signed, served openly, and search engines may index it.
- **Members only:** end-to-end encrypted to the site's member set, not indexed, not served on any
  public route in readable form. Same encryption as DM (hybrid X25519 + Kyber round 3, not yet the
  final ML-KEM standard); the page says that, and never "perfect encryption" or "unbreakable".

## Shape

- **A site** = a key (its own 12 words, like a board) + an ordered list of signed edits.
- **An edit** = `{site, seq, prev_hash, op: add|replace|remove, block}` signed with the site key.
  `prev_hash` chains edits, so the order can't be rewritten without breaking every later signature.
- **A block** = `heading | text | image` (image = file hash + the file). Plain text with a tiny,
  fixed formatting set (paragraphs, links, bold); no HTML from the author, so a page can't run
  scripts.
- **Rendering:** one pure function `render(edits) → html` with three templates. Same edits, same
  bytes, anywhere: a reader can re-render and compare.

## The gap: where a site lives

Board posts last 7 days and keep 5 per sender; files last 7 days. A site has to last. Options:

- **A. A "sites" store on the demo node** (recommended): a node-local, quota'd store of signed edit
  chains (e.g. 5 MB per site, 1,000 sites), served read-only; only edits signed by the site key and
  extending the chain are accepted. Node change, not consensus. Anchoring the chain head with a
  stamp makes the order provable to a block.
- **B. Export only:** the builder downloads a static folder (html + `.sig.json` per version) to
  host anywhere. Works today with no node change; nothing hosted by TET.
- **C. Wait for the storage market** (FUTURE_IDEAS #13).

## Guards

- An edit not signed by the site key, or not extending the chain, is refused; controls.
- `render` is deterministic: the same edits render byte-identical output (property test); author
  text can't produce a `<script>` or an event attribute (control: a renderer that passes HTML).
- The proves line is on every rendered page's footer.

## Decided (2026-10-08)

- Hosting: **both**, a store on the demo node with a size cap, plus export.

## Open

1. Images: inline in the site store (counts against the quota) or via Files (7 days, so they'd
   expire)?
2. Domain: pages at `try.stevenexus.org/s/<site>` or a separate host?

Size: a node PR (the store, with tests and controls) and a UI PR (builder, renderer, export).
