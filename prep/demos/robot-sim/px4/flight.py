#!/usr/bin/env python3
"""A simulated survey flight, written as a ULog file in PX4's message layout.

This is a stand-in for where PX4 SITL is not built (see PX4-INSTALL.md): the file it writes is
NOT a log written by PX4, and the vehicle is a simple simulated quadcopter (a point with a
first-order velocity response, a tilt derived from its acceleration, wind and one gust). The topic
names and fields follow PX4's (`vehicle_local_position`, `vehicle_attitude`, `vehicle_status`), so
the same signing and checking tools take PX4's own log once it exists.

The mission is the two cases kept in ../CASES.md:
  - a near miss: one leg climbs above the 120 m ceiling (peak about 124 m);
  - a geofence exit: a gust pushes the vehicle past the west fence (y < -75 m) for a few seconds.

Local frame NED, as PX4: x north, y east, z down (altitude = -z). Standard library only; one seed.

    python3 flight.py --out flight.ulg [--seed 7]
"""

import argparse
import bisect
import math
import random

import ulog

CEILING_M = 120.0
FENCE = {"x_min": -100.0, "x_max": 100.0, "y_min": -75.0, "y_max": 75.0}
# (x, y, altitude, speed m/s): take-off, survey legs, the high leg, return, land.
WAYPOINTS = [
    (0, 0, 30, 3), (60, -50, 60, 8), (60, 50, 90, 8), (85, 60, 124, 6), (85, 0, 100, 8),
    (90, -60, 80, 8), (-60, -60, 60, 10), (-60, 50, 50, 10), (0, 0, 20, 8), (0, 0, 0, 2),
]
GUST = (66.0, 71.0, -40.0)  # start s, end s, strength along y (negative: west), as an added acceleration of 0.25 * this
DT = 0.02
LOG_HZ = 10


def fly(seed=7):
    rng = random.Random(seed)
    x = y = 0.0
    alt = 0.0
    vx = vy = vz = 0.0
    t = 0.0
    wp = 0
    frames = []
    tau = 1.2
    gust_n = [0.0, 0.0]
    steps_per_log = int(round(1 / (DT * LOG_HZ)))
    step = 0
    while wp < len(WAYPOINTS) and t < 400:
        tx, ty, talt, spd = WAYPOINTS[wp]
        dx, dy, dz = tx - x, ty - y, talt - alt
        dist = math.sqrt(dx * dx + dy * dy + dz * dz)
        if dist < 2.0 or (wp == len(WAYPOINTS) - 1 and alt < 0.05):
            wp += 1
            if wp == len(WAYPOINTS):
                break
            continue
        s = min(spd, dist * 0.6)
        cvx, cvy, cvz = dx / dist * s, dy / dist * s, dz / dist * s
        # wind: a steady 2 m/s from the west plus first-order noise; one gust pushing west
        for i in range(2):
            gust_n[i] += (-gust_n[i] / 3.0) * DT + rng.gauss(0, 0.35) * math.sqrt(DT)
        wx = 0.6 + gust_n[0]
        wy = 2.0 * 0.3 + gust_n[1]
        if GUST[0] <= t < GUST[1]:
            wy += GUST[2]
        ax = (cvx - vx) / tau + 0.25 * wx
        ay = (cvy - vy) / tau + 0.25 * wy
        az = (cvz - vz) / tau
        vx += ax * DT
        vy += ay * DT
        vz += az * DT
        x += vx * DT
        y += vy * DT
        alt = max(0.0, alt + vz * DT)
        t += DT
        step += 1
        if step % steps_per_log == 0:
            # tilt from the horizontal acceleration (small-angle), heading along the velocity
            roll = math.atan2(ay, 9.81)
            pitch = -math.atan2(ax, 9.81)
            yaw = math.atan2(vy, vx) if (vx * vx + vy * vy) > 0.25 else (frames[-1]["yaw"] if frames else 0.0)
            frames.append({"t": t, "x": x, "y": y, "alt": alt, "vx": vx, "vy": vy, "vz": vz,
                           "roll": roll, "pitch": pitch, "yaw": yaw, "wp": wp})
    return frames


