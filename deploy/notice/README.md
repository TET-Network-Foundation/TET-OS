# The offline notice page

`index.html` is what tetnet.org shows while TET has no host: one static file, English and Japanese,
no scripts, nothing loaded from anywhere else, no cookies. It says what happened, what still checks
offline, and what can't be checked any more, without promising a date.

Host it on any static host (GitHub Pages, the registrar's static page, any web server) as the only
file, and point the names at it. Every change to it runs `tet-network/ui/scripts/notice_page_guard.mjs`
(CI, and `scripts/run_guards.sh`).

When a new host is up, the names move back to it and this page is no longer served.
