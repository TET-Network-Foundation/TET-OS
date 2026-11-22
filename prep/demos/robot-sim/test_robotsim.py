#!/usr/bin/env python3
"""Guard for the simulated robot demo (robotsim.py): each button's change to the checker's copy must
be refused by notebook.py verify, for the reason the button is named for.

    python3 prep/demos/robot-sim/test_robotsim.py     (TET_CLI=path/to/tet-cli, else target/release/tet-cli)

One log of 6 steps from the simulated robot, under a new test key, signed and checked only through
notebook.py and tet-cli (no mock of either). Step 3 cites the one-time permit. Then, in the checker's
copy (a second folder with no key):
  untouched                 -> VALID, every record "checked", and every logged value equals the
                               value the simulation produced for that step
  alter (button 1)          -> INVALID; the altered record's own signature is refused, and it is the
                               record the button names
  replay (button 2)         -> INVALID with exactly ONE problem: the new record "was already used by
                               record 3". The record is signed by the device's own key and links to
                               the record before it, so no earlier check can refuse it first.
  reorder (button 3)        -> INVALID; both swapped records' seq is refused, and no signature is
  reset                     -> VALID again
  the server answers only a 127.0.0.1 Host, and refuses a button press from another Origin.
  the 3D view (view3d.js, run by node) draws one marker per record in the checker's copy, red
                               exactly where the check refuses, the altered one where the copy puts it,
                               and its live-vs-log strip parts at that record only; moving the live
                               telemetry moves no marker. The served page carries the view inline.

The simulated drone (DroneBase): one flight up to the record after its climb above the 120 m
ceiling; its geofence exit comes earlier. In the checker's copy:
  untouched                 -> VALID; the exit record says fence=OUT, the climb record is above 120 m
  alter_alt (near miss)     -> the climb record's own signature is refused; nothing before it
  take_out (near miss)      -> the record after it is "where record N should be (a record is missing)";
                               no signature or key problem
  swap_exit (geofence)      -> both swapped records' seq; no signature or key problem
  other_key (geofence)      -> exactly: the exit record's key (not the pinned one), the next
                               record's prev, and "2 different keys" for the log; nothing else

Negative controls: controls.sh removes each button's tamper line (marked "# control:<name>") in a
copy of this folder and runs that button's test, which must then FAIL.

tet-cli is required: without it this fails, it does not skip.
"""

import http.client
import json
import os
import random
import re
import shutil
import sys
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import robotsim  # noqa: E402

STEPS, GATE = 6, 3


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.exists(robotsim.tet_cli()):
            raise AssertionError(f"tet-cli not found at {robotsim.tet_cli()}: set TET_CLI")
        cls.tmp = tempfile.mkdtemp(prefix="robotsim-test-")
        cls.demo = robotsim.Demo(os.path.join(cls.tmp, "w"), max_steps=STEPS, step_s=0.5, gate_step=GATE)
        cls.demo.init()
        for _ in range(STEPS):
            cls.demo.step()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def setUp(self):
        # Every case starts from a fresh copy of the device's log: nothing carries over between cases.
        self.demo.reset()
        self.assertIsNone(self.demo.tampered)

    def problems(self):
        c = self.demo.check
        return {r["file"]: r["reasons"] for r in c["records"] if r["reasons"]}, c["log"], c["verdict"]


class CutShort(Base):
    def test_whether_the_newest_record_is_present_is_not_judged_and_the_page_says_so(self):
        # Not judged: whether the newest record is present (the page's "does not show" list says so).
        d, n = self.demo.checker, STEPS
        for ext in (".json", ".json.sig.json"):
            os.remove(os.path.join(d, "records", f"{n}{ext}"))
        chain = robotsim.notebook.chain_lines(d)[:-1]
        with open(os.path.join(d, "chain.txt"), "w") as f:
            f.write("".join(h + "\n" for h in chain))
        self.demo.tampered = "cut"  # keep the checker from copying the record back
        self.demo.verify()
        by_seq, log, verdict = self.problems()
        self.assertEqual((verdict, by_seq, log), ("VALID", {}, []))
        self.assertEqual(self.demo.check["checked_n"], n - 1)
        # So "does not show" must say that completeness at the end is not judged.
        self.assertTrue(any("That the log is complete at its end: not judged" in s for s in robotsim.NOT_SHOWN), robotsim.NOT_SHOWN)


