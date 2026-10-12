# Installable TET: plan

Status: **plan only, no code. After launch.**

Today TET is a web page served by the demo node. Every visit downloads the page's code again, so
whoever controls the server could serve different code. The signed build manifest and "verify
this page" (#125) let anyone check that afterwards, but they can't stop it beforehand. An installed
app changes that, and an app with its own node also keeps working when the demo server doesn't.

Three steps, each usable on its own:

## 1. PWA: the web app, installable

- **Installable:** a web app manifest, so "Install" or "Add to Home Screen" puts TET on the device
  with its own window and icon.
- **Offline verifier bundled:** the offline verifier (#104, Level 2 in #126) is in the app, so
  checking a `.sig.json` or a stamp works with no connection at all.
- **A service worker that checks integrity:** on install and on every update, it fetches
  `/build-manifest.json`, checks the publisher's signature over it (the same code as
  `verify_site.mjs`), and caches only files whose SHA-256 matches the manifest.
  - An update whose manifest isn't signed by the publisher, or whose files don't match, isn't
    installed. The app keeps running the last good version and says so.
  - A manifest signed for an older commit than the one installed isn't accepted, so the app can't
    be rolled back to an older signed build.
- **Limit, stated in the app:** a service worker is still the browser's. The first install comes
  from the server, so a server that's compromised at that moment could serve a worker that skips
  the checks. After that, updates are checked. The desktop app (step 2) doesn't have this gap.

## 2. Desktop app (Tauri, Rust)

- **One installed program:** the page, plus tet-core running as a **follower node** (it syncs and
  verifies the chain; it doesn't produce blocks), plus the **native prover**.
- **Proofs made locally:** anonymous posts and votes are proved on the device, with nothing sent
  to a remote prover.
- **Keeps working without the demo server:** the app talks to its own node. It reaches the
  network through the seeds' public P2P port (8002/tcp) like any node, and messages travel by
  gossip.
- **Browser peers later:** libp2p over WebRTC (see `docs/plans/BROWSER_NODES.md`) lets apps behind
  NAT reach each other without the seeds. That's a later step.
- **Release signing, for real:**
  - every release (each platform's installer and its update bundle) is marked with the publisher
    key, like the paper and the offline verifier;
  - the proof code is published with the release;
  - a reproducible build is the goal, so anyone can rebuild a release and compare it with the
    marked one.
- **Auto-update only from marked releases:**
  - the updater accepts an update only if its file is marked by the publisher key that is built
    into the app, for a version newer than the installed one;
  - anything else is refused and reported;
  - the key is pinned in the app and can't be changed by an update. Rotating it means a new install,
    announced in advance.
- **Keys stay where they are now:** the passphrase (12 words) is entered only on the restore screen,
  and the device password and auto-lock rules (THREAT_MODEL rule 7) apply. The node's own libp2p
  key is separate from the wallet.
- **Resources:** a follower node needs disk for the chain (today a few GB) and runs while the app is
  open. The app shows how much it uses and offers a "light" mode that only syncs headers. That mode
  waits for blocks to carry producer signatures (Phase 1).

## 3. Local TetSearch index

- **Today:** TetSearch v1 (#127) already searches in the member's tab, fetching each listed site's
  signed edit chain every time.
- **In the app:** the listings and the sites they point to are kept in a local index, refreshed in
  the background and checked like today (every chain verified before indexing), so search works
  offline and returns at once.
- **Same rules as v1:** only vouched members' listings, one result per member, and the node never
  sees what's searched. The index stays on the device, with an option to clear it.
- **Limit:** an offline index is as fresh as the last refresh; the app shows when that was.

## Threat model note (for docs/THREAT_MODEL.md when built)

- **Removed: "the server swaps the page's code".** An installed, signed app runs code that was
  checked at install or update against the publisher's key, not code fetched on each visit. For the
  desktop app this holds from the first install, as long as the installer itself is checked: its
  proof code, or the operating system's code signing.
- **Reduced: depending on the demo server.** The desktop app has its own node and prover, so the
  demo going down or misbehaving doesn't stop it, and a node can't lie about the chain to an app
  that verifies the chain itself.
- **Not removed: a compromised device.** Malware on the device, a compromised operating system or
  browser, or someone with the unlocked device can read the passphrase (12 words) when it's typed,
  sign as the user, or change the app. No app can defend against its own device.
- **Not removed: the publisher key.** Whoever holds the publisher key can sign a malicious update.
  Keep it offline, consider a threshold of signers later, and publish every release's proof code so
  a bad one is visible.
- **Not removed: a bad first download.** Someone who downloads a fake installer from a fake site
  and doesn't check its proof code gets a fake app. The download page says how to check it.

## Order

1. The PWA (smallest; reuses #125 and the offline verifier).
2. The desktop app as a follower node with the prover, with release signing and auto-update.
3. The local TetSearch index.
4. Browser peers, after the browser-nodes plan's relay steps.

## Tests (each with a negative control)

- **Service worker:** a file that doesn't match the manifest isn't cached. Control: skip the check
  → cached.
- **Service worker:** a manifest not signed by the publisher, or signed for an older commit, isn't
  installed. Control: accept any signature → installed.
- **Updater:** an unmarked or older release is refused. Control: skip the mark check → installed.
- **Desktop node:** it follows the chain and reaches the same state root as the seeds. A tampered
  block from a peer is refused. Control: skip block verification → accepted.
- **Local index:** an unverified site chain isn't indexed. Control: index without the check →
  found in search.

## Open questions

1. Code signing by the operating system (Apple notarization, Windows Authenticode): pay for it from
   the start, or start with publisher-key marks only?
2. Which platforms: macOS, Windows and Linux together, or one first?
3. The desktop node's default: full follower, or wait for the light mode?
4. Should the desktop app also offer to run as a public node (port open, helping the network), off
   by default?
5. Where releases are hosted: GitHub Releases, tetnet.org, or both, with the same proof codes?
