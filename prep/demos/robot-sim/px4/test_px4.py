#!/usr/bin/env python3
"""Tests for the chunk-signed ULog: the reader, the signed flight, and the two kept cases.

Needs a tet-cli build (TET_CLI=..., or target/release/tet-cli in the repository). Signs for a demo
chain, contacts nothing. Run:  TET_CLI=... python3 prep/demos/robot-sim/px4/test_px4.py

PX4DEMO_CONTROL=<name> removes one tamper step (see controls.py); the test named for it must then
fail on its assertion.
"""

import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import demo  # noqa: E402
import flight  # noqa: E402
import ulog  # noqa: E402
import ulogsign  # noqa: E402
sys.path.insert(0, os.path.dirname(HERE))
import copy_cases as C  # noqa: E402

CONTROL = os.environ.get("PX4DEMO_CONTROL", "")
CHAIN = {"TET_CHAIN_ID": "tet-robot-sim-demo", "TET_GENESIS_HASH": hashlib.sha256(b"robot-sim demo chain").hexdigest()}
PX4_SAMPLE = os.environ.get("PX4_SAMPLE_ULOG", "")  # PX4-Autopilot: src/lib/ulog_cpp/test/log_files/sample_log_small.ulg
# A ULog that PX4 SITL itself wrote while flying fly_px4.py's mission (about 45 MB, not committed).
# The tests on the whole log run only where it is given; they are skipped otherwise, and in CI.
PX4_REAL = os.environ.get("PX4_REAL_ULOG", "")
# A small excerpt of that same log, committed (excerpt.py cut it: header and every non-data message
# kept, data of the two replayed topics one in 60, every message byte for byte). Runs everywhere, CI
# included, so a real PX4 log is checked on every run.
PX4_EXCERPT = os.path.join(HERE, "fixtures", "px4-sitl-excerpt.ulg")
PX4_EXCERPT_SHA256 = "d06bf371deb96eddda0956aedd95db09c8c73b48062ff19588e8649a473422c9"