class OrderNotWhen(Base):
    def test_the_page_says_when_each_record_was_written_is_not_judged(self):
        # The check judges the order of the log it is given, not when each record was written. So
        # "does not show" must say so, and the sentence at the top must not claim more than the order
        # of that log.
        self.assertTrue(any("it does not judge when each record was written" in s for s in robotsim.NOT_SHOWN), robotsim.NOT_SHOWN)
        with open(os.path.join(HERE, "page.html")) as f:
            page = f.read()
        self.assertNotIn("in what order", page)
        self.assertIn("in the order of the log it is given", page)


class Untouched(Base):
    def test_untouched_log_is_valid_and_matches_the_live_data(self):
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "VALID")
        self.assertEqual((by_seq, log), ({}, []))
        rows = self.demo.check["records"]
        self.assertEqual([r["file"] for r in rows], list(range(1, STEPS + 1)))
        self.assertTrue(all(r["status"] == "checked" for r in rows))
        self.assertEqual([r["value"] for r in rows], [t["value"] for t in self.demo.live])
        self.assertEqual([r["file"] for r in rows if r["permit"]], [GATE])

    def test_the_checker_folder_holds_no_key(self):
        self.assertFalse(os.path.exists(os.path.join(self.demo.checker, "device.key")))
        self.assertTrue(os.path.exists(os.path.join(self.demo.device, "device.key")))


class FileNames(Base):
    def test_each_row_shows_the_file_verify_read_under_its_own_name(self):
        # Record 3's files renamed with a leading zero: verify lists and reads them as record 3, and
        # the row for record 3 shows that file's value.
        d = self.demo.checker
        for ext in (".json", ".json.sig.json"):
            os.rename(os.path.join(d, "records", f"3{ext}"), os.path.join(d, "records", f"03{ext}"))
        self.demo.tampered = "renamed"  # keep the checker from copying the record back
        try:
            self.demo.verify()
        except FileNotFoundError as e:
            self.fail(f"the row was read from another file name than verify read: {e.filename}")
        by_seq, log, verdict = self.problems()
        self.assertEqual((verdict, by_seq, log), ("VALID", {}, []))
        row = next(r for r in self.demo.check["records"] if r["file"] == 3)
        self.assertEqual(row["value"], self.demo.live[2]["value"])


class Alter(Base):
    def test_alter_one_value_is_refused_at_that_record(self):
        seq = self.demo.tamper_alter()
        self.demo.verify()
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertIn(seq, by_seq, by_seq)
        self.assertTrue(any(w.startswith("signature: ") and "is not the" in w for w in by_seq[seq]), by_seq[seq])
        # Records before it are untouched and still pass.
        self.assertTrue(all(s > seq for s in by_seq if s != seq), by_seq)
        row = next(r for r in self.demo.check["records"] if r["file"] == seq)
        self.assertNotEqual(row["value"], self.demo.live[seq - 1]["value"])


class Replay(Base):
    def test_a_second_use_of_the_permit_is_refused_and_nothing_else(self):
        seq = self.demo.tamper_replay()
        self.assertEqual(seq, STEPS + 1)
        self.demo.verify()
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertEqual(log, [])
        self.assertEqual(
            by_seq, {seq: [f"permit: {self.demo.permit_id} was already used by record {GATE}"]},
        )


class Reorder(Base):
    def test_two_swapped_records_are_refused_for_their_order(self):
        a = self.demo.tamper_reorder()
        self.demo.verify()
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertIn(f"seq: says {a + 1}, is record {a} in order", by_seq.get(a, []), by_seq)
        self.assertIn(f"seq: says {a}, is record {a + 1} in order", by_seq.get(a + 1, []), by_seq)
        # Each swapped record is still signed by the device: only the order is wrong.
        self.assertFalse(any(w.startswith(("signature:", "key:")) for ws in by_seq.values() for w in ws), by_seq)


class Server(Base):
    def test_only_local_host_and_origin(self):
        srv = robotsim.http.server.ThreadingHTTPServer(("127.0.0.1", 0), robotsim.make_handler(self.demo, 0))
        port = srv.server_address[1]
        srv.RequestHandlerClass = robotsim.make_handler(self.demo, port)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            self.assertEqual(srv.server_address[0], "127.0.0.1")

            def req(method, path, headers):
                c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
                c.putrequest(method, path, skip_host=True)
                for k, v in headers.items():
                    c.putheader(k, v)
                c.endheaders()
                r = c.getresponse()
                r.read()
                c.close()
                return r.status

            host = f"127.0.0.1:{port}"
            self.assertEqual(req("GET", "/state", {"Host": host}), 200)
            self.assertEqual(req("GET", "/state", {"Host": "attacker.example"}), 403)
            self.assertEqual(req("POST", "/tamper/alter", {"Host": host, "Origin": "http://attacker.example", "Content-Length": "0"}), 403)
            self.assertIsNone(self.demo.tampered)
            self.assertEqual(req("POST", "/tamper/alter", {"Host": host, "Origin": f"http://{host}", "Content-Length": "0"}), 200)
            self.assertIsNotNone(self.demo.tampered)
        finally:
            srv.shutdown()
            srv.server_close()


