# Real robot simulators: options, none installed

The demo's simulated robot is about 60 lines of Python (the `Sim` class in robotsim.py): a point with a heading and one range ray. A
physics simulator with a real robot model would show the same log on a scene people recognise. Nothing
below is installed by this demo.

Sizes and versions are from memory, not measured (no download was made for this page), and should be
checked on the download page before installing. Licences are the projects' own.

| Simulator | Licence | What it needs on macOS | Approx. size | Install line (not run) |
|---|---|---|---|---|
| **MuJoCo** (Google DeepMind) | Apache 2.0 | Python 3 and pip; a wheel for the Python in use. The viewer needs `mjpython` on macOS | tens of MB (wheel plus numpy) | `python3 -m venv robotsim-venv && robotsim-venv/bin/pip install mujoco` |
| **PyBullet** (Bullet Physics) | zlib | Python 3 and pip. Where no wheel exists for the Python in use, pip builds it from source, which needs the Xcode command line tools | about 100 MB, more if built | `python3 -m venv robotsim-venv && robotsim-venv/bin/pip install pybullet` |
| **Webots** (Cyberbotics) | Apache 2.0 | a desktop app; Homebrew cask | over 1 GB | `brew install --cask webots` |
| **Gazebo** Harmonic (Open Robotics) | Apache 2.0 | Homebrew tap with many dependencies; macOS support is less complete than on Ubuntu | several GB with dependencies | `brew tap osrf/simulation && brew install gz-harmonic` |

## Recommendation

**MuJoCo first.** It is the smallest, installs into a separate virtual environment (nothing system-wide,
removed by deleting one folder), runs headless for recording, and ships robot models (arms, wheeled
bases) as plain XML. The demo's `Sim` class would be replaced by a MuJoCo model stepped at the same
rate; the notebook, the checker, the page and the three buttons stay as they are. Open point: whether
a MuJoCo wheel exists for Python 3.14 (the `python3` the demo was written with); if not, a Python 3.12 virtual environment
is needed, which is a second install.

Webots is the most convincing on screen (full 3-D scenes, ready-made robots) but is a large desktop
app, and recording it would need screen capture rather than a headless page. Gazebo is the standard in
ROS work but the heaviest and least smooth on macOS.

## What changes in the claim

Nothing. A physics simulator makes the motion more realistic; it is still a simulated robot, and the
check still shows which key signed which record, in the order of the log it is given, and that a one-time permission was not
used twice in that log, not that any reading is true.

## The 3D view: a library instead of the hand-written renderer

The page's 3D view (`view3d.js`, 550 lines) is WebGL written by hand for this demo, because no 3D
library was at hand when it was written. A library would add:

- real models: a robot or a quadcopter loaded from a glTF file instead of boxes and cylinders;
- shadows, anti-aliased thick lines and a better camera control (orbit with inertia, pan);
- less code of our own to keep.

It would not change what the view draws from where: the markers and the log line would still come
only from the checker's records, and the same tests would hold.

| Library | Licence | What it needs | Approx. size | Install line (not run) |
|---|---|---|---|---|
| **three.js** | MIT | nothing at run time; one file vendored into the demo, inlined by the server like `view3d.js` | about 0.7 MB minified (from memory) | `mkdir -p three-vendor && cd three-vendor && npm install three` then copy `node_modules/three/build/three.module.min.js` and record its version and licence |
| **Babylon.js** | Apache 2.0 | the same, larger | several MB | `mkdir -p babylon-vendor && cd babylon-vendor && npm install @babylonjs/core` |

Sizes are from memory and unchecked. Recommendation: three.js, pinned to the version installed, its
`LICENSE` copied next to the vendored file. For a physics scene rather than a drawn one, MuJoCo
(above) renders its own 3D view; the page would then show its frames instead of drawing the vehicle.
