#!/usr/bin/env python3
"""Simulated drone and robot demo for the machine notebook. Local only (127.0.0.1).

Two vehicles, each with its own notebook and its own new test key: a simulated quadcopter flying a
survey mission (take-off, four waypoints, a geofence, wind as noise, battery, landing), and a
two-wheeled simulated robot. The page has a vehicle switch and a scenario switch; the drone's two
scenarios come from the cases in CASES.md that were kept (a near miss: the altitude
record; a survey flight: the geofence exit), each with two buttons:
  alter_alt  the climb record's altitude is lowered to 118 m      -> that record's signature
  take_out   the climb record is removed                           -> "a record is missing"
  swap_exit  the exit record and the next trade places             -> their seq
  other_key  the exit record is replaced, signed by another key    -> that record's key (the pin)

The ground robot has three buttons (below); no ground-robot case was kept.

Two machines that are not vehicles, from the two cases that survived CASES-2.md, each tagged from
FUTURES.md ("today" or "about N years: a forecast, not a fact"):
  a cold-chain box (today): a refrigerated box on a road journey; the door opens, it goes over 8 C
    lower_peak   the peak record's temperature is set to 7.80 C     -> that record's signature
    take_peak    the peak record is removed                          -> "a record is missing"
    hide_door    the door-open record and the next trade places      -> their seq
  a plate reader (about 10 years: a forecast): one well's OD600 every 5 min, one high reading (a bubble)
    drop_outlier the outlier reading is removed                      -> "a record is missing"
    smooth_read  the outlier is set to the mean of its neighbours    -> that record's signature

A two-wheeled simulated robot drives a course in a small arena with a noisy range sensor. Every step
is written as one record into a machine notebook (tools/machine-notebook/notebook.py), signed by
`tet-cli agent sign` with a fresh test key made for this demo. A checker copies the log into a SECOND
folder, which holds no key, and runs `notebook.py verify` there with the pin kept outside both
folders. The page shows the live simulation on the left and the log as the checker sees it on the
right.

Three buttons change the checker's copy (never the simulated robot's own folder) and the check says
which record it refuses:
  alter    one logged value is edited                 -> that record's signature
  replay   a one-time permit is cited a second time   -> "was already used by record N"
           (the case judges the permit check alone)
  reorder  two records swap places                    -> their seq and prev

    python3 robotsim.py --work <empty folder> [--vehicles drone,robot,coldchain,lab]
                                                (tet-cli: TET_CLI, else <repo>/target/release/tet-cli)

Every signature and every signature check goes through notebook.py and tet-cli; the page's
"≠ live" mark is a comparison the page makes itself. The chain it signs for is a demo chain (TET_CHAIN_ID tet-robot-sim-demo), not a network.
"""

import argparse
import hashlib
import http.server
import json
import math
import os
import random
import re
import shutil
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
NOTEBOOK_DIR = os.path.join(ROOT, "tools", "machine-notebook")
NOTEBOOK = os.path.join(NOTEBOOK_DIR, "notebook.py")
sys.path.insert(0, NOTEBOOK_DIR)
sys.path.insert(0, os.path.dirname(HERE))
sys.dont_write_bytecode = True
import tetcli_path  # noqa: E402  (the one place the tet-cli path is made absolute)
import notebook  # noqa: E402  (only for canonical(), sign() and the payload type: the real tools)

CHAIN = {"TET_CHAIN_ID": "tet-robot-sim-demo", "TET_GENESIS_HASH": hashlib.sha256(b"robot-sim demo chain").hexdigest()}
UNIT = "robot-sim-v1 x,y m; heading deg; range m (noisy); v m/s"
ACTION = "pass-gate"
MAX_STEPS_CAP = 600  # the bound on --max-steps; the page shows the effective value

NOT_SHOWN = [
    "It is a simulated robot, not a robot: nothing here ran on hardware.",
    "Which machine signed: the check judges which key signed each record; it does not judge which machine held that key.",
    "When each record was written: the check judges the order of records in the log it is given; it does not judge when each record was written.",
    "It does not show that the sensor told the truth: the log holds what was measured, noise and all.",
    "Use of a permit in another log: the permit check judges reuse of a permit within one log; it does not judge use of that permit in another log.",
    "That the log is complete at its end: not judged. A log produced by the key's holder: not judged; the check judges the log it is given against the pinned key.",
    "The permit is signed today by the machine's own key; a permit signed by the owner is planned.",
]


def tet_cli():
    return tetcli_path.tet_cli()


def run_notebook(args, stdin=None):
    env = tetcli_path.tool_env()
    env.pop("TET_MNEMONIC", None)
    env.update(CHAIN)
    p = subprocess.run([sys.executable, NOTEBOOK] + args, input=stdin, capture_output=True, text=True, env=env, timeout=300)
    return p.returncode, p.stdout, p.stderr


# ── the simulated robot ──────────────────────────────────────────────────────────────────────────


class Sim:
    """Differential-drive robot following a rectangle of waypoints in a 4 m x 3 m arena. The range
    sensor looks straight ahead to the nearest wall and adds Gaussian noise (sigma 2 cm)."""

    W, H = 4.0, 3.0
    COURSE = [(0.8, 0.8), (3.2, 0.8), (3.2, 2.2), (0.8, 2.2)]
    GATE = 2  # passing waypoint 2 for the first time is the one action the permit allows

    def __init__(self, step_s=0.5, seed=7):
        self.rng = random.Random(seed)
        self.x, self.y, self.h = 0.8, 0.8, 0.0
        self.target = 1
        self.step_s = step_s
        self.t = 0.0
        self.gate_passed = False

    def true_range(self):
        c, s = math.cos(self.h), math.sin(self.h)
        ds = []
        if c > 1e-9:
            ds.append((self.W - self.x) / c)
        if c < -1e-9:
            ds.append(-self.x / c)
        if s > 1e-9:
            ds.append((self.H - self.y) / s)
        if s < -1e-9:
            ds.append(-self.y / s)
        return min(ds)

    def step(self):
        """Advance one step; return the telemetry the robot reports, and whether it passed the gate."""
        v = 0.35
        gate_now = False
        for _ in range(10):
            dt = self.step_s / 10 if self.step_s > 0 else 0.05
            tx, ty = self.COURSE[self.target]
            if math.hypot(tx - self.x, ty - self.y) < 0.12:
                if self.target == self.GATE and not self.gate_passed:
                    self.gate_passed = gate_now = True
                self.target = (self.target + 1) % len(self.COURSE)
                tx, ty = self.COURSE[self.target]
            err = math.atan2(ty - self.y, tx - self.x) - self.h
            err = math.atan2(math.sin(err), math.cos(err))
            omega = max(-2.5, min(2.5, 4.0 * err))
            self.h = math.atan2(math.sin(self.h + omega * dt), math.cos(self.h + omega * dt))
            self.x += v * math.cos(self.h) * dt
            self.y += v * math.sin(self.h) * dt
            self.t += dt
        true_r = self.true_range()
        measured = true_r + self.rng.gauss(0, 0.02)
        return {
            "x": round(self.x, 3), "y": round(self.y, 3), "heading": round(math.degrees(self.h), 1),
            "range": round(measured, 3), "range_true": round(true_r, 3), "v": v,
        }, gate_now


