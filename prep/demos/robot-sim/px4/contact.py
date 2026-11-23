#!/usr/bin/env python3
"""Contact only, in MuJoCo: the quadcopter's touchdown and the ground robot's wheels on the floor.

The flight itself is PX4's job (or flight.py's until PX4 is built); MuJoCo is used here for the one
thing a point-mass flight model cannot give: what happens when a body meets the ground.

  landing:  a 1.5 kg quadcopter frame on four legs comes down at a set speed with its rotors giving
            90 % of hover thrust until the first leg touches, then none. Measured: the peak normal
            force, whether it bounces, the time to rest, the force at rest.
  robot:    a two-wheeled robot with a caster drives its wheels at a set speed on a floor of a set
            friction. Measured: the slip of the wheels while it speeds up and once it is steady.

Needs MuJoCo's Python package (the venv in $SIM_ENGINES/mujoco). Contacts nothing.

    $SIM_ENGINES/mujoco/bin/python contact.py --out contact.json
"""

import argparse
import json
import math

import mujoco

G = 9.81
QUAD_MASS = 1.5

LANDING_XML = """
<mujoco model="quad-landing">
  <option timestep="0.0005" gravity="0 0 -9.81"/>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1" friction="1 0.005 0.0001"/>
    <body name="quad" pos="0 0 0.30">
      <freejoint/>
      <geom name="frame" type="box" size="0.15 0.15 0.03" mass="1.30"/>
      <geom name="leg1" type="capsule" fromto=" 0.12  0.12 -0.03  0.14  0.14 -0.14" size="0.008" mass="0.05" solref="0.02 1"/>
      <geom name="leg2" type="capsule" fromto="-0.12  0.12 -0.03 -0.14  0.14 -0.14" size="0.008" mass="0.05" solref="0.02 1"/>
      <geom name="leg3" type="capsule" fromto="-0.12 -0.12 -0.03 -0.14 -0.14 -0.14" size="0.008" mass="0.05" solref="0.02 1"/>
      <geom name="leg4" type="capsule" fromto=" 0.12 -0.12 -0.03  0.14 -0.14 -0.14" size="0.008" mass="0.05" solref="0.02 1"/>
    </body>
  </worldbody>
</mujoco>
"""

ROBOT_XML = """
<mujoco model="diff-drive">
  <option timestep="0.001" gravity="0 0 -9.81"/>
  <worldbody>
    <geom name="floor" type="plane" size="20 20 0.1" friction="{mu} 0.005 0.0001"/>
    <body name="chassis" pos="0 0 0.06">
      <freejoint/>
      <geom name="body" type="box" size="0.12 0.09 0.03" mass="2.0"/>
      <geom name="caster" type="sphere" pos="-0.10 0 -0.035" size="0.025" mass="0.05" friction="0.0 0.0 0.0" condim="1"/>
      <body name="wl" pos="0.04 0.11 0">
        <joint name="jl" type="hinge" axis="0 1 0" damping="0.001" armature="0.01"/>
        <geom type="cylinder" size="0.06 0.012" euler="90 0 0" mass="0.15" friction="{mu} 0.005 0.0001"/>
      </body>
      <body name="wr" pos="0.04 -0.11 0">
        <joint name="jr" type="hinge" axis="0 1 0" damping="0.001" armature="0.01"/>
        <geom type="cylinder" size="0.06 0.012" euler="90 0 0" mass="0.15" friction="{mu} 0.005 0.0001"/>
      </body>
    </body>
  </worldbody>
  <actuator>
    <velocity joint="jl" kv="{kv}"/>
    <velocity joint="jr" kv="{kv}"/>
  </actuator>
</mujoco>
"""
WHEEL_R = 0.06


