# Project rules

## Regression guards must be verified non-vacuous

Every regression guard must be verified non-vacuous before commit: restore the bug (or invert the
key assertion), run the test, and confirm it **FAILS**. Record the negative-control result in the
commit body. A guard that passes with the bug present is decorative and must not be merged.

This is not hypothetical. Two guards in this repository passed with their bug fully present before
the control caught them — one drove a public entry point that rejected the test input on an
unrelated earlier check, so the assertion was true for the wrong reason; another guarded a wire
path that worked regardless of the fix it claimed to protect.

## A signable `TxV1` variant is not an appliable one

Before routing any REST write through the mempool, confirm `apply_consensus_block_batch` has an
arm for that `TxV1` variant. A signable variant is not an appliable one.

Its catch-all returns `Err("unsupported tx in consensus block")` rather than ignoring the tx, so
enqueueing a variant it does not handle does not silently drop the write — it makes **every node
reject the whole block**. `TxV1::GenesisBridge` is exactly this case: present in the enum, signed
and verified by its handler, and absent from the apply match.

## Devlog
The public site repo is at ~/site (github.com/Nexus-Network-Foundation/site).
At the end of every session where something shipped, was fixed, or was found:
1. Append ONE entry to the END of window.POSTS in ~/site/content.js:
   { date: "YYYY-MM-DD", project: "tet" | "unfog" | "kpee", title: "...", body: "..." }
2. If a project's "Where it is now" / "What's live" list, or window.NOW, is now wrong, fix it in the same file.
3. If there's a screenshot worth showing, save it to ~/site/images/<project>-<topic>.jpg
   (max 1100px wide) and put ![caption](images/<name>.jpg) in the body.
4. cd ~/site && git add -A && git commit -m "log: <title>" && git push
Writing rules for the entry:
- First person, plain, short sentences. Write what happened, with the real numbers.
- Say what didn't work too. If an earlier post was wrong, say so in the new one.
- No hype words, no "excited to announce", no emojis, no hashtags.
- Never write secrets: no keys, tokens, passwords, private IPs, personal addresses, school name.
- Don't claim anything the code doesn't do yet.
