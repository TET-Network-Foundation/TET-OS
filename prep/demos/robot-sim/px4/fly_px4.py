#!/usr/bin/env python3
"""Fly PX4 SITL (SIH quadcopter) through the demo's two kept cases, over MAVLink on 127.0.0.1.

Run it with the Python that has pymavlink (the PX4 venv), against a PX4 SITL instance that is
already running, e.g. instance 1 started with PX4_NET_INTERFACE=lo so its MAVLink sockets bind to
127.0.0.1 only:

    $SIM_ENGINES/px4/venv/bin/python fly_px4.py --listen 127.0.0.1:14541 --sysid 2 --out mission.json

It listens on PX4's API/offboard link (PX4 sends to 14540 + instance), uploads a mission, arms,
switches to mission mode and waits until PX4 has landed and disarmed. The mission, in PX4's local
frame (metres from home; x north, y east), shaped by the two cases in ../CASES.md:

  take-off to 30 m; north 40 m at 60 m; east 40 m climbing to 124 m (above the demo's 120 m
  ceiling: the near miss); west to y = -95 m at 80 m (past the demo's west fence at y = -75 m:
  the geofence exit); back to y = -40 m at 40 m; land at home.

The ceiling and the fence are this demo's lines, checked against the log afterwards. PX4's own
geofence is not configured for this flight, so PX4 does not react to them. Nothing here contacts
anything but 127.0.0.1.
"""

import argparse
import json
import math
import sys
import os
import time

os.environ.setdefault("MAVLINK20", "1")  # MAVLink 2: mission items carry mission_type
from pymavlink import mavutil  # noqa: E402

M = mavutil.mavlink
# (north m, east m, altitude m above home); the first item is the take-off.
PLAN = [(0, 0, 30), (40, 0, 60), (40, 40, 124), (0, -95, 80), (0, -40, 40)]
SPEED = 8.0


def offset(lat, lon, north, east):
    r = 6378137.0
    return (lat + math.degrees(north / r), lon + math.degrees(east / (r * math.cos(math.radians(lat)))))


def wait(m, types, timeout, cond=None):
    end = time.time() + timeout
    while time.time() < end:
        msg = m.recv_match(type=types, blocking=True, timeout=1)
        if msg is not None and msg.get_srcSystem() == m.target_system and (cond is None or cond(msg)):
            return msg
    return None


def mission_items(m, lat0, lon0):
    items = []
    for seq, (n, e, alt) in enumerate(PLAN):
        lat, lon = offset(lat0, lon0, n, e)
        cmd = M.MAV_CMD_NAV_TAKEOFF if seq == 0 else M.MAV_CMD_NAV_WAYPOINT
        items.append((cmd, 0, int(lat * 1e7), int(lon * 1e7), float(alt)))
    items.insert(1, (M.MAV_CMD_DO_CHANGE_SPEED, 1, 0, 0, 0.0))
    items.append((M.MAV_CMD_NAV_RETURN_TO_LAUNCH, 0, 0, 0, 0.0))
    out = []
    for seq, (cmd, kind, x, y, z) in enumerate(items):
        p2 = SPEED if cmd == M.MAV_CMD_DO_CHANGE_SPEED else 0
        out.append(M.MAVLink_mission_item_int_message(
            m.target_system, m.target_component, seq,
            M.MAV_FRAME_GLOBAL_RELATIVE_ALT_INT if cmd in (M.MAV_CMD_NAV_TAKEOFF, M.MAV_CMD_NAV_WAYPOINT) else M.MAV_FRAME_MISSION, cmd,
            0, 1, kind if cmd == M.MAV_CMD_DO_CHANGE_SPEED else 0, p2, -1 if cmd == M.MAV_CMD_DO_CHANGE_SPEED else 0, 0,
            x, y, z, M.MAV_MISSION_TYPE_MISSION))
    return out


def upload(m, items, log):
    m.mav.mission_count_send(m.target_system, m.target_component, len(items), M.MAV_MISSION_TYPE_MISSION)
    sent = set()
    while True:
        msg = wait(m, ["MISSION_REQUEST_INT", "MISSION_REQUEST", "MISSION_ACK"], 10)
        if msg is None:
            raise SystemExit(f"mission upload: no answer after {len(sent)} of {len(items)} items")
        if msg.get_type() == "MISSION_ACK":
            if msg.type != M.MAV_MISSION_ACCEPTED:
                raise SystemExit(f"mission upload refused: MISSION_ACK type {msg.type}")
            log(f"mission accepted: {len(items)} items")
            return
        m.mav.send(items[msg.seq])
        sent.add(msg.seq)


