# Good first issues (drafts)

To open as GitHub issues, labelled `good first issue`, once the review stack is on main (some name
files that are only on the stack today). Each is small, has a clear "done", and needs no access to
the servers.

1. **`npm run guards`: run every page guard with one command.** `tet-network/ui/scripts/*_guard.mjs`
   each run alone today (CI lists them one by one). Add a script that runs them all and prints one
   summary line per guard. Done when `npm run guards` passes on a clean checkout and fails if any guard
   fails.
2. **Offline CLI: a `--json` flag.** `public/verify/tet-verify.mjs` prints lines for people. Add
   `--json` that prints one JSON object (verified, signer, proof code, signed SHA-256, and the Level 2
   result when given). Built by `scripts/build_offline_verifier.mjs`; the verifier's guard must stay
   green.
3. **Troubleshooting: a fresh node says `401 ed25519 verification failed`.** Usually a changed genesis
   setting. Add a short entry to `docs/RUN_YOUR_OWN_NODE.md` pointing at the long explanation in
   `docs/RUNNING_A_NODE.md`.
4. **`chain_export.mjs`: progress and resume.** Show progress every 100 blocks, and with `--resume
   <file>` continue an export from its last block. Done when an interrupted export can finish.
5. **Translate `docs/RUN_YOUR_OWN_NODE.md` into Japanese** (`docs/ja/RUN_YOUR_OWN_NODE.md`), following
   the wording rules in `CONTRIBUTING.md`.
6. **Site language: a divider block.** Add `{"type":"divider"}` to `app/lib/site_lang.ts`: the check,
   the renderer (`<hr>`), and a case in the site language's tests, including that no attribute or
   text can be injected through it.
7. **The verify page: copy buttons.** On the /try verify screen, add a copy button next to a verified
   proof code and next to the signer's ID (using the existing copy pattern in `IdCard.tsx`).
