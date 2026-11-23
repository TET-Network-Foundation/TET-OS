# Two simulated drones meet, and each signs the same encounter record

**Status: demo, local only. Simulation: no flight happened. Test keys only.**
Tag: **today**, for the record afterwards; **about 10 years** for shared airspace (a forecast, not a fact).

**This is evidence afterwards, not collision avoidance. It is not a safety system and must not be
shown as one.**

What verify relies on, beyond the folder: see "What verify relies on" in [the notebook README](../../../../tools/machine-notebook/README.md).

## What it does

1. **Fly.** `encounter.py` flies two quadcopters from two operators on crossing straight missions
   (A east at 60 m, B north at 72 m; closest approach 19.9 m at t = 29.1 s with seed 3). Each also
   carries what it *believes* its position is: the truth plus a bias and GPS-like noise. Positions
   are metres east and north of a made-up origin; nothing is a place.
2. **Exchange.** Within 80 m they talk over a simulated direct link: each message is lost with
   chance 0.3 and delayed 30 to 250 ms; every 0.5 s each side sends again what the other has not
   answered. Three messages per side:
   - `HELLO`: a fresh random number (nonce);
   - `SEEN`, "I see you": `{kind: tet_demo_encounter_seen_v1, from, to, nonce_mine, nonce_yours,
     t_s, pos: {east_m, north_m, alt_m}}`, signed by the sender;
   - `COSIGN`: both build the same record `{kind: tet_demo_encounter_v1, parties, seen_sha256}` (both
     SEEN messages by hash, in key-id order) and each sends its signature over it.

   A receiver refuses a SEEN that is not signed by the pinned key of the aircraft it names, that is
   not addressed to it, or that does not carry the nonce it sent in this exchange.
3. **Record.** Each aircraft writes `encounter <sha256> peer=<key id>` into its own notebook through
   the real tool (`tools/machine-notebook/notebook.py record --source stdin-json`), and keeps the two
   SEEN messages, the record and both signatures in `encounters/<sha256>/`. Every signature is
   `tet-cli agent sign` (Ed25519 and ML-DSA-44) with the notebook's own key; every signature check is
   `tet-cli agent verify` against pins kept outside the folder checked.
4. **Check afterwards.** `encounter.py check` takes one log or both, in folders with no key:
   `notebook.py verify` on each, then every encounter (both signatures over the same record, each by
   its party's pinned key; both SEEN messages; each carries the other's nonce; the two believed
   positions not further apart than the link reaches), then, with both logs, whether both copies
   hold the same record.

In this run: 25 messages sent, 5 lost; A recorded at t = 24.9 s, B at 26.4 s.

## What the check says about each log

| Case | What differs | Result |
|---|---|---|
| removed | an encounter is in B's log and not in A's | A's log alone: judged only against A's key; whether an encounter is missing is not judged. Both logs: **MISMATCH**, "only in B's log; A's log has no record of it, though A's key signed it" |
| altitude | A's altitude in A's SEEN and record is 30 m higher than in B's copy, all signed with A's key | A's log: **INVALID**, "counter-signature of the other aircraft (B): encounter.json is not the 352 bytes this envelope signed". B's copy still holds the old altitude |
| replay, in the log | A records the same encounter again, as a second meeting | **INVALID**, "replay: this encounter is already recorded at record 2" |
| replay, in the air | B, in a new exchange, is sent A's old SEEN | refused: "nonce: does not carry the fresh number this aircraft sent (an old message)" |
| third aircraft, in the air | C signs a SEEN that names A as sender | refused: "key: signed by C's key, not the pinned A key" |
| third key, in the log | B invents a meeting with A, A's parts signed by C | **INVALID**, on both the counter-signature and the SEEN, each "signed by C, not the pinned A" |
| one half at a time | in A's copy, one half of B's counter-signature is swapped for B's own valid half over another payload (Ed25519, then ML-DSA-44) | **INVALID** on that counter-signature, each time |

## What this does not show

- That either position was true: the check judges what each aircraft signed as its believed position,
  not whether it was correct.
- That the aircraft were near each other: the check judges whether the two believed positions are
  within 100 m of each other (the 80 m link range plus 20 m); it does not judge the distance between
  the aircraft.
- Which aircraft: the check judges which keys signed; it does not judge who held a key.
- An encounter absent from both copies: the check judges encounters that at least one copy holds.
- With one log only, whether an encounter was removed: judged only against the other aircraft's copy
  (pinned by a test).
- When it happened: each time is the aircraft's own clock claim.
- Anything in real time: nothing here warns, steers or separates aircraft.
- An exchange cut short: if the link drops before both signatures arrive, nothing is recorded.
- A standard: the message format is this demo's own, not an agreed protocol.

## What exists (from memory, unchecked)

- **Remote identification**: each drone broadcasts its id and position, one way, in real time; as
  far as I know not signed in the common schemes, and no two-party record is kept.
- **ADS-B**: crewed aircraft broadcast their own position; not authenticated in its common form (from memory, unchecked).
- **Detect and avoid**: on-board sensing that keeps aircraft apart in real time; that is the safety
  function, and this is not one.
- **Flight logs**: one operator's own file, which that operator can edit.
- **This record**: after the fact; each copy carries the other's signature.

## Why not a chain between the drones

A chain makes many parties agree on one order. Two aircraft that meet are two parties who need to
agree on one record; two signatures over the same bytes do that in three short messages each, over a
link that loses some of them. Consensus between aircraft would need more messages and more time in
range, and would not make this record harder to forge. Peer to peer in the air, yes; a chain in the
air, no. A **stamp on the ground**, later (the notebook's `publish`, not run here), would add one
thing: it would show that the record existed before block N. Not judged here: when the record existed.
It would not show that a position was true.

## Run

    TET_CLI=/path/to/tet-cli python3 prep/demos/robot-sim/encounter/demo.py --work EMPTY_DIR   # writes data.js
    open prep/demos/robot-sim/encounter/page.html
    TET_CLI=/path/to/tet-cli python3 prep/demos/robot-sim/encounter/test_encounter.py         # 19 tests
    TET_CLI=/path/to/tet-cli python3 prep/demos/robot-sim/encounter/controls.py               # 23 controls, each must fail
    PLAYWRIGHT_CORE=/path/to/playwright-core node prep/demos/robot-sim/encounter/record.mjs OUT_DIR

`controls.py` has two kinds: nine remove one tamper step (the test named for it must then fail on
its assertion), and fourteen take one check or rule out of `encounter.py` (among them the receiver's
nonce check, the checker's counter-signature verification, its replay check, the private copy's
rules and the comparison of the two copies).
`record.mjs` opens the page from the file system and refuses every request that is not a file.

Files: `encounter.py` (flight, link, exchange, checker), `tamper.py` (the cases), `demo.py` (runs
them and writes `data.js`), `page.html`, `record.mjs`, `test_encounter.py`, `controls.py`. Standard
library only; tet-cli for every signature.
