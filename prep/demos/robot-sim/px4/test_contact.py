#!/usr/bin/env python3
"""Tests for contact.py (MuJoCo). Run with MuJoCo's Python:

    $SIM_ENGINES/mujoco/bin/python prep/demos/robot-sim/px4/test_contact.py

CONTACT_CONTROL=wheel_friction puts back a defect found while building this: the wheels kept
MuJoCo's default friction (1.0) whatever the floor's, because MuJoCo takes the larger friction of two
touching geoms. The slip test must then fail.
"""

import os
import sys
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import contact  # noqa: E402

if os.environ.get("CONTACT_CONTROL") == "wheel_friction":
    contact.ROBOT_XML = contact.ROBOT_XML.replace(' friction="{mu} 0.005 0.0001"/>\n      </body>', "/>\n      </body>")
    assert 'mass="0.15" friction' not in contact.ROBOT_XML


class Landing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runs = [contact.landing(v) for v in (0.5, 1.0, 2.0)]

    def test_at_rest_the_legs_carry_the_weight(self):
        for r in self.runs:
            self.assertAlmostEqual(r["rest_force_n"], r["weight_n"], delta=0.01 * r["weight_n"])

    def test_a_faster_descent_hits_harder(self):
        peaks = [r["peak_force_n"] for r in self.runs]
        self.assertEqual(peaks, sorted(peaks))
        self.assertGreater(peaks[0], self.runs[0]["weight_n"])

    def test_a_level_landing_stays_level(self):
        for r in self.runs:
            self.assertLess(r["final_tilt_deg"], 0.5)
            self.assertLess(r["bounce_m"], 0.01)


class Robot(unittest.TestCase):
    def test_wheels_slip_more_on_a_slippery_floor_while_speeding_up(self):
        grip, ice = contact.robot(1.0), contact.robot(0.05)
        self.assertGreater(ice["slip_speeding_up"], 3 * grip["slip_speeding_up"])
        self.assertGreater(ice["slip_speeding_up"], 0.5)


if __name__ == "__main__":
    unittest.main(verbosity=2)