def quat(roll, pitch, yaw):
    cr, sr = math.cos(roll / 2), math.sin(roll / 2)
    cp, sp = math.cos(pitch / 2), math.sin(pitch / 2)
    cy, sy = math.cos(yaw / 2), math.sin(yaw / 2)
    return [cr * cp * cy + sr * sp * sy, sr * cp * cy - cr * sp * sy,
            cr * sp * cy + sr * cp * sy, cr * cp * sy - sr * sp * cy]


def outside(f):
    return not (FENCE["x_min"] <= f["x"] <= FENCE["x_max"] and FENCE["y_min"] <= f["y"] <= FENCE["y_max"])


def write(frames):
    w = ulog.Writer(start_us=0)
    w.info("sys_name", "tet-robot-sim demo (not PX4)")
    w.info("ver_hw", "SIMULATED")
    w.fmt("vehicle_local_position", [("uint64_t", "timestamp"), ("float", "x"), ("float", "y"), ("float", "z"),
                                     ("float", "vx"), ("float", "vy"), ("float", "vz")])
    w.fmt("vehicle_attitude", [("uint64_t", "timestamp"), ("float[4]", "q")])
    w.fmt("vehicle_status", [("uint64_t", "timestamp"), ("uint8_t", "nav_state"), ("uint8_t", "geofence_breached")])
    for name in ("vehicle_local_position", "vehicle_attitude", "vehicle_status"):
        w.subscribe(name)
    was_out = False
    was_high = False
    for f in frames:
        ts = int(round(f["t"] * 1e6))
        w.data("vehicle_local_position", [ts, f["x"], f["y"], -f["alt"], f["vx"], f["vy"], -f["vz"]])
        w.data("vehicle_attitude", [ts, quat(f["roll"], f["pitch"], f["yaw"])])
        out = outside(f)
        w.data("vehicle_status", [ts, 3, 1 if out else 0])
        if out != was_out:
            w.text("4" if out else "6", ts, "geofence: outside" if out else "geofence: back inside")
            was_out = out
        high = f["alt"] > CEILING_M
        if high != was_high:
            w.text("4" if high else "6", ts, "altitude above the ceiling" if high else "altitude back below the ceiling")
            was_high = high
    return w.bytes()


def track(log, attitude_ok=None):
    """The flight as the 3D page draws it, read from a ULog alone: (t, x, y, alt, q). With
    `attitude_ok(offset)`, q is taken only from the attitude messages at offsets it accepts (the
    replay passes "in a checked chunk"), and is None when none of those is at or before the sample."""
    pos = [(off, d) for off, d in log.data("vehicle_local_position")]
    att = sorted((d["timestamp"], d["q"]) for off, d in log.data("vehicle_attitude")
                 if attitude_ok is None or attitude_ok(off))
    att_t = [t for t, _ in att]

    def q_at(ts):
        # the latest attitude at or before this sample (PX4 logs the two topics at different times)
        i = bisect.bisect_right(att_t, ts) - 1
        return att[i][1] if i >= 0 else None

    return [{"off": off, "t": d["timestamp"] / 1e6, "x": d["x"], "y": d["y"], "alt": -d["z"],
             "q": q_at(d["timestamp"])} for off, d in pos]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--seed", type=int, default=7)
    a = ap.parse_args()
    frames = fly(a.seed)
    data = write(frames)
    with open(a.out, "wb") as f:
        f.write(data)
    peak = max(frames, key=lambda f: f["alt"])
    outs = [f for f in frames if outside(f)]
    print(f"{len(frames)} frames, {frames[-1]['t']:.1f} s, {len(data)} bytes; peak altitude {peak['alt']:.1f} m at t={peak['t']:.1f} s; "
          f"outside the fence for {len(outs) / LOG_HZ:.1f} s" + (f" from t={outs[0]['t']:.1f} s, max x {max(f['x'] for f in outs):.1f} m" if outs else ""))


if __name__ == "__main__":
    main()