def view_plan(state):
    """The page's 3D view (view3d.js), asked through node what it would draw for this /state."""
    import json
    import subprocess
    node = shutil.which("node")
    if not node:
        raise AssertionError("node not found: the view test needs it, it does not skip")
    p = subprocess.run([node, os.path.join(HERE, "test_view3d.mjs"), "--plan"], input=json.dumps(state), capture_output=True, text=True, timeout=60)
    if p.returncode != 0:
        raise AssertionError(p.stderr[-500:])
    return json.loads(p.stdout)


class View(Base):
    def test_the_view_draws_the_records_the_checker_read(self):
        # A real log, signed and checked by notebook.py and tet-cli; one value altered in the copy.
        seq = self.demo.tamper_alter()
        self.demo.verify()
        by_seq, _, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        st = self.demo.state()
        p = view_plan(st)
        # One marker per record in the checker's copy; red exactly where the check refuses.
        self.assertEqual([m["file"] for m in p["markers"]], list(range(1, STEPS + 1)))
        self.assertEqual({m["file"] for m in p["markers"] if m["refused"]}, set(by_seq))
        # The altered marker sits where the copy says, 0.5 m from where the simulation was.
        m = next(m for m in p["markers"] if m["file"] == seq)
        self.assertAlmostEqual(m["x"], self.demo.live[seq - 1]["x"] + 0.5, places=6)
        # The strip's two lines part at that record and nowhere else.
        self.assertEqual(p["parted"], [seq])
        # Shift the live telemetry: the markers and the signed-log line stay where the records put them.
        moved = dict(st, live=[dict(t, x=t["x"] + 1.0, y=t["y"] + 1.0) for t in st["live"]])
        q = view_plan(moved)
        self.assertEqual((q["markers"], q["stripLog"]), (p["markers"], p["stripLog"]))

    def test_the_page_carries_the_view_and_loads_nothing_else(self):
        with open(os.path.join(HERE, "page.html"), "rb") as f:
            raw = f.read()
        self.assertIn(b"/*VIEW3D*/", raw)
        # The server inlines view3d.js into the page it serves.
        srv = robotsim.http.server.ThreadingHTTPServer(("127.0.0.1", 0), robotsim.make_handler(self.demo, 0))
        port = srv.server_address[1]
        srv.RequestHandlerClass = robotsim.make_handler(self.demo, port)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
            c.request("GET", "/", headers={"Host": f"127.0.0.1:{port}"})
            served = c.getresponse().read()
            c.close()
        finally:
            srv.shutdown()
            srv.server_close()
        self.assertNotIn(b"/*VIEW3D*/", served)
        self.assertIn(b"root.View3D = ", served)
        self.assertNotIn(b"<script src", served)
        self.assertIn(b'class="banner">SIMULATION<', served)

    def test_the_served_page_names_its_run_seed_versions_and_commit(self):
        # The status bar and the "how to cite this run" line read META, which the server fills in when
        # it serves the page. The page file holds only the placeholder.
        with open(os.path.join(HERE, "page.html"), "rb") as f:
            self.assertIn(b"/*META*/null", f.read())
        srv = robotsim.http.server.ThreadingHTTPServer(("127.0.0.1", 0), robotsim.make_handler(self.demo, 0))
        port = srv.server_address[1]
        srv.RequestHandlerClass = robotsim.make_handler(self.demo, port)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=30)
            c.request("GET", "/", headers={"Host": f"127.0.0.1:{port}"})
            served = c.getresponse().read().decode()
            c.close()
        finally:
            srv.shutdown()
            srv.server_close()
        m = re.search(r"const META = (\{.*?\});</script>", served)
        self.assertIsNotNone(m, "the served page carries no run details")
        meta = json.loads(m.group(1))
        # the seed shown is the one the robot's simulator really runs with: same first draw
        self.assertEqual(list(meta["seeds"]), ["robot"])
        self.assertEqual(random.Random(meta["seeds"]["robot"]).random(), robotsim.Sim(step_s=0.5).rng.random())
        self.assertRegex(meta["run_id"], r"^\d{8}-\d{6}-[0-9a-f]{6}$")
        self.assertRegex(meta["tet_cli"] or "", r"^\d+\.\d+")
        self.assertTrue(meta["commit"])
        self.assertTrue(meta["python"])
