# PX4 SITL on macOS: what the build needed

Written before PX4 was first built for this demo (2026-11-19); PX4 has since been built with these
lines and flown (README.md). PX4-Autopilot was cloned at `$SIM_ENGINES/px4/PX4-Autopilot` (`SIM_ENGINES`: any folder outside the repository)
(`v1.18.0-beta1-1681-gf65fe36aea`, commit f65fe36aea04, 2.8 GB with submodules). Present: cmake
4.3.1, ninja, Apple clang, Python 3.14.4 (Homebrew) with PyYAML only. At that point nothing had
been installed for this demo.

The first configure, as the normal user in its own build folder:

    cmake -S . -B build/px4_sitl_default -G Ninja -DCONFIG=px4_sitl_default

stops at once with `kconfiglib is not installed or not in PATH` (cmake/kconfig.cmake line 13).
PX4's build scripts also import `em` (empy), `jinja2` and `genmsg` (pyros-genmsg), none of which
are present. Not checked: whether the build needs more after those (it may also want the Homebrew
formula `genromfs`, absent here; the posix target may not use it).

## The lines that add it

A venv beside the clone, so the system Python stays as it is:

```sh
python3 -m venv $SIM_ENGINES/px4/venv
$SIM_ENGINES/px4/venv/bin/pip install future
$SIM_ENGINES/px4/venv/bin/pip install -r $SIM_ENGINES/px4/PX4-Autopilot/Tools/setup/requirements.txt
```

These are the two pip lines PX4's own `Tools/setup/macos.sh` runs (lines 126 and 127), into
another venv folder. `requirements.txt` asks for 33 packages, among them `empy>=3.3,<4`,
`kconfiglib`, `jinja2`, `pyros-genmsg`, `pymavlink` and `pyulog`; whether all of them install on
Python 3.14 is not known. The Homebrew lines `macos.sh` would also run (the arm cross-compiler,
fastdds, xquartz and others) are for hardware builds and Gazebo, and are not needed for SIH; if the
build then asks for `genromfs`: `brew install genromfs`.

Then, in the clone, with the venv first on PATH:

```sh
cd $SIM_ENGINES/px4/PX4-Autopilot
PATH=$SIM_ENGINES/px4/venv/bin:$PATH make px4_sitl_sih sihsim_quadx
```

(target name from docs/en/sim_sih/index.md in the clone). After that the next run of this demo
can fly a mission on 127.0.0.1, read the vehicle over MAVLink, and sign PX4's own ULog from
`build/px4_sitl_sih/rootfs/log/` with `ulogsign.py`.
