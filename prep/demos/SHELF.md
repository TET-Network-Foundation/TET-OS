# Demo shelf

Local demos, each runnable from an empty folder with one command. None is the product, and none
contacts a network.

Videos are kept outside git and fetched separately; each demo's stills are committed.

| Demo | What it shows | One command | Video (outside git) |
|---|---|---|---|
| [robot-sim](robot-sim/README.md) | a simulated drone and a simulated robot write signed logs; a second folder checks each; the drone's two scenarios come from [CASES.md](robot-sim/CASES.md) | `python3 <repo>/prep/demos/robot-sim/robotsim.py --work .` | `robot-sim/demo-drone.webm` (91 s), `robot-sim/demo-robot.webm` (91 s) |
| [agent-console](agent-console/README.md) | agent keys, one-time permits and an outside check, on one screen (EN, 日本語) | `python3 <repo>/prep/demos/agent-console/console.py --work .` | `agent-console/demo.webm` (61 s) |