# ── the simulated drone: the two scenarios that survived CASES.md ──────────────────────────────────


class DroneBase(Base):
    """One flight of the simulated drone, run until the checker can hold the record after the climb
    (about 30 steps; bounded at 80). The exit over the geofence comes first, then the climb."""

    @classmethod
    def setUpClass(cls):
        if not os.path.exists(robotsim.tet_cli()):
            raise AssertionError(f"tet-cli not found at {robotsim.tet_cli()}: set TET_CLI")
        cls.tmp = tempfile.mkdtemp(prefix="robotsim-drone-test-")
        cls.demo = robotsim.Demo(os.path.join(cls.tmp, "w"), max_steps=80, step_s=0.5, vehicle="drone")
        cls.demo.init()
        while "climb" not in cls.demo.marks or len(cls.demo.live) < cls.demo.marks["climb"] + 1:
            if cls.demo.finished():
                raise AssertionError("the simulated drone never climbed above the ceiling")
            cls.demo.step()
        cls.exit, cls.climb = cls.demo.marks["exit"], cls.demo.marks["climb"]

    def no_sig_or_key_problem(self, by_seq):
        self.assertFalse(any(w.startswith(("signature:", "key:")) for ws in by_seq.values() for w in ws), by_seq)


class DroneUntouched(DroneBase):
    def test_the_flight_log_is_valid_and_shows_the_exit_and_the_climb(self):
        by_seq, log, verdict = self.problems()
        self.assertEqual((verdict, by_seq, log), ("VALID", {}, []))
        rows = self.demo.check["records"]
        self.assertEqual([r["value"] for r in rows], [t["value"] for t in self.demo.live])
        self.assertLess(self.exit, self.climb)
        self.assertIn("fence=OUT", rows[self.exit - 1]["value"])
        self.assertGreater(self.demo.live[self.climb - 1]["alt"], robotsim.DroneSim.CEILING)
        self.assertEqual(rows[0]["value"].split()[0], "phase=takeoff")


class DroneAlterAlt(DroneBase):
    def test_lowering_the_climb_altitude_is_refused_at_that_record(self):
        seq = self.demo.tamper_alter_alt("climb")
        self.assertEqual(seq, self.climb)
        self.demo.verify()
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertTrue(any(w.startswith("signature: ") and "is not the" in w for w in by_seq.get(seq, [])), by_seq)
        self.assertTrue(all(s >= seq for s in by_seq), by_seq)
        self.assertIn("alt=118.0", self.demo.check["records"][seq - 1]["value"])


class DroneTakeOut(DroneBase):
    def test_taking_the_climb_record_out_is_refused_as_a_missing_record(self):
        seq = self.demo.tamper_take_out("climb")
        self.demo.verify()
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertNotIn(seq, [r["file"] for r in self.demo.check["records"]])
        self.assertEqual(min(by_seq), seq + 1, by_seq)
        self.assertIn(f"seq: file {seq + 1}.json where record {seq} should be (a record is missing)", by_seq[seq + 1], by_seq)
        self.no_sig_or_key_problem(by_seq)


class DroneSwapExit(DroneBase):
    def test_swapping_the_exit_record_is_refused_for_its_order(self):
        a = self.demo.tamper_swap_exit("exit")
        self.assertEqual(a, self.exit)
        self.demo.verify()
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertIn(f"seq: says {a + 1}, is record {a} in order", by_seq.get(a, []), by_seq)
        self.assertIn(f"seq: says {a}, is record {a + 1} in order", by_seq.get(a + 1, []), by_seq)
        self.no_sig_or_key_problem(by_seq)


class DroneOtherKey(DroneBase):
    def test_an_exit_record_signed_by_another_key_is_refused_for_its_key(self):
        seq = self.demo.tamper_other_key("exit")
        self.assertEqual(seq, self.exit)
        self.demo.verify()
        by_seq, log, verdict = self.problems()
        with open(os.path.join(self.demo.other, "device.keyid")) as f:
            other = f.read().strip()
        with open(self.demo.pin) as f:
            pinned = f.read().split()[0]
        self.assertNotEqual(other, pinned)
        self.assertEqual(verdict, "INVALID")
        # The log as a whole now carries two signers.
        self.assertEqual(log, ["key: 2 different keys signed this log"])
        # Its envelope verifies and it links to the record before it: only the pin refuses it. The record
        # after it still names the replaced record's hash, so its prev is refused too, and nothing else.
        self.assertEqual(by_seq, {
            seq: [f"key: signed by {other}, not this device's {pinned}"],
            seq + 1: ["prev: does not name the record before it"],
        })
        self.assertIn("fence=in", self.demo.check["records"][seq - 1]["value"])



