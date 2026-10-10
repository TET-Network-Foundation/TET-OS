# Launch checklist: the public post on X (target: 2026-10-15 to 10-17)

Worked through once the review stack has merged. Each item says who does it: **F** (the founder),
**C** (Claude, in a session the founder watches), **F+C** (together), or **friends**. An item is done
only when its check has passed and is written next to it with the date.

## 1. Pre-launch

- [ ] **Hide the test boards** (operator hide on the demo node, `deploy/operator-hide.sh`): every
  board, post and file made while testing. Check: the public directory and the boards list show only
  what we mean to show. — C (needs demo SSH)
- [ ] **Make the sample mark** the home page links to (a real file marked with the publisher key,
  published on the demo). Check: its proof code opens and verifies on the demo and in the offline
  verifier. — F+C (the publisher key is the founder's)
- [ ] **Deploy merged main to the demo host** with the new allow-list (`deploy/demo/Caddyfile` and
  `public_api.rs` equal, which CI checks). Check: `deploy/demo/README.md` §5 "Check from outside"
  passes; a route off the list is 404 from outside. — C (needs demo SSH)
- [ ] **Publish the paper and verifier marks** (`scripts/paper_publish_marks.mjs`, and the
  verifier's marks). Check: each proof code verifies on the demo; marks.json says published. — F+C
- [ ] **Re-run the 10-second timing** against the real demo (`scripts/try_ten_seconds.mjs` or the
  current timing test) and correct the number on the page if it's wrong. — C
- [ ] **Every page, in ja / en / zh-HK, on a phone and a desktop, with zero console errors.** A
  headless run for the console (CDP, as the CSP check does) plus a real phone by hand. — C (headless),
  F (phone)
- [ ] **robots.txt and security.txt live** on the demo domain, with the AI-crawler list
  (`deploy/ai-crawlers.txt`). Check: `curl` both; a GPTBot user agent gets 403 on the demo. — C
- [ ] **The demo's healthcheck is real and green:** its own healthchecks.io check (not a seed's),
  Discord alert tested once by stopping it on purpose. — F (healthchecks.io account), C (install)

## 2. Operator readiness

- [ ] **Operator hide tested on the demo:** hide one test post, check it's gone from every public
  route, unhide it, check the operator log line. — C
- [ ] **abuse@ and hello@ tested:** send to each from an outside address; both arrive where the
  founder reads them; the Terms and What is TET pages show the right ones. — F
- [ ] **One-command "demo offline":** Caddy serves a static maintenance page while tet-core keeps
  following the chain; and one command to bring it back. Tested once, timed. — C (needs demo SSH)

## 3. Friends test (3–5 people, before the post)

- [ ] Each one tries, on their own device: open /try, post on a board, mark a file and check its
  code, send a DM and compare the safety number, read "What is TET". — friends, F
- [ ] **Log what confused them** (their words, not ours) in `docs/launch/FRIENDS_TEST.md`. — F, C
- [ ] **Fix blockers only.** Anything else goes to the queue. — C

## 4. Launch day

- [ ] The post on X goes out (the founder's account). — F
- [ ] **No deploys after the post** that day. Only "demo offline" if something is on fire.
- [ ] Watch: the demo's healthcheck, the seeds' checks, abuse@ and the Discord. — F, C

## What needs the founder

- **Demo host SSH.** Port 22 has been unreachable from the founder's networks; once in, add the
  sshd socket drop-in for port 8443 (`deploy/demo/README.md`), so later sessions use 8443.
- **DNS (Porkbun).** `try.stevenexus.org` must point to the demo host's address (A and AAAA).
- **Hardware keys** for the operator accounts (TET-OS-security issues #1–#8).
- The publisher key (sample mark, publishing the marks), healthchecks.io, the email inboxes, the
  friends, and the post.
