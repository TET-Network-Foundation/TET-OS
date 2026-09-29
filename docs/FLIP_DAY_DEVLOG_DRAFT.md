# Devlog entry — draft for flip day

**Not published.** Paste into `~/site/content.js` as the last element of `window.POSTS`, per the
Devlog rules in CLAUDE.md. Update the date, re-check every number, and **remove the seed line if the
seed is still down**.

Written to those rules: first person, plain, short sentences, real numbers, say what didn't work,
no hype, no emoji.

```js
  { date: "YYYY-MM-DD", project: "tet", title: "The code is public now",
    body: "TET-OS is open. https://github.com/TET-Network-Foundation/TET-OS\n\nWhat works, between two countries: coins, encrypted mail, file sharing, scheduled release, burn-after-read, and anonymous sending with a zero-knowledge proof that uses only hashes.\n\nWhat doesn't: pinned messages, and the deposit that would make anonymous sending cost something. Both need a change I can only make when I cut a new genesis, which I'm targeting for the first quarter of next year. Their tests fail on purpose so nobody can mistake them for done.\n\nIt is not audited. There is one seed node, which means one machine can take the network down. The anonymity set is everyone my node has seen register, which today is a handful of people. All of that is written down in SECURITY.md rather than left for someone to discover.\n\nThe last two weeks were mostly finding out what I had not tested. I wrote a table of every behaviour against every condition that had caused a bug that month, then read the tests instead of trusting their names. It said nothing restarted a node. So I wrote that test, and it found that a transaction someone sent could disappear if the node restarted before it was mined — accepted, receipt given, gone. That is fixed.\n\nIt also said twelve of my regression tests had never been checked by putting the bug back. I checked all twelve. They all catch what they claim. One was weaker than it looked: it only failed when I removed both halves of a check, so removing one half would have passed review and passed CI. That one is stronger now.\n\nThe worst thing I found was in a file I had planned to leave alone. A crypto bundle that ships to browsers could not be rebuilt from its own source, so I went to fix that. The rebuild signed with the wrong post-quantum parameter set, and the node would have rejected every signature from every browser wallet. It had never broken anything only because the committed file was old enough to predate the mistake. The safe-looking thing — leaving it alone — was what kept the bug alive.\n\n253 tests when I started, 280 now, and a workflow that runs the zero-knowledge ones against a real prover instead of a mock." },
```

## Checks before publishing

- [ ] Date is the actual flip date
- [ ] Test count is current (`cargo test -p tet-core` — 264 + 16 = 280 as of 2026-09-29)
- [ ] The Phase 1 quarter still says Q1 2027
- [ ] **The seed is up.** The entry says "between two countries"; if the seed is still down, either
      say so or cut the claim. Do not publish a claim the reader can falsify in one command.
- [ ] `window.NOW` updated in the same commit if it has gone stale
- [ ] No secrets, no personal address, no school name (CLAUDE.md)

## What this entry deliberately does not do

It does not thank anyone, announce a roadmap, or use the word "excited". It leads with the two
things a reader most needs — the link and what actually works — and spends its middle on what went
wrong, because that is the part worth reading and the part nobody else will write.

It does not mention the key material purged from git history. That is in SECURITY.md, which is the
right place: a devlog entry is a story, and a security note is a record. If someone asks on HN,
answer plainly and link SECURITY.md.