# ── machines that are not vehicles: the two cases that survived CASES-2.md ─────────────────────────


class MachineBase(Base):
    """One run of a non-vehicle machine, until the checker can hold two records after the last mark."""
    VEHICLE, MARKS, MAX = None, (), 0

    @classmethod
    def setUpClass(cls):
        if not os.path.exists(robotsim.tet_cli()):
            raise AssertionError(f"tet-cli not found at {robotsim.tet_cli()}: set TET_CLI")
        cls.tmp = tempfile.mkdtemp(prefix=f"robotsim-{cls.VEHICLE}-test-")
        cls.demo = robotsim.Demo(os.path.join(cls.tmp, "w"), max_steps=cls.MAX, step_s=0.5, vehicle=cls.VEHICLE)
        cls.demo.init()
        while not all(m in cls.demo.marks for m in cls.MARKS) or len(cls.demo.live) < max(cls.demo.marks.values()) + 2:
            if cls.demo.finished():
                raise AssertionError(f"the simulated {cls.VEHICLE} never reached {cls.MARKS}")
            cls.demo.step()

    def no_sig_or_key_problem(self, by_seq):
        self.assertFalse(any(w.startswith(("signature:", "key:")) for ws in by_seq.values() for w in ws), by_seq)

    def press(self, name, target):
        """Press a page button through the real server, as the page does."""
        srv = robotsim.http.server.ThreadingHTTPServer(("127.0.0.1", 0), robotsim.make_handler({self.VEHICLE: self.demo}, 0))
        port = srv.server_address[1]
        srv.RequestHandlerClass = robotsim.make_handler({self.VEHICLE: self.demo}, port)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        try:
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=60)
            c.request("POST", f"/tamper/{name}?v={self.VEHICLE}&t={target}", headers={"Host": f"127.0.0.1:{port}", "Content-Length": "0"})
            r = c.getresponse()
            body = json.loads(r.read())
            c.close()
        finally:
            srv.shutdown()
            srv.server_close()
        self.assertEqual(r.status, 200, body)
        return body["seq"]


class ColdBase(MachineBase):
    VEHICLE, MARKS, MAX = "coldchain", ("door", "peak"), 48


class ColdUntouched(ColdBase):
    def test_the_journey_log_is_valid_and_shows_the_excursion_with_records_after_it(self):
        by_seq, log, verdict = self.problems()
        self.assertEqual((verdict, by_seq, log), ("VALID", {}, []))
        rows = self.demo.check["records"]
        self.assertEqual([r["value"] for r in rows], [t["value"] for t in self.demo.live])
        door, peak = self.demo.marks["door"], self.demo.marks["peak"]
        self.assertLessEqual(door, peak)
        self.assertIn("door=open", rows[door - 1]["value"])
        self.assertGreater(self.demo.live[peak - 1]["temp"], robotsim.ColdChainSim.LIMIT)
        # The changed record always has a record after it: the demo does not claim to catch a cut at the end.
        self.assertGreater(len(rows), peak)


class ColdLowerPeak(ColdBase):
    def test_lowering_the_peak_temperature_is_refused_at_that_record(self):
        seq = self.press("lower_peak", "peak")
        self.assertEqual(seq, self.demo.marks["peak"])
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertTrue(any(w.startswith("signature: ") and "is not the" in w for w in by_seq.get(seq, [])), by_seq)
        self.assertTrue(all(s >= seq for s in by_seq), by_seq)
        self.assertIn("temp=7.80", self.demo.check["records"][seq - 1]["value"])


class ColdTakePeak(ColdBase):
    def test_taking_the_peak_record_out_is_refused_as_a_missing_record(self):
        seq = self.press("take_peak", "peak")
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertNotIn(seq, [r["file"] for r in self.demo.check["records"]])
        self.assertEqual(min(by_seq), seq + 1, by_seq)
        self.assertIn(f"seq: file {seq + 1}.json where record {seq} should be (a record is missing)", by_seq[seq + 1], by_seq)
        self.no_sig_or_key_problem(by_seq)


