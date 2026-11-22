#!/usr/bin/env python3
"""Negative controls for test_px4.py: remove one tamper step at a time and require the test named
for it to FAIL on its assertion (not error, not pass).

    TET_CLI=... [PX4_REAL_ULOG=PX4_LOG.ulg] python3 prep/demos/robot-sim/px4/controls.py

Plus five controls on the checker itself, each must make its test fail: ulogsign.replay_track
ignores the chunks that hold the formats (decoding_ok forced true); read_records reads any digits in
a record's file name, not only the ASCII ones verify reads; replay_track trusts a checked chunk whose
start or end is not a message boundary; and, for its two tests, replay_track takes a sample's
attitude from any attitude message in the file, not only from checked chunks.

Each control runs on the stand-in log (SignedFlight), on the committed excerpt of a log PX4 SITL wrote
(SignedPX4Excerpt), and, when PX4_REAL_ULOG names the whole log, on that too (SignedPX4Flight). On
PX4's logs one more control: the tampers write at the
stand-in's fixed field places instead of reading them from the file's format; both tamper tests
must then fail.
"""

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CONTROLS = {
    "near_miss": "test_near_miss_altitude_lowered_is_refused_on_its_chunk_and_nowhere_else",
    "geofence": "test_geofence_exit_moved_inside_is_refused_on_the_chunks_that_held_it",
    "appended": "test_bytes_added_after_the_last_signed_chunk_are_named",
}


# Links followed instead of refused: looked up through, and opened through.
LINKS_FOLLOWED = (("st = os.stat(name, dir_fd=dfd, follow_symlinks=False)",
                   "_SNAP_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_NONBLOCK",
                   "_SNAP_FILE = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK"),
                  ("st = os.stat(name, dir_fd=dfd, follow_symlinks=True)",
                   "_SNAP_DIR = os.O_RDONLY | os.O_DIRECTORY | os.O_NONBLOCK",
                   "_SNAP_FILE = os.O_RDONLY | os.O_NONBLOCK"))
# Files read by their path in the folder handed in, not through the folder opened when listed.
READ_BY_PATH = (("    def walk(dfd, t, dev):", "walk(fd, os.path.join(t, name), dev)", "body = _snap_read(fd)"),
                ("    def walk(dfd, t, dev, s=src):", "walk(fd, os.path.join(t, name), dev, os.path.join(s, name))",
                 "body = open(os.path.join(s, name), 'rb').read()"))

def run_named(cls, test, control):
    env = dict(os.environ, PX4DEMO_CONTROL=control)
    r = subprocess.run([sys.executable, os.path.join(HERE, "test_px4.py"), f"{cls}.{test}"],
                       capture_output=True, text=True, env=env)
    return r.returncode != 0 and re.search(r"FAILED \(failures=1\)", r.stderr) and "AssertionError" in r.stderr


def report(ok, name, test):
    print(f"{'ok  ' if ok else 'BAD '} control {name}: {test} {'fails as it must' if ok else 'did NOT fail on its assertion'}")
    return 0 if ok else 1


