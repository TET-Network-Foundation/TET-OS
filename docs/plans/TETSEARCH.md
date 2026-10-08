# TetSearch — plan (not built)

FUTURE_IDEAS #23. The search half of #19 "Signed web". Starts on **search.stevenexus.org** (no DNS
record yet).

## What it is

A search engine over signed TET sites only (the site builder's output). Publishing to it requires
vouched membership; results are visible to members only.

Wording, everywhere it's described: **"Only vouched people can publish. Built to keep out mass AI
generation."** Never "AI cannot access", never "humans only, guaranteed". The page also says: a
member can still paste AI-written text; vouching limits how many publishers there are, not what
they write.

## Pieces

1. **Index:** only sites whose every edit verifies against the site key (site builder's chain). An
   unsigned or broken site isn't indexed. Plain full-text index of the rendered blocks.
2. **Publishing = vouched membership.** A site is indexed only if its key belongs to a member of the
   TetSearch member set. Joining: an existing member vouches for you in person and adds your
   commitment (the same per-list member root as the members-only poll, MEMBERS_POLL.md option A).
3. **Rate limits per nullifier:** a member's publish requests carry an anonymous proof; the nullifier
   (one per member, receiver and UTC day) caps how much one member can publish per day without
   revealing which member it is.
4. **Results for members only:** a query must show membership. A zero-knowledge proof per query takes
   about 30 seconds, so: one proof per day buys a session token for that day. Honest consequence,
   stated on the page: queries within one day are linkable to each other (not to your key).
5. **AI crawlers:** `robots.txt` disallows known AI crawlers. That is a request, not a wall, and the
   page says so; the members-only results are what actually keep results from being crawled.

- **Proves:** a result's site was published by a vouched member's key, and its content is signed.
- **Doesn't prove:** that a human wrote it, or that it's true.

## Layout

Old-Google plainness: no cards, no images, no colour beyond links.

```
(logo) TetSearch   [ search signed TET sites ............... ] [Search]
────────────────────────────────────────────────────────────────────────
Titration results, week 3
tet://chemclub.example/notes/week-3
Week 3 titrations: three runs at 0.1 M NaOH, endpoint by phenolphthalein,
mean 24.6 mL. Data files attached and signed with the page.
signed · version 4 · block 7,512 · 2026-10-08

Which pH meter do you trust?
tet://chemclub.example/threads/ph-meters
…
```

- Top: the TET logo (small, `public/brand/tet-logo-small.svg` at 16/32 px, the full logo from
  180 px up) and the search box. Nothing else above the fold.
- Each result: **title** (a link), **URL** on its own line, a **1–2 line snippet** from the signed
  blocks, then one meta line: **"signed · version N · block H · date"**. The date is the anchoring
  block's time. "version N" is the site chain's edit count; the block is where its head was stamped.
- A result whose signature doesn't verify isn't shown at all (it was never indexed), so "signed"
  is always true when it appears.
- Members only: a non-member sees the search box and one line saying who can search and why.

## Dependencies (in order)

Site builder (#22) for something to index → per-list member roots (#21, option A) → vouching flow →
search service. TetSearch is last.

## Decided (2026-10-08)

- One member set, **shared with the Shelter corner**.
- Each member can vouch for **at most 3 people** (in total).
- Hosted **on the demo host**, behind its Caddy, at search.stevenexus.org.

Size: the largest item in the queue; several PRs (index service, vouching, search UI), each with its
own plan once #21 and #22 are settled.