def landing(v_down, seconds=1.5):
    m = mujoco.MjModel.from_xml_string(LANDING_XML)
    d = mujoco.MjData(m)
    mass = float(m.body_mass[1])
    d.qvel[2] = -v_down
    floor = mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_GEOM, "floor")
    touched_at = None
    peak = 0.0
    rest_force = []
    max_rise = 0.0
    z_touch = None
    force6 = [0.0] * 6
    import numpy as np
    f6 = np.zeros(6)
    trace = []
    while d.time < seconds:
        total = 0.0
        for i in range(d.ncon):
            c = d.contact[i]
            if floor in (c.geom1, c.geom2):
                mujoco.mj_contactForce(m, d, i, f6)
                total += f6[0]
        if total > 0 and touched_at is None:
            touched_at = d.time
            z_touch = float(d.qpos[2])
        d.xfrc_applied[1, 2] = 0.9 * mass * G if touched_at is None else 0.0
        peak = max(peak, total)
        if touched_at is not None:
            max_rise = max(max_rise, float(d.qpos[2]) - z_touch)
        if d.time > seconds - 0.2:
            rest_force.append(total)
        if len(trace) < 4000 and int(d.time / m.opt.timestep) % 20 == 0:
            trace.append([round(d.time, 4), round(float(d.qpos[2]), 5), round(total, 2)])
        mujoco.mj_step(m, d)
    w = [float(x) for x in d.qpos[3:7]]
    tilt = 2 * math.degrees(math.asin(min(1.0, math.sqrt(w[1] ** 2 + w[2] ** 2))))
    return {"v_down": v_down, "mass_kg": round(mass, 3), "touch_s": touched_at, "peak_force_n": round(peak, 1),
            "peak_over_weight": round(peak / (mass * G), 2), "bounce_m": round(max_rise, 4),
            "rest_force_n": round(sum(rest_force) / len(rest_force), 2), "weight_n": round(mass * G, 2),
            "final_tilt_deg": round(tilt, 3), "trace": trace}


def robot(mu, wheel_speed=8.0, seconds=3.0, kv=0.3):
    m = mujoco.MjModel.from_xml_string(ROBOT_XML.format(mu=mu, kv=kv))
    d = mujoco.MjData(m)
    d.ctrl[:] = wheel_speed
    jl = m.jnt_dofadr[mujoco.mj_name2id(m, mujoco.mjtObj.mjOBJ_JOINT, "jl")]
    samples = []
    while d.time < seconds:
        mujoco.mj_step(m, d)
        if int(d.time / m.opt.timestep) % 10 == 0:
            # chassis speed along its own heading (MuJoCo takes the larger friction of two touching
            # geoms, so the wheels carry the floor's friction too)
            qw, qx, qy, qz = (float(q) for q in d.qpos[3:7])
            hx, hy = 1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy + qw * qz)
            v = float(d.qvel[0]) * hx + float(d.qvel[1]) * hy
            rim = float(d.qvel[jl]) * WHEEL_R
            samples.append((d.time, v, rim))

    def slip(a, b):
        sel = [(v, rim) for t, v, rim in samples if a <= t < b]
        return sum((rim - v) / rim for v, rim in sel if abs(rim) > 1e-6) / len(sel)

    return {"mu": mu, "wheel_cmd_rad_s": wheel_speed, "slip_speeding_up": round(slip(0.05, 0.35), 4),
            "slip_steady": round(slip(seconds - 0.5, seconds), 4), "speed_end_m_s": round(samples[-1][1], 4),
            "rim_speed_end_m_s": round(samples[-1][2], 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    res = {"mujoco": mujoco.__version__,
           "landing": [landing(v) for v in (0.5, 1.0, 2.0)],
           "robot": [robot(mu) for mu in (1.0, 0.05)]}
    with open(a.out, "w") as f:
        json.dump(res, f)
    for r in res["landing"]:
        print(f"landing at {r['v_down']} m/s: peak {r['peak_force_n']} N ({r['peak_over_weight']}x weight), bounce {r['bounce_m'] * 100:.1f} cm, "
              f"at rest {r['rest_force_n']} N (weight {r['weight_n']} N), tilt {r['final_tilt_deg']} deg")
    for r in res["robot"]:
        print(f"robot on mu={r['mu']}: slip {r['slip_speeding_up'] * 100:.1f} % speeding up, {r['slip_steady'] * 100:.2f} % steady, "
              f"speed {r['speed_end_m_s']} m/s for a rim speed of {r['rim_speed_end_m_s']} m/s")


if __name__ == "__main__":
    main()
