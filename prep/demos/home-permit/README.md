Simulation: no robot moved. Design sketch: not a format.

# Home permit: one one-time permit, a home helper robot and a visiting-care tablet

Local only, throwaway. There is no real robot, no real home and no real care provider. Test keys on a
made-up chain: made and kept in software, in this simulation. No real device holds them. Nothing is
sent anywhere.

Two simulated machines, each with its own machine notebook (`tools/machine-notebook/notebook.py`):

- H, a simulated home helper robot; its notebook stands for the home's side. It holds one one-time permit.
- N, a simulated visiting-care tablet; its notebook stands for the care provider's side.

The check does not show who holds a key.

N asks: "take the medicine box from shelf 2 and hand it over". The record R is made and signed by the
two-party sketch in `../two-party-v0` (brought in unchanged): both sides check R field by field (the other
side's key, their own next log position, the agreed hash, the summary, the permit), both sign with
`tet-cli agent sign` (Ed25519 and ML-DSA-44), and each keeps R in its own log. H's entry cites the permit
once. A second request citing the same permit is refused by H's notebook, with the notebook's own line.

In the story a week later, on another computer and offline, a checker gets R, both signatures, both
exports and two pins copied out before the scene began. The sketch's check says `SIGNATURES: valid` and
`LOGS: as promised`, and the notebook's log check counts the permit cited once in H's export.

Two tampers, each on its own copy:

1. N's side changes the summary to another item and signs again: `SIGNATURES: invalid` (H's signature
   is over the old bytes).
2. H's side hands over an export cut back to before R: `SIGNATURES: valid`, `LOGS: conflict at H (cause
   not shown)`. N's copy still holds H's valid signature. A conflict is not a verdict of forgery.

No new signed format: the record, both signatures and the permit citation are the sketch's and the
notebook's. The sketch prints parties as `a` and `b`; this scene shows them as H and N.

In this sketch H's notebook checks the permit when it writes, after both sides signed. So the refused
second request carries both signatures, and both sides then write an abort entry at its position.

## Run

```sh
RISC0_SKIP_BUILD=1 cargo build -p tet-cli
TET_CLI=$PWD/target/debug/tet-cli python3 prep/demos/home-permit/test_scene.py
TET_CLI=$PWD/target/debug/tet-cli python3 prep/demos/home-permit/scene.py      # writes out/scene.json
TET_CLI=$PWD/target/debug/tet-cli bash prep/demos/home-permit/controls.sh      # each control must make its test fail
python3 -m http.server --bind 127.0.0.1 -d prep/demos 8000                    # then open /home-permit/page.html
```

The page draws a stick figure and a tablet with the three.js already vendored in
`../robot-sim/px4/vendor/three`. Nothing is downloaded. The drawing is a picture only.

## What this check judges about the permit

- A second use of the permit inside H's log.

## What this check does not judge

- Whether a person decided the command: the check judges which key signed. It does not judge people or
  organisations.
- Whether the robot did the action, or whether it was safe: not judged. The record is about the
  agreement, not about the action.
- When it happened: only the order inside each log. No date is judged.
- The permit's terms: the permit was made by H's own notebook, and its terms are not in the record.
- Use of the same permit in another notebook: not judged.
- This is not a safety device. It plays no part in stopping or moving anything.

The sketch's own list of what it does not show is in `../two-party-v0/README.md`.