def command(m, cmd, *params):
    p = list(params) + [0] * (7 - len(params))
    m.mav.command_long_send(m.target_system, m.target_component, cmd, 0, *p)
    ack = wait(m, "COMMAND_ACK", 5, lambda a: a.command == cmd)
    return None if ack is None else ack.result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--listen", default="127.0.0.1:14541")
    ap.add_argument("--sysid", type=int, default=2)
    ap.add_argument("--out", required=True)
    ap.add_argument("--timeout", type=float, default=600)
    a = ap.parse_args()
    if not a.listen.startswith("127.0.0.1:"):
        sys.exit("--listen must be on 127.0.0.1")
    t_start = time.time()
    events = []

    def log(s):
        line = f"{time.time() - t_start:7.1f} s  {s}"
        events.append(line)
        print(line, flush=True)

    m = mavutil.mavlink_connection(f"udpin:{a.listen}", source_system=245)
    hb = None
    end = time.time() + 60
    while time.time() < end:
        hb = m.recv_match(type="HEARTBEAT", blocking=True, timeout=1)
        if hb is not None and hb.get_srcSystem() == a.sysid and hb.get_srcComponent() == 1:
            break
        hb = None
    if hb is None:
        sys.exit(f"no heartbeat from system {a.sysid} on {a.listen} in 60 s")
    m.target_system, m.target_component = a.sysid, 1
    log(f"heartbeat from system {a.sysid}, autopilot {hb.autopilot} (12 = PX4)")

    home = None
    end = time.time() + 120
    while time.time() < end and home is None:
        command(m, M.MAV_CMD_REQUEST_MESSAGE, M.MAVLINK_MSG_ID_HOME_POSITION)
        home = wait(m, "HOME_POSITION", 3)
    if home is None:
        sys.exit("no HOME_POSITION in 120 s (no position estimate yet?)")
    lat0, lon0 = home.latitude / 1e7, home.longitude / 1e7
    log(f"home position received")

    upload(m, mission_items(m, lat0, lon0), log)
    peak = 0.0
    min_east = 0.0
    result = None
    for attempt in range(30):
        result = command(m, M.MAV_CMD_COMPONENT_ARM_DISARM, 1)
        if result == M.MAV_RESULT_ACCEPTED:
            break
        time.sleep(2)
    if result != M.MAV_RESULT_ACCEPTED:
        sys.exit(f"arming refused: COMMAND_ACK result {result}")
    log("armed")
    # PX4 custom mode: main mode AUTO (4), sub mode MISSION (4).
    result = command(m, M.MAV_CMD_DO_SET_MODE, M.MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, 4, 4)
    log(f"mission mode: COMMAND_ACK result {result}")
    if result != M.MAV_RESULT_ACCEPTED:
        sys.exit("mission mode refused")

    reached = -1
    armed_seen_off = False
    end = time.time() + a.timeout
    while time.time() < end:
        msg = m.recv_match(type=["LOCAL_POSITION_NED", "MISSION_ITEM_REACHED", "HEARTBEAT", "STATUSTEXT"], blocking=True, timeout=1)
        if msg is None or msg.get_srcSystem() != a.sysid:
            continue
        t = msg.get_type()
        if t == "LOCAL_POSITION_NED":
            peak = max(peak, -msg.z)
            min_east = min(min_east, msg.y)
        elif t == "MISSION_ITEM_REACHED" and msg.seq != reached:
            reached = msg.seq
            log(f"mission item {msg.seq} reached")
        elif t == "STATUSTEXT":
            log(f"PX4: {msg.text}")
        elif t == "HEARTBEAT" and msg.get_srcComponent() == 1:
            if not (msg.base_mode & M.MAV_MODE_FLAG_SAFETY_ARMED):
                armed_seen_off = True
                log("disarmed (landed)")
                break
    if not armed_seen_off:
        sys.exit(f"still armed after {a.timeout:.0f} s")
    log(f"peak altitude {peak:.1f} m, furthest west y = {min_east:.1f} m (from LOCAL_POSITION_NED)")
    with open(a.out, "w") as f:
        json.dump({"plan_local_m": PLAN, "speed_m_s": SPEED, "peak_alt_m": round(peak, 2),
                   "min_east_m": round(min_east, 2), "events": events}, f, indent=1)
    return 0


if __name__ == "__main__":
    sys.exit(main())
