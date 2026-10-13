# TetSearch v1: as built

The plan is `docs/plans/TETSEARCH.md` (PR #64). This is what v1 builds, with the simplest true
choice wherever the plan left one open, and where v1 differs from the plan.

## Choices

1. **Publishing = listing.** A site is in TetSearch when a member of Shelter's set (in-person vouch)
   lists it with a record signed by **both** their member wallet and the site's own key
   (`tet-core/src/search.rs`, PAE "tet search list v1"). Nobody can list a site that isn't theirs;
   keys without a human vouch can't publish. At most 5 listings a member a UTC day.
2. **The search runs in the member's browser.** The node keeps only the listings and serves them to a
   member's signed read (`GET /search/listings`, Shelter's `x-tet-shelter-auth`). The page fetches
   each listed site's signed edit chain (public, `/sites/:id`), checks every edit's signatures,
   rebuilds it with the site language and searches the text locally (`app/lib/tetsearch.ts`). The node
   never sees what a member searches for.
3. **Ranking:** every query word must appear; a title match counts more; one result per member (a
   member's best page), so many pages from one member are one voice; then the newer signed version. No
   other signals, no ads, ever.
4. **Results only for members:** the listings are members-only; the sites themselves were already
   public pages. A listing whose member left the set, or whose site expired, isn't served.

## Where v1 differs from the plan

- **Reads are linked to the member's key.** The plan's daily anonymous session (one membership proof
  a day) isn't built: a member's reads of the listings are signed by their member key, so the node
  sees which member read the list and when (not what they searched). The screen says the node sees the
  read. The anonymous session is the follow-up.
- **No per-nullifier publishing quota yet:** the daily cap is per member key (5 a day), not per
  anonymous nullifier.
- **No "signed before" filter, author search or version history page yet;** results link to the site's
  public page, which shows its version.
- **Host:** the screen lives in the try page (`?tab=search`, listed with Shelter). The
  `search.tetnet.org` host is a Caddy route once the domain PR (#110) is in.

## Proves / doesn't prove (on the screen)

Proves: each result's site was listed by a vouched member and every block on it is signed by the
site's key. Doesn't prove: that a person wrote it, or that it's true. A member can still paste
AI-written text: vouching limits how many people publish, not what they write.