class ColdHideDoor(ColdBase):
    def test_swapping_the_door_record_is_refused_for_its_order(self):
        a = self.press("hide_door", "door")
        self.assertEqual(a, self.demo.marks["door"])
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertIn(f"seq: says {a + 1}, is record {a} in order", by_seq.get(a, []), by_seq)
        self.assertIn(f"seq: says {a}, is record {a + 1} in order", by_seq.get(a + 1, []), by_seq)
        self.no_sig_or_key_problem(by_seq)


class LabBase(MachineBase):
    VEHICLE, MARKS, MAX = "lab", ("outlier",), 25


class LabUntouched(LabBase):
    def test_the_run_is_valid_and_its_outlier_stands_above_both_neighbours(self):
        by_seq, log, verdict = self.problems()
        self.assertEqual((verdict, by_seq, log), ("VALID", {}, []))
        rows = self.demo.check["records"]
        self.assertEqual([r["value"] for r in rows], [t["value"] for t in self.demo.live])
        o = self.demo.marks["outlier"]
        od = [t["od600"] for t in self.demo.live]
        self.assertGreater(od[o - 1], max(od[o - 2], od[o]))
        self.assertNotIn("bubble", rows[o - 1]["value"])  # the instrument does not know about the bubble
        self.assertGreater(len(rows), o)


class LabDropOutlier(LabBase):
    def test_taking_the_outlier_out_is_refused_as_a_missing_record(self):
        seq = self.press("drop_outlier", "outlier")
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertNotIn(seq, [r["file"] for r in self.demo.check["records"]])
        self.assertIn(f"seq: file {seq + 1}.json where record {seq} should be (a record is missing)", by_seq.get(seq + 1, []), by_seq)
        self.no_sig_or_key_problem(by_seq)


class LabSmoothRead(LabBase):
    def test_smoothing_the_outlier_is_refused_at_that_record(self):
        seq = self.press("smooth_read", "outlier")
        self.assertEqual(seq, self.demo.marks["outlier"])
        by_seq, log, verdict = self.problems()
        self.assertEqual(verdict, "INVALID")
        self.assertTrue(any(w.startswith("signature: ") and "is not the" in w for w in by_seq.get(seq, [])), by_seq)
        self.assertTrue(all(s >= seq for s in by_seq), by_seq)
        mean = (self.demo.live[seq - 2]["od600"] + self.demo.live[seq]["od600"]) / 2
        self.assertIn(f"od600={mean:.3f}", self.demo.check["records"][seq - 1]["value"])


class Scenarios(unittest.TestCase):
    def test_every_scenario_is_tagged_has_its_three_boxes_and_buttons_that_exist(self):
        tags = {"today", "about 3 years", "about 10 years: a forecast, not a fact", "about 20 years: a forecast, not a fact"}
        for sc in robotsim.SCENARIOS:
            self.assertIn(sc["horizon"], tags, sc["id"])
            for k in ("fits", "changes", "differs"):
                self.assertTrue(sc[k].strip(), (sc["id"], k))
            self.assertIn(sc["vehicle"], robotsim.VEHICLES)
            for b, _ in sc["buttons"]:
                name, _, target = b.partition(":")
                self.assertIn(name, robotsim.TAMPERS)
                self.assertTrue(hasattr(robotsim.Demo, robotsim.TAMPERS[name]))
                if target:
                    self.assertIn(target, robotsim.TARGETS)
        # At least one of the two new machines is a future one, and says so in its story.
        new = [sc for sc in robotsim.SCENARIOS if sc["vehicle"] in ("coldchain", "lab")]
        self.assertEqual(len(new), 2)
        fut = [sc for sc in new if sc["horizon"] != "today"]
        self.assertTrue(fut)
        self.assertTrue(all(sc["story"].startswith("A forecast, not a fact") for sc in fut))

    def test_the_new_machines_say_what_their_case_does_not_show(self):
        by = {sc["vehicle"]: " ".join(sc["not_shown"]) for sc in robotsim.SCENARIOS if sc["vehicle"] in ("coldchain", "lab")}
        for v, text in by.items():
            self.assertIn("That the log is complete at its end: not judged", text, v)
            self.assertIn("it does not judge which machine held that key", text, v)
            self.assertIn("no real logger, instrument or sensor", text, v)
        self.assertIn("the log shows order, not time", by["coldchain"])
        self.assertIn("whether the run handed on was the only one made", by["lab"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
