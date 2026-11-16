# The offline notice page

**tetnet.org will serve the project site, not this page** (owner, 2026-11-16). The project site is
the `(site)` part of `tet-network/ui`, built with `TET_SITE_ROLE=project` (see
`tet-network/ui/app/site/split.ts`). This page is kept in the repository as a static fallback; it is
not what tetnet.org shows.

`index.html` is one static file, English and Japanese, no scripts, nothing loaded from anywhere
else, no cookies. It says what happened, what still checks offline, and what can't be checked any
more, without promising a date.

If it is ever served, it goes on any static host as the only file. Every change to it runs
`tet-network/ui/scripts/notice_page_guard.mjs` (CI, and `scripts/run_guards.sh`).