def telemetry_value(tel):
    """The reading as logged: what the robot reports. range_true is not reported (no sensor knows it)."""
    return f"x={tel['x']:.3f} y={tel['y']:.3f} heading={tel['heading']:.1f} range={tel['range']:.3f} v={tel['v']:.2f}"


class DroneSim:
    """A simulated quadcopter flying a survey mission over a 200 m x 150 m area, seen from above, with
    altitude. Take-off at home, four waypoints, return, landing. Wind is a steady breeze plus Gaussian
    noise, with one gust near the east edge that pushes the drone over the geofence for a moment; the
    third leg climbs above the 120 m ceiling (the near miss). Each step is 2 s of simulated flight."""

    W, H = 200.0, 150.0
    FENCE = (10.0, 10.0, 190.0, 140.0)
    CEILING = 120.0
    HOME = (30.0, 30.0)
    CRUISE = 60.0
    WAYPOINTS = [(170.0, 30.0, 60.0), (186.0, 80.0, 60.0), (170.0, 120.0, 130.0), (30.0, 120.0, 60.0)]
    DT = 2.0

    def __init__(self, step_s=0.5, seed=11):
        self.rng = random.Random(seed)
        self.x, self.y, self.alt = self.HOME[0], self.HOME[1], 0.0
        self.phase, self.target, self.batt, self.t = "takeoff", 0, 100.0, 0.0
        self.done = False
        self.gust_steps = 0

    def inside(self):
        x0, y0, x1, y1 = self.FENCE
        return x0 <= self.x <= x1 and y0 <= self.y <= y1

    def step(self):
        """Advance 2 s of flight; return the telemetry the drone reports (no permit is cited)."""
        wx, wy = 1.5 + self.rng.gauss(0, 0.8), 0.5 + self.rng.gauss(0, 0.8)
        if self.phase == "cruise" and self.target == 1 and self.x > 176 and self.gust_steps < 2:
            wx += 15.0  # the gust near the east edge: two steps, once
            self.gust_steps += 1
        sub = 10
        for _ in range(sub):
            dt = self.DT / sub
            if self.phase == "takeoff":
                tx, ty, ta = self.HOME[0], self.HOME[1], self.CRUISE
            elif self.phase == "cruise":
                tx, ty, ta = self.WAYPOINTS[self.target]
            elif self.phase == "return":
                tx, ty, ta = self.HOME[0], self.HOME[1], self.CRUISE
            elif self.phase == "landing":
                tx, ty, ta = self.HOME[0], self.HOME[1], 0.0
            else:
                break
            dx, dy = tx - self.x, ty - self.y
            d = math.hypot(dx, dy)
            v = min(8.0, d / dt) if d > 0 else 0.0
            airborne = self.alt > 1.0
            self.x += ((dx / d * v) if d else 0.0) * dt + (wx * 0.6 * dt if airborne else 0.0)
            self.y += ((dy / d * v) if d else 0.0) * dt + (wy * 0.6 * dt if airborne else 0.0)
            rate = 2.0 if self.phase == "landing" else 4.0
            self.alt = max(0.0, self.alt + max(-rate * dt, min(rate * dt, ta - self.alt)))
            self.batt = max(0.0, self.batt - 0.25 * dt * (1 + math.hypot(wx, wy) / 6))
            self.t += dt
            here = math.hypot(tx - self.x, ty - self.y) < 5.0 and abs(ta - self.alt) < 2.0
            if self.phase == "takeoff" and abs(self.alt - self.CRUISE) < 2.0:
                self.phase = "cruise"
            elif self.phase == "cruise" and here:
                self.target += 1
                if self.target == len(self.WAYPOINTS):
                    self.phase = "return"
            elif self.phase == "return" and here:
                self.phase = "landing"
            elif self.phase == "landing" and self.alt <= 0.0:
                self.phase, self.done = "landed", True
        return {
            "phase": self.phase, "x": round(self.x, 1), "y": round(self.y, 1), "alt": round(self.alt, 1),
            "wind": round(math.hypot(wx, wy), 1), "batt": round(self.batt, 1),
            "fence": "in" if self.inside() else "OUT",
        }, False


def drone_value(tel):
    """The reading as the simulated drone logs it."""
    return (f"phase={tel['phase']} x={tel['x']:.1f} y={tel['y']:.1f} alt={tel['alt']:.1f} "
            f"wind={tel['wind']:.1f} batt={tel['batt']:.1f} fence={tel['fence']}")


DRONE_UNIT = "drone-sim-v1 x,y m in the survey area; alt m above take-off; wind m/s; batt %"