class _Signed:
    """The checks every signed log must pass, whoever wrote it. A subclass says where the log comes
    from (source_bytes)."""

    @classmethod
    def source_bytes(cls):
        raise NotImplementedError

    @classmethod
    def setUpClass(cls):
        os.environ.update(CHAIN)
        cls.tmp = tempfile.mkdtemp(prefix="px4demo-")
        cls.ulg = os.path.join(cls.tmp, "flight.ulg")
        with open(cls.ulg, "wb") as f:
            f.write(cls.source_bytes())
        cls.device = os.path.join(cls.tmp, "device")
        rc, out, err = ulogsign.notebook(["init", "--dir", cls.device])
        if rc != 0:
            raise RuntimeError(f"notebook init failed (exit {rc}); is TET_CLI set? {err.strip()[-200:]}")
        cls.pin = os.path.join(cls.tmp, "device.pin")  # kept outside both folders
        shutil.copyfile(os.path.join(cls.device, "device.pin"), cls.pin)
        r = subprocess.run([sys.executable, os.path.join(HERE, "ulogsign.py"), "sign", "--ulog", cls.ulg, "--dir", cls.device],
                           capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(r.stderr[-300:])
        with open(cls.ulg, "rb") as f:
            cls.log = ulog.ULog(f.read())
        cls.track = flight.track(cls.log)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def checker(self):
        """A fresh second folder: the records and the file, no key."""
        d = tempfile.mkdtemp(dir=self.tmp, prefix="checker-")
        os.makedirs(os.path.join(d, "records"))
        for n in ("chain.json", "chain.txt"):
            shutil.copyfile(os.path.join(self.device, n), os.path.join(d, n))
        for n in os.listdir(os.path.join(self.device, "records")):
            shutil.copyfile(os.path.join(self.device, "records", n), os.path.join(d, "records", n))
        shutil.copyfile(self.ulg, os.path.join(d, "flight.ulg"))
        return d, os.path.join(d, "flight.ulg")

    def chunk_of(self, res, off):
        return next(r["i"] for r in res["chunks"] if r["off"] <= off < r["off"] + r["len"])

    def test_the_signed_flight_checks_valid_in_a_folder_with_no_key(self):
        d, copy = self.checker()
        self.assertFalse(os.path.exists(os.path.join(d, "device.key")))
        res = ulogsign.check(copy, d, self.pin)
        self.assertEqual(res["verdict"], "VALID", res["file"] + [r for r in res["chunks"] if r["reasons"]])
        self.assertGreater(len(res["chunks"]), 100)
        self.assertEqual(sum(r["len"] for r in res["chunks"]), os.path.getsize(copy))

    def test_near_miss_altitude_lowered_is_refused_on_its_chunk_and_nowhere_else(self):
        d, copy = self.checker()
        peak = max(self.track, key=lambda p: p["alt"])
        self.assertGreater(peak["alt"], flight.CEILING_M)
        if CONTROL != "near_miss":
            self.assertEqual(demo.tamper_near_miss(copy), [peak["off"]])  # control:near_miss (the page's button)
            # the copy now says 118 m at that sample: the tamper changed the altitude, not another field
            with open(copy, "rb") as f:
                moved = {p["off"]: p for p in flight.track(ulog.ULog(f.read()))}
            self.assertAlmostEqual(moved[peak["off"]]["alt"], 118.0, places=3)
        res = ulogsign.check(copy, d, self.pin)
        refused = {r["i"]: r["reasons"] for r in res["chunks"] if r["status"] == "refused"}
        self.assertEqual(res["verdict"], "INVALID")
        self.assertEqual(refused, {self.chunk_of(res, peak["off"]): ["sha256: the file's bytes in this range are not the signed ones"]})
        self.assertEqual(res["file"], [])

    def test_geofence_exit_moved_inside_is_refused_on_the_chunks_that_held_it(self):
        d, copy = self.checker()
        outside = [p for p in self.track if p["y"] < flight.FENCE["y_min"]]
        self.assertGreater(len(outside), 10)
        if CONTROL != "geofence":
            self.assertEqual(demo.tamper_geofence(copy), [p["off"] for p in outside])  # control:geofence (the page's button)
            with open(copy, "rb") as f:
                moved = {p["off"]: p for p in flight.track(ulog.ULog(f.read()))}
            self.assertEqual({round(moved[p["off"]]["y"], 3) for p in outside}, {flight.FENCE["y_min"] + 1.0})
        res = ulogsign.check(copy, d, self.pin)
        refused = {r["i"]: r["reasons"] for r in res["chunks"] if r["status"] == "refused"}
        want = {self.chunk_of(res, p["off"]) for p in outside}
        self.assertEqual(res["verdict"], "INVALID")
        self.assertEqual(set(refused), want)
        for reasons in refused.values():
            self.assertEqual(reasons, ["sha256: the file's bytes in this range are not the signed ones"])
        # the replay draws the moved samples as refused, not as checked
        self.assertTrue(all(not p["checked"] for p in res["track"] if p["chunk"] in want))

    def test_a_changed_format_marks_every_sample_unchecked(self):
        """The formats in chunk 0 decode every later sample. Reordering x, y and z there must not leave later samples shown as checked."""
        d, copy = self.checker()
        with open(copy, "rb") as f:
            buf = f.read()
        old = b"float x;float y;float z;"
        fmt = [(off, body) for off, t, body in ulog.messages(buf) if t == "F" and body.startswith(b"vehicle_local_position:")]
        self.assertEqual(len(fmt), 1)
        at = fmt[0][0] + 3 + fmt[0][1].index(old)
        with open(copy, "wb") as f:
            f.write(buf[:at] + b"float z;float y;float x;" + buf[at + len(old):])  # control:decoding (in ulogsign)
        res = ulogsign.check(copy, d, self.pin)
        refused = {r["i"] for r in res["chunks"] if r["status"] == "refused"}
        self.assertEqual(refused, {0})
        self.assertEqual(len(res["track"]), len(self.track))
        self.assertEqual([p for p in res["track"] if p["checked"]], [])

    def test_bytes_added_after_the_last_signed_chunk_are_named(self):
        d, copy = self.checker()
        size = os.path.getsize(copy)
        if CONTROL != "appended":
            with open(copy, "ab") as f:
                f.write(struct.pack("<HB", 9, ord("L")) + b"6" + struct.pack("<Q", 0))  # control:appended
        res = ulogsign.check(copy, d, self.pin)
        self.assertEqual(res["verdict"], "INVALID")
        self.assertEqual(res["file"], [f"file: 12 bytes after byte {size} are in no signed chunk"])

    def test_a_record_file_verify_does_not_read_is_not_read_here(self):
        """A file in records/ that verify does not list must not count as a signed chunk: bytes
        appended after the last chunk stay named, and the verdict INVALID."""
        d, copy = self.checker()
        size = os.path.getsize(copy)
        extra = struct.pack("<HB", 9, ord("L")) + b"6" + struct.pack("<Q", 0)
        with open(copy, "ab") as f:
            f.write(extra)
        n = len(os.listdir(os.path.join(d, "records"))) // 2 + 1
        name = f"{n}.json.unread"
        line = f"ulog-chunk {n - 1} off={size} len={len(extra)} t0=0 t1=0 sha256={hashlib.sha256(extra).hexdigest()}"
        with open(os.path.join(d, "records", name), "w") as f:
            json.dump({"reading": {"value": line}}, f)
        res = ulogsign.check(copy, d, self.pin)
        self.assertEqual(res["file"], [f"file: {len(extra)} bytes after byte {size} are in no signed chunk"])
        self.assertEqual(res["verdict"], "INVALID")

    def test_a_record_rewritten_after_verify_read_it_is_not_what_the_checker_reads(self):
        """One byte of chunk 1 changed in the file; right after the real verify returns, chunk 1's
        record in the folder handed to the checker is rewritten (unsigned) to name the changed bytes.
        The checker reads the record verify read, so the chunk is refused on its hash."""
        d, copy = self.checker()
        with open(os.path.join(d, "records", "2.json"), "rb") as f:
            rec = json.loads(f.read())
        m = ulogsign.LINE.fullmatch(rec["reading"]["value"])
        off, n = int(m.group(2)), int(m.group(3))
        with open(copy, "rb") as f:
            buf = bytearray(f.read())
        buf[off + n // 2] ^= 0xFF
        with open(copy, "wb") as f:
            f.write(buf)
        rec["reading"]["value"] = rec["reading"]["value"][:-64] + hashlib.sha256(bytes(buf[off:off + n])).hexdigest()
        real = ulogsign.notebook

        def late_writer(args, stdin=None):
            r = real(args, stdin)
            if args[0] == "verify":
                with open(os.path.join(d, "records", "2.json"), "w") as f:
                    json.dump(rec, f, sort_keys=True, separators=(",", ":"))
            return r

        ulogsign.notebook = late_writer
        self.addCleanup(setattr, ulogsign, "notebook", real)
        res = ulogsign.check(copy, d, self.pin)
        ulogsign.notebook = real
        row = next(r for r in res["chunks"] if r["record"] == 2)
        self.assertEqual((row["status"], row["reasons"]), ("refused", ["sha256: the file's bytes in this range are not the signed ones"]))
        self.assertEqual(res["verdict"], "INVALID")

    def test_a_pin_inside_the_folder_handed_in_is_refused(self):
        d, copy = self.checker()
        inside = os.path.join(d, "device.pin")
        shutil.copyfile(self.pin, inside)
        res = ulogsign.check(copy, d, inside)
        self.assertEqual((res["verdict"], res["chunks"]),
                         ("ERROR", []))
        self.assertEqual(res["file"], [f"pin: --pin {inside} is inside the folder being checked; give a copy kept outside it"])

    def test_a_folder_at_a_record_name_is_refused_not_a_crash(self):
        d, copy = self.checker()
        n = len([x for x in os.listdir(os.path.join(d, "records")) if x.endswith(".json") and not x.endswith(".sig.json")]) + 1
        os.mkdir(os.path.join(d, "records", f"{n}.json"))
        try:
            res = ulogsign.check(copy, d, self.pin)
        except OSError as e:
            self.fail(f"the checker stopped on a record name that is not a file: {e.strerror}")
        self.assertEqual(res["verdict"], "INVALID")
        row = next(r for r in res["chunks"] if r["record"] == n)
        self.assertEqual((row["status"], row["reasons"][-1]), ("refused", "record: not a ulog-chunk line"))

    def test_samples_in_a_chunk_whose_framing_moved_are_not_shown_checked(self):
        """The rows say every chunk is checked, but one chunk no longer starts where a message starts
        (as when a changed byte before it moved the file's framing). Its samples must not be shown as
        checked; the samples of the chunks around it still are."""
        d, copy = self.checker()
        res = ulogsign.check(copy, d, self.pin)
        with open(copy, "rb") as f:
            buf = f.read()
        rows = [dict(r) for r in res["chunks"]]
        # a chunk in the middle, away from chunk 0, which holds the formats
        k = next(i for i, r in enumerate(rows) if i >= len(rows) // 2 and any(p["chunk"] == r["i"] for p in res["track"]))
        rows[k - 1]["len"] += 1
        rows[k]["off"] += 1
        rows[k]["len"] -= 1
        track = ulogsign.replay_track(buf, rows)
        moved = [p for p in track if p["chunk"] == rows[k]["i"]]
        self.assertTrue(moved)
        self.assertEqual([p for p in moved if p["checked"]], [])
        self.assertTrue(any(p["checked"] for p in track if p["chunk"] not in (rows[k - 1]["i"], rows[k]["i"])))

    def forged_attitude(self, buf, appended):
        """A sample in a later checked chunk, and an attitude message carrying that sample's
        timestamp and a different q: written over an attitude message of an earlier chunk (that chunk
        is then refused), or appended after the last chunk (no signed byte changed)."""
        log = ulog.ULog(bytes(buf))
        res = ulogsign.check(self.ulg, self.checker()[0], self.pin)
        signed_q = {p["off"]: p["q"] for p in res["track"]}
        att = list(log.data("vehicle_attitude"))
        pos = list(log.data("vehicle_local_position"))
        # an earlier chunk holding no format or subscription (refusing one of those unchecks all)
        decoding = {self.chunk_of(res, o) for o, t, _ in log.msgs if t in ulogsign.DECODING}
        a_off, _ = next((o, d) for o, d in att if self.chunk_of(res, o) not in decoding)
        p_off, p = next((o, d) for o, d in reversed(pos) if self.chunk_of(res, o) > self.chunk_of(res, a_off) + 1)
        # q0 = 2 is no attitude at all, so it differs from the signed one, and an attitude message with
        # the sample's own timestamp sorts after it, so this test fails if the sample takes it
        forged = [2.0, 0.0, 0.0, 0.0]
        qoff = log.field_offset("vehicle_attitude", "q")
        msg = bytearray(buf[a_off:a_off + 3 + struct.unpack_from("<H", buf, a_off)[0]])
        struct.pack_into("<Q", msg, 5, p["timestamp"])
        struct.pack_into("<4f", msg, qoff, *forged)
        if appended:
            buf += msg
        else:
            buf[a_off:a_off + len(msg)] = msg
        return p_off, signed_q[p_off], forged

    def assert_attitude_from_checked_chunks(self, appended):
        d, copy = self.checker()
        with open(copy, "rb") as f:
            buf = bytearray(f.read())
        p_off, signed, forged = self.forged_attitude(buf, appended)
        with open(copy, "wb") as f:
            f.write(buf)
        res = ulogsign.check(copy, d, self.pin)
        self.assertEqual(res["verdict"], "INVALID")
        s = next(p for p in res["track"] if p["off"] == p_off)
        self.assertTrue(s["checked"], "the sample's own chunk is intact")
        self.assertNotEqual([round(v, 4) for v in s["q"]], [round(v, 4) for v in forged])
        self.assertEqual(s["q"], signed)

    def test_a_checked_sample_takes_no_attitude_from_a_refused_chunk(self):
        self.assert_attitude_from_checked_chunks(appended=False)

    def test_a_checked_sample_takes_no_attitude_from_bytes_after_the_last_chunk(self):
        self.assert_attitude_from_checked_chunks(appended=True)

    def test_whether_the_last_chunk_is_present_is_not_judged(self):
        """Not a defence: pins the stated scope (its 'does not show' list: the last chunk being present)."""
        d, copy = self.checker()
        res = ulogsign.check(copy, d, self.pin)
        last = res["chunks"][-1]
        with open(copy, "r+b") as f:
            f.truncate(last["off"])
        os.remove(os.path.join(d, "records", f"{last['record']}.json"))
        os.remove(os.path.join(d, "records", f"{last['record']}.json.sig.json"))
        with open(os.path.join(d, "chain.txt")) as f:
            lines = f.readlines()
        with open(os.path.join(d, "chain.txt"), "w") as f:
            f.writelines(lines[:-1])
        self.assertEqual(ulogsign.check(copy, d, self.pin)["verdict"], "VALID")


class SignedFlight(_Signed, unittest.TestCase):
    """flight.py's stand-in log (not written by PX4): runs everywhere, CI included."""

    @classmethod
    def source_bytes(cls):
        return flight.write(flight.fly(7))

    def test_replay_from_the_checked_folder_alone_matches_the_flight(self):
        d, copy = self.checker()
        res = ulogsign.check(copy, d, self.pin)
        frames = flight.fly(7)
        self.assertEqual(len(res["track"]), len(frames))
        for p, f in zip(res["track"], frames):
            self.assertTrue(p["checked"])
            self.assertAlmostEqual(p["alt"], f["alt"], places=3)
            self.assertAlmostEqual(p["y"], f["y"], places=3)


    def guard_base(self, chunks=3):
        """The log's first `chunks` signed chunks and their records, and the file cut after them: a
        short log that verify and the checker find VALID (whether the last chunks are present is
        not judged), so that each generated folder is checked quickly."""
        d, ulg = self.checker()
        res = ulogsign.check(ulg, d, self.pin)
        keep = res["chunks"][:chunks]
        seqs = {r["record"] for r in keep}
        rec = os.path.join(d, "records")
        for name in os.listdir(rec):
            if int(name.split(".")[0]) not in seqs:
                os.remove(os.path.join(rec, name))
        with open(os.path.join(d, "chain.txt")) as f:
            lines = f.readlines()
        with open(os.path.join(d, "chain.txt"), "w") as f:
            f.writelines(lines[:len(seqs)])
        cut = os.path.join(self.tmp, f"guard-{len(os.listdir(self.tmp))}.ulg")
        with open(ulg, "rb") as f:
            body = f.read(keep[-1]["off"] + keep[-1]["len"])
        with open(cut, "wb") as f:
            f.write(body)
        self.assertEqual(ulogsign.check(cut, d, self.pin)["verdict"], "VALID")
        return d, cut

    def test_a_folder_the_checker_finds_valid_is_valid_to_verify_on_the_folder_handed_in_with_the_same_record_bytes(self):
        # Over every generated folder (copy_cases.py): when the checker says VALID, notebook.py verify
        # on the folder handed in says VALID, and the record files the checker read hold the bytes
        # verify read there. The honest folder must come out VALID, so the guard is not vacuous.
        base, ulg = self.guard_base()
        pin = self.pin
        real, seen = ulogsign.check_copy, {}

        def spy(*a):
            seen.clear()
            seen.update(C.record_bytes(a[1]))
            return real(*a)

        n, valid = 0, []
        with mock.patch.object(ulogsign, "check_copy", spy):
            for label, handed in C.generate(base, os.path.join(self.tmp, "cases"), top=("chain.json", "chain.txt", "records", "flight.ulg"), sub=("records",),
                                            record="records/1.json"):
                n += 1
                seen.clear()
                if ulogsign.check(ulg, handed, pin)["verdict"] != "VALID":
                    continue
                valid.append(label)
                rc, out, err = ulogsign.notebook(["verify", "--dir", handed, "--pin", pin])
                self.assertEqual(out.split()[:1], ["VALID"], label)
                self.assertEqual(seen, C.record_bytes(handed), label)
                self.assertTrue(seen, label)
        sys.stderr.write(f"\n  generated folders: {n}; checker VALID on {len(valid)}: {valid}\n")
        self.assertIn("the honest folder", valid)
        self.assertGreaterEqual(n, 90)

class _PX4Written(_Signed):
    """What a log PX4 wrote holds, on top of the checks every signed log must pass."""

    def test_header_names_px4_sitl_and_the_log_holds_both_kept_cases(self):
        self.assertEqual(self.log.info.get("sys_name"), b"PX4")
        self.assertEqual(self.log.info.get("ver_hw"), b"PX4_SITL")
        self.assertGreater(max(p["alt"] for p in self.track), flight.CEILING_M)
        self.assertGreater(sum(p["y"] < flight.FENCE["y_min"] for p in self.track), 10)
        d, copy = self.checker()
        res = ulogsign.check(copy, d, self.pin)
        self.assertEqual(demo.source_of(copy, res),
                         "the PX4 autopilot flying a simulated vehicle (PX4 SITL; sys_name PX4, ver_hw PX4_SITL)")
        # PX4 orders fields by size, so y and z are not where the stand-in puts them; the tampers
        # read their places from the file's own format
        self.assertNotEqual(self.log.field_offset("vehicle_local_position", "z"), 3 + 2 + 8 + 8)


@unittest.skipUnless(PX4_REAL and os.path.exists(PX4_REAL), "PX4_REAL_ULOG is not set to a ULog PX4 SITL wrote")
class SignedPX4Flight(_PX4Written, unittest.TestCase):
    """The same checks on a log PX4 itself wrote (PX4 SITL, SIH quadcopter, fly_px4.py's mission)."""

    @classmethod
    def source_bytes(cls):
        with open(PX4_REAL, "rb") as f:
            return f.read()


class SignedPX4Excerpt(_PX4Written, unittest.TestCase):
    """The same checks on the committed excerpt of that PX4 log. Never skipped: a missing or changed
    excerpt fails here."""

    @classmethod
    def source_bytes(cls):
        with open(PX4_EXCERPT, "rb") as f:
            buf = f.read()
        if hashlib.sha256(buf).hexdigest() != PX4_EXCERPT_SHA256:
            raise AssertionError(f"{PX4_EXCERPT} is not the committed excerpt (sha256 differs)")
        return buf

    def test_the_excerpt_is_under_300_kb_and_keeps_the_px4_header(self):
        self.assertLess(os.path.getsize(PX4_EXCERPT), 300 * 1024)
        self.assertEqual(self.log.info.get("sys_os_name"), b"Darwin")
        self.assertIn("vehicle_local_position", {name for name, _ in self.log.topics()})


class Reader(unittest.TestCase):
    def test_reader_round_trips_the_demo_writer(self):
        frames = flight.fly(7)
        log = ulog.ULog(flight.write(frames))
        tr = flight.track(log)
        self.assertEqual(len(tr), len(frames))
        self.assertAlmostEqual(tr[100]["x"], frames[100]["x"], places=3)

    @unittest.skipUnless(os.path.exists(PX4_SAMPLE), "PX4's sample log is not on this machine")
    def test_reader_reads_a_log_written_by_px4_and_the_chunks_cover_it(self):
        with open(PX4_SAMPLE, "rb") as f:
            buf = f.read()
        log = ulog.ULog(buf)
        self.assertEqual(log.info.get("sys_name"), b"PX4")
        pos = list(log.data("vehicle_local_position"))
        self.assertGreater(len(pos), 10)
        parts = ulogsign.chunks(buf)
        self.assertEqual(parts[0][0], 0)
        self.assertEqual(sum(n for _, n, _, _ in parts), len(buf))
        self.assertTrue(all(a[0] + a[1] == b[0] for a, b in zip(parts, parts[1:])))


class PrivateCopy(unittest.TestCase):
    """The private copy is taken from the folder handed in and nothing else."""

    def folders(self):
        tmp = tempfile.mkdtemp(prefix="snapshot-test-")
        self.addCleanup(shutil.rmtree, tmp, True)
        handed, outside = os.path.join(tmp, "handed"), os.path.join(tmp, "outside")
        for root, body in ((handed, b"inside"), (outside, b"outside")):
            os.makedirs(os.path.join(root, "records"))
            for i in range(3):
                with open(os.path.join(root, "records", f"{i}.json"), "wb") as f:
                    f.write(body)
        return tmp, handed, outside

    def copy_while_records_is_replaced(self, at_listing):
        # at the given listing (1: the folder handed in, 2: records/), records/ is renamed away and a
        # link to another folder's records/ is put in its place
        tmp, handed, outside = self.folders()
        real, calls = os.listdir, []

        def listdir(p):
            calls.append(p)
            if len(calls) == at_listing:
                os.rename(os.path.join(handed, "records"), os.path.join(tmp, "moved"))
                os.symlink(os.path.join(outside, "records"), os.path.join(handed, "records"))
            return real(p)

        copy = os.path.join(tmp, "copy")
        with mock.patch("os.listdir", listdir):
            try:
                ulogsign.snapshot(handed, copy)
            except ulogsign.SnapshotRefused as e:
                self.assertEqual(str(e), ulogsign.ENTRY_REFUSED)
                self.assertFalse(os.path.exists(copy))
                return None
        self.assertGreaterEqual(len(calls), at_listing)
        got = {}
        for root, _, files in os.walk(copy):
            for n in files:
                p = os.path.join(root, n)
                if not os.path.islink(p):
                    with open(p, "rb") as f:
                        got[os.path.relpath(p, copy)] = f.read()
        return got

    def test_the_private_copy_reads_nothing_outside_the_handed_in_folder_while_it_changes(self):
        got = self.copy_while_records_is_replaced(at_listing=2)
        self.assertEqual(got, {os.path.join("records", f"{i}.json"): b"inside" for i in range(3)})

    def test_the_private_copy_enters_no_folder_replaced_by_a_link_after_listing(self):
        # the whole folder is refused, so nothing is copied from the folder the link names
        self.assertIsNone(self.copy_while_records_is_replaced(at_listing=1))

    def test_a_handed_in_link_to_a_folder_is_refused(self):
        tmp, handed, outside = self.folders()
        link = os.path.join(tmp, "link")
        os.symlink(outside, link)
        with self.assertRaises(ulogsign.SnapshotRefused):
            ulogsign.snapshot(link, os.path.join(tmp, "copy"))
        self.assertFalse(os.path.exists(os.path.join(tmp, "copy")))

    def refused_reason(self, tmp, handed_in):
        copy = os.path.join(tmp, "copy")
        with self.assertRaises(ulogsign.SnapshotRefused) as cm:
            ulogsign.snapshot(handed_in, copy)
        self.assertFalse(os.path.exists(copy), handed_in)
        return str(cm.exception)

    def test_a_handed_in_link_to_a_folder_is_refused_however_it_is_spelled(self):
        tmp, handed, outside = self.folders()
        link = os.path.join(tmp, "link")
        os.symlink(outside, link)
        for spelling in ("", "/", "/.", "//", "/./", "/./.", "/.//./"):
            self.assertEqual(self.refused_reason(tmp, link + spelling), ulogsign.TOP_REFUSED, spelling)

    def test_a_handed_in_path_ending_in_dotdot_is_refused(self):
        tmp, handed, outside = self.folders()
        link = os.path.join(tmp, "link")
        os.symlink(outside, link)
        for handed_in in (link + "/records/..", link + "/records/../", link + "/records/../.",
                          handed + "/records/.."):
            self.assertEqual(self.refused_reason(tmp, handed_in), ulogsign.TOP_REFUSED, handed_in)

    def test_a_handed_in_folder_spelled_with_a_trailing_slash_is_copied(self):
        tmp, handed, outside = self.folders()
        for spelling in ("/", "/.", "/./"):
            copy = os.path.join(tmp, "copy")
            ulogsign.snapshot(handed + spelling, copy)
            for i in range(3):
                with open(os.path.join(copy, "records", f"{i}.json"), "rb") as f:
                    self.assertEqual(f.read(), b"inside", spelling)
            shutil.rmtree(copy)

    @unittest.skip("a folder holding a link is refused whole; replaced by "
                   "test_a_folder_holding_an_entry_that_is_not_a_plain_folder_or_file_is_refused_whole")
    def test_a_link_to_nothing_in_the_copy_resolves_to_nothing_whatever_the_folder_holds(self):
        # records/ is a link to another folder; the copy's records/ must be a link that reaches
        # nothing, whatever names the folder holds.
        tmp, handed, outside = self.folders()
        os.rename(os.path.join(handed, "records"), os.path.join(handed, "not-a-regular-file"))
        os.symlink(os.path.join(outside, "records"), os.path.join(handed, "records"))
        copy = os.path.join(tmp, "copy")
        ulogsign.snapshot(handed, copy)
        self.assertTrue(os.path.islink(os.path.join(copy, "records")))
        self.assertFalse(os.path.exists(os.path.join(copy, "records")))
        self.assertFalse(os.path.exists(os.path.join(copy, "records", "0.json")))


    def refused_whole(self, handed):
        copy = os.path.join(os.path.dirname(handed), "copy")
        with self.assertRaises(ulogsign.SnapshotRefused) as cm:
            ulogsign.snapshot(handed, copy)
        self.assertFalse(os.path.exists(copy))
        return str(cm.exception)

    def test_a_folder_holding_an_entry_that_is_not_a_plain_folder_or_file_is_refused_whole(self):
        for kind in C.EXTRA_KINDS[2:]:
            tmp, handed, outside = self.folders()
            C._extra(os.path.join(handed, "records"), "x", kind, outside, os.path.join(handed, "records", "0.json"))
            self.assertEqual(self.refused_whole(handed), ulogsign.ENTRY_REFUSED, kind)

    def test_a_folder_holding_an_entry_whose_name_is_not_plain_is_refused_whole(self):
        for name in C.NAMES + ("RECORDS",):
            tmp, handed, outside = self.folders()
            if name == "RECORDS":
                os.rename(os.path.join(handed, "records"), os.path.join(handed, "r.tmp"))
                os.rename(os.path.join(handed, "r.tmp"), os.path.join(handed, name))
            else:
                C._extra(os.path.join(handed, "records"), name, "file", None, None)
            self.assertEqual(self.refused_whole(handed), ulogsign.ENTRY_REFUSED, name)


if __name__ == "__main__":
    unittest.main(verbosity=2)