def main():
    px4 = bool(os.environ.get("PX4_REAL_ULOG")) and os.path.exists(os.environ["PX4_REAL_ULOG"])
    # the committed PX4 excerpt always runs, so every control runs on a log PX4 wrote, CI included
    classes = ["SignedFlight", "SignedPX4Excerpt"] + (["SignedPX4Flight"] if px4 else [])
    px4_classes = ["SignedPX4Excerpt"] + (["SignedPX4Flight"] if px4 else [])
    if not px4:
        print("note: PX4_REAL_ULOG not set; controls run on the stand-in log and the PX4 excerpt")
    bad = 0
    for cls in classes:
        for name, test in CONTROLS.items():
            bad += report(run_named(cls, test, name), f"{name} ({cls})", test)
        # the checker control: run the test with replay_track's decoding rule removed, in-process
        code = ("import sys, unittest; sys.argv=['x']; sys.path.insert(0, %r); import ulogsign, test_px4; "
                "src = open(ulogsign.__file__).read().replace('p[\"checked\"] = decoding_ok and ', 'p[\"checked\"] = '); "
                "assert 'decoding_ok and' not in src; exec(compile(src, ulogsign.__file__, 'exec'), ulogsign.__dict__); "
                "s = unittest.TestLoader().loadTestsFromName('test_px4.%s.test_a_changed_format_marks_every_sample_unchecked'); "
                "r = unittest.TextTestRunner().run(s); sys.exit(0 if len(r.failures) == 1 and not r.errors else 1)") % (HERE, cls)
        r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=HERE)
        bad += report(r.returncode == 0 and "AssertionError" in r.stderr, f"decoding ({cls})",
                      "test_a_changed_format_marks_every_sample_unchecked")
        # two more checker controls, each one source line of ulogsign changed in the test's process
        for name, old, new, test in (
                ("record-names", 're.fullmatch(r"([0-9]+)\\.json", name)', 're.fullmatch(r"([0-9]+)\\.json(?:\\.[a-z]+)?", name)',
                 "test_a_record_file_verify_does_not_read_is_not_read_here"),
                ("snapshot", 'copy = snapshot(d, os.path.join(tmp, "log"))', 'copy = d',
                 "test_a_record_rewritten_after_verify_read_it_is_not_what_the_checker_reads"),
                ("pin-inside", 'nb.read_pin(pin, d)  # a pin', 'None  # a pin',
                 "test_a_pin_inside_the_folder_handed_in_is_refused"),
                ("framing", 'decoding_ok and trusted(owner)  # control:framing',
                 'decoding_ok and bool(owner) and owner["status"] == "checked"',
                 "test_samples_in_a_chunk_whose_framing_moved_are_not_shown_checked"),
                ("attitude", 'attitude_ok=lambda off: trusted(owner_of(off))):  # control:attitude',
                 'attitude_ok=None):', "test_a_checked_sample_takes_no_attitude_from_a_refused_chunk"),
                ("attitude-appended", 'attitude_ok=lambda off: trusted(owner_of(off))):  # control:attitude',
                 'attitude_ok=None):', "test_a_checked_sample_takes_no_attitude_from_bytes_after_the_last_chunk")):
            code = ("import sys, unittest; sys.argv=['x']; sys.path.insert(0, %r); import ulogsign, test_px4; "
                    "src = open(ulogsign.__file__).read(); assert src.count(%r) == 1; src = src.replace(%r, %r); "
                    "exec(compile(src, ulogsign.__file__, 'exec'), ulogsign.__dict__); "
                    "s = unittest.TestLoader().loadTestsFromName('test_px4.%s.%s'); "
                    "r = unittest.TextTestRunner().run(s); sys.exit(0 if len(r.failures) == 1 and not r.errors else 1)") % (HERE, old, old, new, cls, test)
            r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=HERE)
            bad += report(r.returncode == 0 and "AssertionError" in r.stderr, f"{name} ({cls})", test)
    for cls in px4_classes:
        # the tampers write at the stand-in's fixed places (z at byte 21, y at 17) instead of the format's
        for test in (CONTROLS["near_miss"], CONTROLS["geofence"]):
            code = ("import sys, unittest; sys.argv=['x']; sys.path.insert(0, %r); import ulog, test_px4; "
                    "ulog.ULog.field_offset = lambda self, fmt, field: {'y': 3 + 2 + 8 + 4, 'z': 3 + 2 + 8 + 8}[field]; "
                    "s = unittest.TestLoader().loadTestsFromName('test_px4.%s.%s'); "
                    "r = unittest.TextTestRunner().run(s); sys.exit(0 if len(r.failures) == 1 and not r.errors else 1)") % (HERE, cls, test)
            r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=HERE)
            bad += report(r.returncode == 0 and "AssertionError" in r.stderr, f"fixed-offsets ({cls})", test)
    # the private copy (no log needed): one source line of ulogsign changed at a time
    for name, old, new, test in (
            ("copy-links-followed", LINKS_FOLLOWED[0], LINKS_FOLLOWED[1],
             "PrivateCopy.test_the_private_copy_enters_no_folder_replaced_by_a_link_after_listing"),
            ("copy-links-followed (generated folders)", LINKS_FOLLOWED[0], LINKS_FOLLOWED[1],
             "SignedFlight.test_a_folder_the_checker_finds_valid_is_valid_to_verify_on_the_folder_handed_in_with_the_same_record_bytes"),
            ("copy-read-by-path", READ_BY_PATH[0], READ_BY_PATH[1],
             "PrivateCopy.test_the_private_copy_reads_nothing_outside_the_handed_in_folder_while_it_changes"),
            ("copy-not-plain-entry", "if st.st_dev != dev or not (is_dir or (stat.S_ISREG(st.st_mode) and st.st_nlink == 1)):",
             "if False:", "PrivateCopy.test_a_folder_holding_an_entry_that_is_not_a_plain_folder_or_file_is_refused_whole"),
            ("copy-not-plain-name", 'if name in (".", "..") or not _PLAIN_NAME.fullmatch(name):', "if False:",
             "PrivateCopy.test_a_folder_holding_an_entry_whose_name_is_not_plain_is_refused_whole"),
            ("copy-top-link", "top = os.open(_top_name(src), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)",
             "top = os.open(_top_name(src), os.O_RDONLY | os.O_DIRECTORY)", "test_a_handed_in_link_to_a_folder_is_refused"),
            ("copy-top-trailing-slash", 'if len(p) > 1 and p.endswith("/"):', "if False:",
             "test_a_handed_in_link_to_a_folder_is_refused_however_it_is_spelled"),
            ("copy-top-trailing-dot", 'elif p.endswith("/."):', "elif False:",
             "test_a_handed_in_link_to_a_folder_is_refused_however_it_is_spelled"),
            ("copy-top-dotdot", 'if p == ".." or p.endswith("/.."):', "if False:",
             "test_a_handed_in_path_ending_in_dotdot_is_refused"),
            ("copy-top-one-reason", "    except OSError:\n        raise SnapshotRefused(TOP_REFUSED)",
             '    except OSError as e:\n        raise SnapshotRefused(f"{TOP_REFUSED} ({e.strerror})")',
             "test_a_handed_in_link_to_a_folder_is_refused_however_it_is_spelled")):
        # a control that changes several lines gives tuples of texts and replacements
        pairs = list(zip(old, new)) if isinstance(old, tuple) else [(old, new)]
        code = ("import sys, unittest; sys.argv=['x']; sys.path.insert(0, %r); import ulogsign, test_px4; "
                "src = open(ulogsign.__file__).read()\n"
                "for o, n in %r:\n    assert src.count(o) == 1; src = src.replace(o, n)\n"
                "exec(compile(src, ulogsign.__file__, 'exec'), ulogsign.__dict__); "
                "s = unittest.TestLoader().loadTestsFromName('test_px4.%s'); "
                "r = unittest.TextTestRunner().run(s); sys.exit(0 if len(r.failures) == 1 and not r.errors else 1)"
                ) % (HERE, pairs, test if "." in test else "PrivateCopy." + test)
        r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=HERE)
        bad += report(r.returncode == 0 and "AssertionError" in r.stderr, name, test)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