class ColdChainSim:
    """A simulated refrigerated box with a temperature logger on a 12 h road journey (CASES-2.md case 1):
    depot, a hand-over hub where a second carrier takes over (on paper, at record 20), the receiver. The
    box holds 4 C; the air outside is 22 C. At a stop near the hub the door stays open for two records,
    and the temperature goes over the 8 C limit, then comes back. Each step is 15 simulated minutes."""

    W, H = 320.0, 160.0
    DEPOT, HUB, RECEIVER = (20.0, 30.0), (160.0, 90.0), (300.0, 130.0)
    SETPOINT, OUTSIDE, LIMIT = 4.0, 22.0, 8.0
    STEPS, HANDOVER, ARRIVE = 48, 20, 44
    DOOR = (18, 19)  # the records during which the door is open
    DT_MIN = 15

    def __init__(self, step_s=0.5, seed=23):
        self.rng = random.Random(seed)
        self.n, self.temp, self.batt, self.done = 0, self.SETPOINT, 100.0, False

    def where(self, n):
        def lerp(a, b, f):
            return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f
        if n < self.HANDOVER:
            return lerp(self.DEPOT, self.HUB, n / self.HANDOVER)
        if n <= self.ARRIVE:
            return lerp(self.HUB, self.RECEIVER, (n - self.HANDOVER) / (self.ARRIVE - self.HANDOVER))
        return self.RECEIVER

    def step(self):
        self.n += 1
        n = self.n
        door = "open" if n in self.DOOR else "closed"
        target, k = (self.OUTSIDE, 0.3) if door == "open" else (self.SETPOINT, 0.35)
        self.temp += (target - self.temp) * k + self.rng.gauss(0, 0.1)
        self.batt = max(0.0, self.batt - 0.2)
        x, y = self.where(n)
        self.done = n >= self.STEPS
        return {"min": n * self.DT_MIN, "temp": round(self.temp, 2), "door": door, "x": round(x, 1), "y": round(y, 1),
                "batt": round(self.batt, 1), "leg": 1 if n < self.HANDOVER else 2}, False

    def marks(self, tel, seq, marks):
        """The door record (the first with the door open) and the peak (the warmest record over the limit)."""
        out = []
        if tel["door"] == "open" and "door" not in marks:
            marks["door"] = seq
            out.append(f"record {seq}: the box's door is open")
        if tel["temp"] > self.LIMIT and ("peak" not in marks or tel["temp"] > self.peak):
            marks["peak"], self.peak = seq, tel["temp"]
            out.append(f"record {seq}: {tel['temp']:.2f} C, over the {self.LIMIT:.0f} C limit")
        return out

    def layout(self):
        return {"course": [list(self.DEPOT), list(self.HUB), list(self.RECEIVER)], "arena": [self.W, self.H],
                "home": list(self.DEPOT), "limit": {"value": self.LIMIT, "label": f"limit {self.LIMIT:.0f} °C"}}


def coldchain_value(tel):
    """The reading as the simulated logger writes it. The leg is not logged: the logger does not know it."""
    return (f"min={tel['min']} temp={tel['temp']:.2f} door={tel['door']} x={tel['x']:.1f} y={tel['y']:.1f} "
            f"batt={tel['batt']:.1f}")


class LabSim:
    """A simulated plate reader (CASES-2.md case 3): the optical density at 600 nm of one culture well,
    read every 5 simulated minutes for 2 hours. Logistic growth with reading noise; at reading 11 a bubble
    in the well gives one high reading (the outlier). The incubator holds 37 C."""

    STEPS, OUTLIER, DT_MIN = 25, 11, 5
    W, H = 12.0, 2.0  # the view draws the run along a time axis: x = minutes / 10

    def __init__(self, step_s=0.5, seed=31):
        self.rng = random.Random(seed)
        self.n, self.done = 0, False

    def step(self):
        self.n += 1
        t = (self.n - 1) * self.DT_MIN
        od = 0.05 + 0.9 / (1 + math.exp(-(t - 70) / 12)) + self.rng.gauss(0, 0.004)
        bubble = self.n == self.OUTLIER
        if bubble:
            od += 0.22
        self.done = self.n >= self.STEPS
        return {"min": t, "od600": round(od, 3), "temp": round(37.0 + self.rng.gauss(0, 0.05), 2), "bubble": bubble}, False

    def marks(self, tel, seq, marks):
        if tel["bubble"] and "outlier" not in marks:
            marks["outlier"] = seq
            return [f"record {seq}: a bubble in the well (simulated): this reading is high"]
        return []

    def layout(self):
        return {"course": [[0.0, 1.0], [self.STEPS * self.DT_MIN / 10, 1.0]], "arena": [self.W, self.H], "home": None,
                "limit": None}


def lab_value(tel):
    """The reading as the simulated plate reader writes it. Whether a bubble was there is not logged."""
    return f"min={tel['min']} od600={tel['od600']:.3f} temp={tel['temp']:.2f}"


COLDCHAIN_UNIT = "coldchain-sim-v1 min since packing; temp C inside the box; x,y km on the route map; batt %"
LAB_UNIT = "platereader-sim-v1 min since start; od600 optical density at 600 nm, one well; temp C incubator"
VEHICLES = {
    "robot": {"sim": lambda step_s: Sim(step_s=step_s), "value": None, "unit": UNIT},
    "drone": {"sim": lambda step_s: DroneSim(step_s=step_s), "value": drone_value, "unit": DRONE_UNIT},
    "coldchain": {"sim": lambda step_s: ColdChainSim(step_s=step_s), "value": coldchain_value, "unit": COLDCHAIN_UNIT},
    "lab": {"sim": lambda step_s: LabSim(step_s=step_s), "value": lab_value, "unit": LAB_UNIT},
}

NOT_SHOWN_COMMON = [
    "It is a simulator, not a drone or a robot: nothing here flew or drove.",
    "Which machine signed: the check judges which key signed each record; it does not judge which machine held that key.",
    "When each record was written: the check judges the order of records in the log it is given; it does not judge when each record was written.",
    "It does not show that the sensor or the GPS told the truth: the log holds what was measured.",
    "That the log is complete at its end: not judged.",
    "A log produced by the key's holder: the check judges the copy against the pinned key; it does not judge a log the key's holder produced.",
]

# The scenarios on the page. Each comes from a case in CASES.md that was kept;
# the ground robot's buttons are not tied to a case.
NOT_SHOWN_MACHINE = [
    "It is a simulator: no real logger, instrument or sensor was used.",
    "Which machine signed: the check judges which key signed each record; it does not judge which machine held that key.",
    "When each record was written: the check judges the order of records in the log it is given; it does not judge when each record was written.",
    "It does not show that the sensor told the truth: the log holds what was measured.",
    "That the log is complete at its end: not judged.",
    "A log produced by the key's holder: the check judges the copy against the pinned key; it does not judge a log the key's holder produced.",
]

# What differs from what exists (TET is one of many).
ONE_OF_MANY = ("TET is one of many. From memory, unchecked, several drafts and open-source "
               "projects sign each record and link it to the one before, some with a post-quantum signature too. Whether "
               "they also require both signatures to pass is not known to us; TET's check refuses a record unless both "
               "match the pinned keys.")

# The scenarios on the page. Each comes from a case that was kept (CASES.md, CASES-2.md);
# the ground robot's buttons are not tied to a case. "horizon" says whether
# the situation is today's or a forecast (FUTURES.md). The three boxes: why TET fits, what changes with a
# signed log, how this differs from what exists.
SCENARIOS = [
    {
        "id": "near-miss", "vehicle": "drone", "title": "A near miss: the altitude record",
        "case": "CASES.md case 1", "horizon": "today",
        "story": "After a reported near miss, the authority asks the operator for the flight log. The pilot exports it from the simulated aircraft, whose key stays on board. The log shows a climb above the 120 m ceiling.",
        "buttons": [["alter_alt:climb", "Lower the altitude of the climb record"], ["take_out:climb", "Take the climb record out"]],
        "fits": "The pilot carries the exported log but not the aircraft's key, and the authority asking is a third party.",
        "changes": "An altitude lowered in the export, or the climb record taken out of its middle, is refused offline against the aircraft's pinned key.",
        "differs": "ArduPilot, from memory (unchecked), does not sign its stored logs; MAVLink signing protects the radio link, not the log. " + ONE_OF_MANY,
        "not_shown": NOT_SHOWN_COMMON + ["That the barometer read the altitude right."],
    },
    {
        "id": "geofence", "vehicle": "drone", "title": "A survey flight: the geofence exit",
        "case": "CASES.md case 2", "horizon": "today",
        "story": "A gust pushes the simulated survey drone over the agreed boundary for a moment. The client asks for the log with the report. Someone between the aircraft and the client tries to hide the exit.",
        "buttons": [["swap_exit:exit", "Swap the exit record with the next one"], ["other_key:exit", "Replace the exit record with one signed by another key"]],
        "fits": "The log reaches the client through hands that do not hold the aircraft's key.",
        "changes": "Exit records moved, or replaced by a record signed with another key, are refused by their order and by the pin.",
        "differs": "Remote ID broadcasts position live but is not a stored log; a third party that recorded it holds an independent record. " + ONE_OF_MANY,
        "not_shown": NOT_SHOWN_COMMON + ["That the geofence set in the app was the boundary agreed with the client."],
    },
    {
        "id": "general", "vehicle": "robot", "title": "General checks (no real case survived for a ground robot)",
        "case": "CASES.md: cases 4 to 7 were dropped", "horizon": "today",
        "story": "Three changes to a log. None of the ground-robot cases in CASES.md was kept, so these are not tied to a real situation.",
        "buttons": [["alter", "1. Alter one logged value"], ["replay", "2. Use the one-time permit twice"], ["reorder", "3. Swap two records"]],
        "fits": "Here it does not: in every ground-robot case the person asked held the key, or CCTV and the result settled it. These buttons show the mechanics only.",
        "changes": "An altered value, a permit cited twice in this log, and two swapped records are each refused for their own reason.",
        "differs": ONE_OF_MANY,
        "not_shown": NOT_SHOWN,
    },
    {
        "id": "excursion", "vehicle": "coldchain", "title": "A shipment's temperature excursion",
        "case": "CASES-2.md case 1", "horizon": "today",
        "story": "A simulated refrigerated box travels from a depot to a receiver; a second carrier takes over at a hub. At a stop the door stays open and the box goes over 8 °C for a while. The receiver asks for the logger's read-out, which reaches it through the carriers.",
        "buttons": [["lower_peak:peak", "Lower the peak temperature"], ["take_peak:peak", "Take the peak record out"], ["hide_door:door", "Swap the door-open record with the next one"]],
        "fits": "The carrier carries the logger and its read-out, and should not hold its key; the receiver asking is a third party. Holds where the logger's key stays in the logger; the check does not judge whether it did.",
        "changes": "A lowered peak, the peak taken out of the middle, or the door record moved is refused offline, with no logger maker's server. Not judged: whether the records at the end of the journey are in the copy.",
        "differs": "Logger makers offer protected PDF read-outs and their own clouds (from memory, unchecked); those settle it for one brand. " + ONE_OF_MANY,
        "not_shown": NOT_SHOWN_MACHINE + [
            "That the probe read the air around the goods, or that the logger travelled with these goods.",
            "Where one carrier's leg ends: the log shows order, not time; the hand-over comes from the shipping document.",
            "That a carrier holding the logger for hours did not read its key out: the key is in a file here, not in hardware.",
        ],
    },
    {
        "id": "lab-run", "vehicle": "lab", "title": "A lab run handed to a journal",
        "case": "CASES-2.md case 3", "horizon": "about 10 years: a forecast, not a fact",
        "story": "A forecast, not a fact: a shared facility's simulated plate reader measures a culture's growth for two hours; one reading is high because of a bubble. The analyst exports the run and sends it to a collaborator and a journal, who check it against the facility's pin.",
        "buttons": [["drop_outlier:outlier", "Take the outlier reading out"], ["smooth_read:outlier", "Edit the outlier to smooth the curve"]],
        "fits": "The analyst carries the export; the facility or the instrument holds the key. Today journals rarely ask for an instrument-signed run; that is the forecast (FUTURES.md).",
        "changes": "An outlier taken out of the middle of the run is named as a missing record, and a smoothed reading as a broken signature.",
        "differs": "Instrument software keeps audit trails, and regulated labs follow audit-trail rules (from memory, unchecked); a signed export matters only when the file travels alone. " + ONE_OF_MANY,
        "not_shown": NOT_SHOWN_MACHINE + [
            "That the sample in the well was what its label says, or that the instrument was calibrated.",
            "Not judged: whether the run handed on was the only one made.",
        ],
    },
]


# ── the demo: device folder, checker folder, tamper buttons ──────────────────────────────────────


class Demo:
    def __init__(self, work, max_steps=120, step_s=0.5, gate_step=None, vehicle="robot"):
        if not 1 <= max_steps <= MAX_STEPS_CAP:
            raise ValueError(f"max_steps is 1 to {MAX_STEPS_CAP}, not {max_steps}")
        self.work = os.path.abspath(work)
        self.device = os.path.join(self.work, "device")      # the simulated robot's notebook (holds the key)
        self.checker = os.path.join(self.work, "checker")    # the second folder: a copy, no key
        self.pin = os.path.join(self.work, "device.pin")     # kept outside both folders
        self.max_steps, self.step_s, self.gate_step = max_steps, step_s, gate_step
        if vehicle not in VEHICLES:
            raise ValueError(f"vehicle is one of {sorted(VEHICLES)}")
        self.vehicle = vehicle
        self.sim = VEHICLES[vehicle]["sim"](step_s)
        self.unit = VEHICLES[vehicle]["unit"]
        self.value = VEHICLES[vehicle]["value"] or telemetry_value
        self.marks = {}         # "climb" / "exit": the first record that shows it
        self.other = os.path.join(self.work, "other")  # a second notebook with another key (other_key)
        self.lock = threading.Lock()
        self.live = []          # telemetry per step, as the simulation produced it
        self.permit_id = None
        self.permit_seq = None  # the record that cited the permit
        self.tampered = None    # None, or what was done to the checker's copy
        self.check = {"verdict": "waiting", "records": [], "log": [], "checked_n": 0, "ms": 0}
        self.events = []
        self.stop = threading.Event()

    # setup
    def init(self):
        if os.path.exists(self.device):
            raise SystemExit(f"{self.device} exists; give an empty --work folder")
        os.makedirs(self.work, exist_ok=True)
        rc, out, err = run_notebook(["init", "--dir", self.device])
        if rc != 0:
            raise SystemExit(f"notebook init failed: {err.strip()[-300:]}")
        shutil.copyfile(os.path.join(self.device, "device.pin"), self.pin)
        if self.vehicle == "robot":  # the drone's scenarios cite no permit
            rc, out, err = run_notebook(["permit", "--dir", self.device, "--action", ACTION, "--expires-seq", str(self.max_steps * 2)])
            if rc != 0:
                raise SystemExit(f"notebook permit failed: {err.strip()[-300:]}")
            self.permit_id = out.strip()
        os.makedirs(self.checker)
        with open(os.path.join(self.device, "device.keyid")) as f:
            self.event(f"new test key for this demo: {f.read().strip()}")
        if self.permit_id:
            self.event(f"one-time permit for '{ACTION}' signed by that key")

    def event(self, s):
        with self.lock:
            self.events.append({"t": time.strftime("%H:%M:%S"), "s": s})
            del self.events[:-40]

    # one step of the simulated robot, written into its notebook
    def step(self):
        tel, gate = self.sim.step()
        seq = len(self.live) + 1
        if self.gate_step is not None:
            gate = seq == self.gate_step
        args = ["record", "--dir", self.device, "--source", "stdin-json"]
        if gate and self.permit_seq is None:
            args += ["--permit", self.permit_id]
        rc, out, err = run_notebook(args, json.dumps({"value": self.value(tel), "unit": self.unit}))
        if rc != 0:
            raise RuntimeError(f"record failed: {err.strip()[-300:]}")
        tel["seq"], tel["value"] = seq, self.value(tel)
        tel["permit"] = "--permit" in args
        with self.lock:
            self.live.append(tel)
            if tel["permit"]:
                self.permit_seq = seq
            if tel.get("alt", 0) > DroneSim.CEILING and "climb" not in self.marks:
                self.marks["climb"] = seq
                self.events.append({"t": time.strftime("%H:%M:%S"), "s": f"record {seq}: climbed to {tel['alt']:.1f} m, above the {DroneSim.CEILING:.0f} m ceiling"})
            if tel.get("fence") == "OUT" and "exit" not in self.marks:
                self.marks["exit"] = seq
                self.events.append({"t": time.strftime("%H:%M:%S"), "s": f"record {seq}: outside the geofence"})
            for msg in (self.sim.marks(tel, seq, self.marks) if hasattr(self.sim, "marks") else []):
                self.events.append({"t": time.strftime("%H:%M:%S"), "s": msg})
        if tel["permit"]:
            self.event(f"record {seq}: passed the gate, citing the one-time permit")
        return tel

    # the checker: copy what the device has logged so far into the second folder, then verify there
    def sync(self):
        if self.tampered:
            return False
        chain = notebook.chain_lines(self.device)
        n = len(chain)
        have = len(notebook.chain_lines(self.checker))
        if n == have and n > 0:
            return False
        for name in ("chain.json",):
            shutil.copyfile(os.path.join(self.device, name), os.path.join(self.checker, name))
        os.makedirs(os.path.join(self.checker, "records"), exist_ok=True)
        if os.path.isdir(os.path.join(self.device, "permits")):
            shutil.copytree(os.path.join(self.device, "permits"), os.path.join(self.checker, "permits"), dirs_exist_ok=True)
        for seq in range(have + 1, n + 1):
            for ext in (".json", ".json.sig.json"):
                shutil.copyfile(os.path.join(self.device, "records", f"{seq}{ext}"), os.path.join(self.checker, "records", f"{seq}{ext}"))
        with open(os.path.join(self.checker, "chain.txt"), "w") as f:
            f.write("".join(h + "\n" for h in chain))
        return True

    def verify(self):
        """Run notebook.py verify on the checker's folder, and read its verdict per record."""
        t0 = time.time()
        rc, out, err = run_notebook(["verify", "--dir", self.checker, "--pin", self.pin])
        ms = int((time.time() - t0) * 1000)
        result = parse_verify(out)
        if rc not in (0, 1) or result["verdict"] not in ("VALID", "INVALID"):
            result = {"verdict": "ERROR", "by_seq": {}, "log": [(err or out).strip()[-300:]]}
        rec_dir = os.path.join(self.checker, "records")
        # Listed exactly as notebook.py check_chain lists them, and each read by the name verify read.
        names = sorted((int(m.group(1)), n) for n in os.listdir(rec_dir) if (m := re.fullmatch(r"([0-9]+)\.json", n))) if os.path.isdir(rec_dir) else []
        seqs = [seq for seq, _ in names]
        rows = []
        for seq, name in names:
            with open(os.path.join(rec_dir, name), "rb") as f:
                body = f.read()
            try:
                rec = json.loads(body)
                value = rec.get("reading", {}).get("value")
            except (ValueError, AttributeError):
                rec, value = {}, None
            # The page names the folder, not its full path (which would show the user's home folder).
            reasons = [w.replace(self.checker + os.sep, "checker/") for w in result["by_seq"].get(seq, [])]
            rows.append({
                "file": seq, "seq": rec.get("seq") if isinstance(rec, dict) else None, "value": value,
                "permit": isinstance(rec, dict) and "permit" in rec,
                "status": "refused" if reasons else ("checked" if result["verdict"] in ("VALID", "INVALID") else "error"),
                "reasons": reasons,
            })
        with self.lock:
            self.check = {"verdict": result["verdict"], "records": rows, "log": result["log"], "checked_n": len(seqs), "ms": ms}
        return result

    # the three buttons: each changes the checker's copy only
    def _need(self, n):
        have = len(notebook.chain_lines(self.checker))
        if have < n:
            raise ValueError(f"wait until the checker holds {n} records (it holds {have})")
        return have

    def tamper_alter(self):
        """Edit one logged value in the checker's copy. Its signature no longer matches."""
        n = self._need(3)
        seq = max(1, n // 2)
        path = os.path.join(self.checker, "records", f"{seq}.json")
        with open(path, "rb") as f:
            rec = json.loads(f.read())
        old = rec["reading"]["value"]
        new = re.sub(r"x=(-?[0-9.]+)", lambda m: f"x={float(m.group(1)) + 0.5:.3f}", old, count=1)
        rec["reading"]["value"] = new
        self.tampered = f"alter: record {seq}, x moved by 0.5 m"
        write_bytes(path, notebook.canonical(rec))  # control:alter
        self.event(f"checker's copy: record {seq} edited ({old.split()[0]} -> {new.split()[0]})")
        return seq

    def tamper_replay(self):
        """Append a record that cites the already used permit a second time; the case judges the
        one-time permit check alone."""
        n = self._need(1)
        if self.permit_seq is None or self.permit_seq > n:
            raise ValueError("wait until the simulated robot has passed the gate and used its permit")
        chain = notebook.chain_lines(self.checker)
        seq = n + 1
        last = self.live[min(n, len(self.live)) - 1]
        rec = {
            "v": 1, "kind": notebook.KIND, "seq": seq, "prev": chain[-1],
            "reading": {"source": "stdin-json", "value": last["value"], "unit": self.unit},
            "clock_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        rec["permit"] = self.permit_id  # control:replay
        body = notebook.canonical(rec)
        path = os.path.join(self.checker, "records", f"{seq}.json")
        with open(path, "wb") as f:
            f.write(body)
        self.tampered = f"replay: record {seq} cites the permit again"
        # The device's own key, through tet-cli agent sign, under the chain in device/chain.json.
        notebook.sign(tet_cli(), self.device, path, notebook.PAYLOAD_TYPE)
        with open(os.path.join(self.checker, "chain.txt"), "a") as f:
            f.write(notebook.sha256_hex(body) + "\n")
        self.event(f"checker's copy: record {seq} added, citing the permit record {self.permit_seq} already used")
        return seq

    def tamper_reorder(self):
        """Swap two records (body, signature and chain.txt line) in the checker's copy. Each still
        carries a valid signature by the device's key; only their order is wrong."""
        n = self._need(3)
        a = max(1, n - 2)
        rec_dir = os.path.join(self.checker, "records")
        self.tampered = f"reorder: records {a} and {a + 1} swapped"
        swap_records(self.checker, a)  # control:reorder
        self.event(f"checker's copy: records {a} and {a + 1} swapped")
        return a

    # the drone scenarios' buttons: each changes the checker's copy only, at the record the scenario names
    def _mark(self, target):
        seq = self.marks.get(target)
        if seq is None:
            raise ValueError(f"wait until the log holds the {target} record")
        have = len(notebook.chain_lines(self.checker))
        if have < seq + 1:
            raise ValueError(f"wait until the checker holds record {seq + 1} (it holds {have})")
        return seq

    def tamper_alter_alt(self, target="climb"):
        """Lower the altitude in one record of the checker's copy to just under the ceiling."""
        seq = self._mark(target)
        path = os.path.join(self.checker, "records", f"{seq}.json")
        with open(path, "rb") as f:
            rec = json.loads(f.read())
        old = rec["reading"]["value"]
        rec["reading"]["value"] = re.sub(r"alt=[0-9.]+", "alt=118.0", old, count=1)
        self.tampered = f"alter_alt: record {seq}, altitude set to 118.0 m"
        write_bytes(path, notebook.canonical(rec))  # control:alter_alt
        self.event(f"checker's copy: record {seq} altitude lowered to 118.0 m")
        return seq

    def tamper_take_out(self, target="climb"):
        """Remove one record (body, envelope, chain.txt line) from the middle of the checker's copy."""
        seq = self._mark(target)
        self.tampered = f"take_out: record {seq} removed"
        remove_record(self.checker, seq)  # control:take_out
        self.event(f"checker's copy: record {seq} taken out")
        return seq

    def tamper_swap_exit(self, target="exit"):
        """The exit record and the one after it trade places, each with its own valid signature."""
        seq = self._mark(target)
        self.tampered = f"swap_exit: records {seq} and {seq + 1} swapped"
        swap_records(self.checker, seq)  # control:swap_exit
        self.event(f"checker's copy: records {seq} and {seq + 1} swapped")
        return seq

    def tamper_other_key(self, target="exit"):
        """Replace one record (the reading with fence=in) with one signed by ANOTHER key, from a second
        notebook made for this; the case judges the key pin alone. The log as a whole has two
        signers."""
        seq = self._mark(target)
        if not os.path.exists(os.path.join(self.other, "device.key")):
            rc, out, err = run_notebook(["init", "--dir", self.other])
            if rc != 0:
                raise RuntimeError(f"notebook init (other key) failed: {err.strip()[-300:]}")
        chain = notebook.chain_lines(self.checker)
        rec = {
            "v": 1, "kind": notebook.KIND, "seq": seq, "prev": chain[seq - 2] if seq > 1 else notebook.ZERO,
            "reading": {"source": "stdin-json", "value": self.live[seq - 1]["value"].replace("fence=OUT", "fence=in"), "unit": self.unit},
            "clock_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        body = notebook.canonical(rec)
        path = os.path.join(self.checker, "records", f"{seq}.json")
        write_bytes(path, body)
        signer = self.device
        signer = self.other  # control:other_key
        notebook.sign(tet_cli(), signer, path, notebook.PAYLOAD_TYPE)
        chain[seq - 1] = notebook.sha256_hex(body)
        with open(os.path.join(self.checker, "chain.txt"), "w") as f:
            f.write("".join(h + "\n" for h in chain))
        self.tampered = f"other_key: record {seq} replaced, signed by another key"
        self.event(f"checker's copy: record {seq} replaced by one signed with another key")
        return seq

    # the cold-chain and lab scenarios' buttons: each changes the checker's copy only
    def _set_field(self, seq, field, new):
        """Set one field of one record's reading in the checker's copy; its signature is left as it was."""
        path = os.path.join(self.checker, "records", f"{seq}.json")
        with open(path, "rb") as f:
            rec = json.loads(f.read())
        old = rec["reading"]["value"]
        rec["reading"]["value"] = re.sub(field + r"=-?[0-9.]+", f"{field}={new}", old, count=1)
        return path, rec, old

    def tamper_lower_peak(self, target="peak"):
        """The warmest record's temperature is set to 7.80 C, just under the limit."""
        seq = self._mark(target)
        path, rec, old = self._set_field(seq, "temp", "7.80")
        self.tampered = f"lower_peak: record {seq}, temperature set to 7.80 C"
        write_bytes(path, notebook.canonical(rec))  # control:lower_peak
        self.event(f"checker's copy: record {seq} temperature lowered to 7.80 C")
        return seq

    def tamper_take_peak(self, target="peak"):
        """The warmest record is removed from the middle of the checker's copy."""
        seq = self._mark(target)
        self.tampered = f"take_peak: record {seq} removed"
        remove_record(self.checker, seq)  # control:take_peak
        self.event(f"checker's copy: record {seq} taken out")
        return seq

    def tamper_hide_door(self, target="door"):
        """The door-open record and the one after it trade places, each with its own valid signature."""
        seq = self._mark(target)
        self.tampered = f"hide_door: records {seq} and {seq + 1} swapped"
        swap_records(self.checker, seq)  # control:hide_door
        self.event(f"checker's copy: records {seq} and {seq + 1} swapped")
        return seq

    def tamper_drop_outlier(self, target="outlier"):
        """The outlier reading is removed from the middle of the run."""
        seq = self._mark(target)
        self.tampered = f"drop_outlier: record {seq} removed"
        remove_record(self.checker, seq)  # control:drop_outlier
        self.event(f"checker's copy: record {seq} (the outlier) taken out")
        return seq

    def tamper_smooth_read(self, target="outlier"):
        """The outlier reading is replaced by the mean of its two neighbours, as the analyst would smooth it."""
        seq = self._mark(target)
        a, b = self.live[seq - 2]["od600"], self.live[seq]["od600"]
        new = f"{(a + b) / 2:.3f}"
        path, rec, old = self._set_field(seq, "od600", new)
        self.tampered = f"smooth_read: record {seq}, od600 set to {new}"
        write_bytes(path, notebook.canonical(rec))  # control:smooth_read
        self.event(f"checker's copy: record {seq} od600 smoothed to {new}")
        return seq

    def reset(self):
        """Throw the checker's copy away and copy the simulated robot's log again."""
        shutil.rmtree(self.checker)
        os.makedirs(self.checker)
        self.tampered = None
        self.event(f"checker's copy thrown away and copied again from the simulated {self.vehicle}")
        self.sync()
        self.verify()

    def finished(self):
        return len(self.live) >= self.max_steps or getattr(self.sim, "done", False)

    def state(self):
        with self.lock:
            drone = self.vehicle == "drone"
            lay = self.sim.layout() if hasattr(self.sim, "layout") else {
                "course": [list(w) for w in DroneSim.WAYPOINTS] if drone else Sim.COURSE,
                "arena": [DroneSim.W, DroneSim.H] if drone else [Sim.W, Sim.H],
                "home": DroneSim.HOME if drone else None, "limit": None,
            }
            return {
                "vehicle": self.vehicle, "marks": dict(self.marks),
                "course": lay["course"], "arena": lay["arena"], "limit": lay["limit"],
                "gate": Sim.COURSE[Sim.GATE] if self.vehicle == "robot" else None,
                "fence": DroneSim.FENCE if drone else None, "ceiling": DroneSim.CEILING if drone else None,
                "home": lay["home"], "scenarios": SCENARIOS,
                "live": self.live[-400:], "max_steps": self.max_steps, "step_s": self.step_s,
                "steps_cap": MAX_STEPS_CAP, "running": not self.finished() and not self.stop.is_set(),
                "permit_seq": self.permit_seq, "tampered": self.tampered, "check": self.check,
                "events": self.events[-12:], "not_shown": NOT_SHOWN, "shows": notebook.SHOWS,
            }


def write_bytes(path, body):
    with open(path, "wb") as f:
        f.write(body)


def remove_record(d, seq):
    """Record seq leaves the folder: body, envelope and its chain.txt line."""
    for ext in (".json", ".json.sig.json"):
        os.remove(os.path.join(d, "records", f"{seq}{ext}"))
    chain = notebook.chain_lines(d)
    del chain[seq - 1]
    with open(os.path.join(d, "chain.txt"), "w") as f:
        f.write("".join(h + "\n" for h in chain))


def swap_records(d, a):
    """Records a and a+1 trade places: body, envelope and chain.txt line together."""
    rec_dir = os.path.join(d, "records")
    for ext in (".json", ".json.sig.json"):
        pa, pb = os.path.join(rec_dir, f"{a}{ext}"), os.path.join(rec_dir, f"{a + 1}{ext}")
        os.replace(pa, pa + ".swap")
        os.replace(pb, pa)
        os.replace(pa + ".swap", pb)
    chain = notebook.chain_lines(d)
    chain[a - 1], chain[a] = chain[a], chain[a - 1]
    with open(os.path.join(d, "chain.txt"), "w") as f:
        f.write("".join(h + "\n" for h in chain))


def parse_verify(out):
    """notebook.py verify prints VALID or INVALID, then one line per problem: 'record N: why' or
    'log: why', then 'Shows:'."""
    lines = re.sub(r"\x1b\[[0-9;]*m", "", out).splitlines()
    verdict = lines[0].strip() if lines else ""
    by_seq, log = {}, []
    for ln in lines[1:]:
        if ln.startswith("Shows:"):
            break
        m = re.fullmatch(r"  record (\d+): (.*)", ln)
        if m:
            by_seq.setdefault(int(m.group(1)), []).append(m.group(2))
        elif ln.startswith("  log: "):
            log.append(ln[len("  log: "):])
    return {"verdict": verdict, "by_seq": by_seq, "log": log}


# ── the page server (127.0.0.1 only) ─────────────────────────────────────────────────────────────


TAMPERS = {"alter": "tamper_alter", "replay": "tamper_replay", "reorder": "tamper_reorder",
           "alter_alt": "tamper_alter_alt", "take_out": "tamper_take_out", "swap_exit": "tamper_swap_exit",
           "other_key": "tamper_other_key", "lower_peak": "tamper_lower_peak", "take_peak": "tamper_take_peak",
           "hide_door": "tamper_hide_door", "drop_outlier": "tamper_drop_outlier", "smooth_read": "tamper_smooth_read"}
TARGETS = {"climb", "exit", "peak", "door", "outlier"}


def run_meta(demos):
    """What the page's status bar shows: run id, seeds, versions, commit. Read once, when serving starts."""
    import inspect
    import platform

    def out(cmd):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=5, cwd=HERE)
            return r.stdout.strip() if r.returncode == 0 else None
        except (OSError, subprocess.SubprocessError):
            return None

    sims = {"robot": Sim, "drone": DroneSim, "coldchain": ColdChainSim, "lab": LabSim}
    seeds = {v: inspect.signature(sims[v].__init__).parameters["seed"].default for v in demos if v in sims}
    commit = out(["git", "rev-parse", "--short=10", "HEAD"])
    if commit and out(["git", "status", "--porcelain", "--", "."]):
        commit += " + local changes"
    started = time.strftime("%Y-%m-%d %H:%M:%S %z")
    work = "|".join(sorted(d.work for d in demos.values()))
    run_id = time.strftime("%Y%m%d-%H%M%S") + "-" + hashlib.sha256((work + started).encode()).hexdigest()[:6]
    tet = out([tet_cli(), "--version"])
    return {"run_id": run_id, "started": started, "seeds": seeds, "python": platform.python_version(),
            "tet_cli": tet.split()[-1] if tet else None, "commit": commit or "not in a git checkout"}


def make_handler(demos, port):
    if isinstance(demos, Demo):
        demos = {demos.vehicle: demos}
    default = next(iter(demos))
    with open(os.path.join(HERE, "page.html"), "rb") as f:
        page = f.read()
    with open(os.path.join(HERE, "view3d.js"), "rb") as f:
        page = page.replace(b"/*VIEW3D*/", f.read(), 1)  # the 3D view, inlined: the page loads nothing else
    meta = json.dumps(run_meta(demos)).replace("<", "\\u003c").encode()
    page = page.replace(b"/*META*/null", meta, 1)  # control:meta
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="application/json"):
            b = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'")
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            if self.headers.get("Host") not in allowed_hosts:
                return self.send(403, {"error": "host"})
            path, q = split(self.path)
            if path == "/":
                return self.send(200, page, "text/html; charset=utf-8")
            if path == "/state":
                demo = demos.get(q.get("v", default))
                if demo is None:
                    return self.send(404, {"error": "no such vehicle"})
                st = demo.state()
                st["vehicles"] = list(demos)
                return self.send(200, st)
            self.send(404, {"error": "not found"})

        def do_POST(self):
            # A page on another site may not press the buttons: same Host and Origin only.
            origin = self.headers.get("Origin")
            if self.headers.get("Host") not in allowed_hosts or (origin and origin.split("//", 1)[-1] not in allowed_hosts):
                return self.send(403, {"error": "host"})
            path, q = split(self.path)
            demo = demos.get(q.get("v", default))
            name = path[len("/tamper/"):] if path.startswith("/tamper/") else None
            target = q.get("t")
            if demo is None or (path != "/reset" and name not in TAMPERS) or (target is not None and target not in TARGETS):
                return self.send(404, {"error": "not found"})
            fn = demo.reset if path == "/reset" else getattr(demo, TAMPERS[name])
            with demo_busy:
                try:
                    if path != "/reset" and demo.tampered:
                        raise ValueError("the checker's copy is already changed; press reset first")
                    r = fn(target) if target else fn()
                    if path != "/reset":
                        demo.verify()
                except ValueError as e:
                    return self.send(409, {"error": str(e)})
            self.send(200, {"ok": True, "seq": r})

    return H


def split(raw):
    """'/tamper/x?v=drone&t=exit' -> ('/tamper/x', {'v': 'drone', 't': 'exit'}); short names only."""
    path, _, qs = raw.partition("?")
    q = {}
    for part in qs.split("&") if qs else []:
        k, _, v = part.partition("=")
        if re.fullmatch(r"[a-z]{1,8}", k) and re.fullmatch(r"[a-z_-]{1,16}", v):
            q[k] = v
    return path, q


demo_busy = threading.Lock()  # one change or check of the checker's folder at a time


def run_sim(demo):
    while not demo.finished() and not demo.stop.is_set():
        t0 = time.time()
        demo.step()
        demo.stop.wait(max(0.0, demo.step_s - (time.time() - t0)))
    name = {"drone": "drone", "robot": "robot", "coldchain": "cold-chain box", "lab": "plate reader"}[demo.vehicle]
    done = {"drone": "landed", "coldchain": "arrived", "lab": "finished its run"}.get(demo.vehicle, "stopped")
    what = f"simulated {name} {done}" if getattr(demo.sim, "done", False) else f"simulated {name} stopped"
    demo.event(f"{what} after {len(demo.live)} steps (the bound is {demo.max_steps})")


def run_checker(demos):
    first = demos[0]
    while not first.stop.is_set():
        for demo in demos:
            with demo_busy:
                if demo.sync():
                    demo.verify()
        first.stop.wait(0.3)


def main(argv=None):
    p = argparse.ArgumentParser(description="simulated robot + machine notebook demo, 127.0.0.1 only")
    p.add_argument("--work", required=True, help="an empty folder; the demo makes robot/ and drone/ in it, each with device/, checker/ and device.pin")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--max-steps", type=int, default=120, help=f"the simulated robot stops after this many steps (1 to {MAX_STEPS_CAP})")
    p.add_argument("--step", type=float, default=0.5, help="seconds per step")
    p.add_argument("--vehicles", default="drone,robot,coldchain,lab", help="which machines to run, comma-separated: drone, robot, coldchain, lab (default all four; one alone keeps each check fast)")
    a = p.parse_args(argv)
    if not os.path.exists(tet_cli()):
        raise SystemExit("tet-cli not found: set TET_CLI or build it (cargo build -p tet-cli --release)")
    if not (0.05 <= a.step <= 10):
        raise SystemExit("--step is 0.05 to 10 seconds")
    vehicles = a.vehicles.split(",")
    if not vehicles or len(set(vehicles)) != len(vehicles) or not set(vehicles) <= set(VEHICLES):
        raise SystemExit(f"--vehicles is a comma-separated list of {', '.join(VEHICLES)}, each once")
    demos, stop = {}, threading.Event()
    for v in vehicles:
        demos[v] = Demo(os.path.join(a.work, v), max_steps=a.max_steps, step_s=a.step, vehicle=v)
        demos[v].stop = stop  # one stop for all
        demos[v].init()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(demos, a.port))
    for d in demos.values():
        threading.Thread(target=run_sim, args=(d,), daemon=True).start()
    threading.Thread(target=run_checker, args=(list(demos.values()),), daemon=True).start()
    print(f"open http://127.0.0.1:{a.port}/   (simulated: {', '.join(vehicles)}; each stops after {a.max_steps} steps at most, or when its run ends; Ctrl-C to quit)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        stop.set()
        srv.server_close()


if __name__ == "__main__":
    main()
