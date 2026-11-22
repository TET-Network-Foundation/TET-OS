#!/usr/bin/env python3
"""Negative controls for test_encounter.py. Each must FAIL on its assertion (not error, not pass).

Two kinds:
  - tamper controls: ENCOUNTER_CONTROL=<name> removes the tamper step of the test named for it;
  - check controls: one check in encounter.py is taken out (its source line replaced, in the test's
    own process); the tests that rely on it must then fail.

    TET_CLI=... python3 prep/demos/robot-sim/encounter/controls.py
"""

import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
T = "Encounter.test_"
TAMPER = {
    "removed": ["encounter_removed_from_one_log_is_shown_by_the_other_copy"],
    "altitude": ["altitude_edited_and_resigned_by_its_operator_is_refused_by_the_other_counter_signature"],
    "replay": ["an_encounter_recorded_twice_is_refused_as_a_replay"],
    "replay_air": ["an_old_seen_message_replayed_in_the_air_is_refused_by_its_nonce"],
    "impostor": ["a_third_aircraft_pretending_to_be_A_is_refused_in_the_air"],
    "forge": ["an_encounter_forged_with_a_third_key_is_refused_by_the_checker"],
    "unread": ["a_record_file_verify_does_not_read_gives_no_encounter_and_no_agreement"],
    "refused": ["a_record_verify_refused_gives_no_encounter_line"],
    "half": ["counter_signature_with_only_its_ed25519_half_from_another_payload_is_refused",
             "counter_signature_with_only_its_mldsa44_half_from_another_payload_is_refused"],
}
# (what is taken out, the exact source text, its replacement, the tests that must fail); a control
# that changes several lines gives tuples of texts and replacements
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
CHECKS = [
    ("the receiver's nonce check",
     'if self.nonce is None or s.get("nonce_yours") != self.nonce:', "if False:",
     ["an_old_seen_message_replayed_in_the_air_is_refused_by_its_nonce"]),
    ("the checker's counter-signature verification",
     'why = verify_env(d, sig, enc_p, ENC_TYPE, known[k])', "why = None",
     ["altitude_edited_and_resigned_by_its_operator_is_refused_by_the_other_counter_signature",
      "counter_signature_with_only_its_ed25519_half_from_another_payload_is_refused",
      "counter_signature_with_only_its_mldsa44_half_from_another_payload_is_refused"]),
    ("the checker's replay check",
     "if h in first:", "if False:",
     ["an_encounter_recorded_twice_is_refused_as_a_replay"]),
    ("the record listing notebook.py verify uses",
     're.fullmatch(r"([0-9]+)\\.json", n)', 're.fullmatch(r"([0-9]+)\\.json(?:\\.[a-z]+)?", n)',
     ["a_record_file_verify_does_not_read_gives_no_encounter_and_no_agreement"]),
    ("the skip of records verify refused",
     "if seq in refused:", "if False:",
     ["a_record_verify_refused_gives_no_encounter_line"]),
    ("the private copy checked in place of the folder handed in",
     'copy = snapshot(d, os.path.join(tmp, "log"))', "copy = d",
     ["a_record_rewritten_after_verify_read_it_is_not_what_the_checker_reads"]),
    ("the private copy's refusal of links (links followed instead)", LINKS_FOLLOWED[0], LINKS_FOLLOWED[1],
     ["PrivateCopy.test_the_private_copy_enters_no_folder_replaced_by_a_link_after_listing",
      "a_folder_the_checker_finds_valid_is_valid_to_verify_on_the_folder_handed_in_with_the_same_record_bytes"]),
    ("the private copy's reads through the folder opened when it was listed", READ_BY_PATH[0], READ_BY_PATH[1],
     ["PrivateCopy.test_the_private_copy_reads_nothing_outside_the_handed_in_folder_while_it_changes"]),
    ("the private copy's refusal of an entry that is not a plain folder or file",
     "if st.st_dev != dev or not (is_dir or (stat.S_ISREG(st.st_mode) and st.st_nlink == 1)):", "if False:",
     ["PrivateCopy.test_a_folder_holding_an_entry_that_is_not_a_plain_folder_or_file_is_refused_whole"]),
    ("the private copy's refusal of a name that is not plain",
     'if name in (".", "..") or not _PLAIN_NAME.fullmatch(name):', "if False:",
     ["PrivateCopy.test_a_folder_holding_an_entry_whose_name_is_not_plain_is_refused_whole"]),
    ("the private copy's no-link rule for the folder handed in",
     "top = os.open(_top_name(src), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)",
     "top = os.open(_top_name(src), os.O_RDONLY | os.O_DIRECTORY)",
     ["PrivateCopy.test_a_handed_in_link_to_a_folder_is_refused"]),
    ("the trailing \"/\" taken off the folder handed in",
     'if len(p) > 1 and p.endswith("/"):', "if False:",
     ["PrivateCopy.test_a_handed_in_link_to_a_folder_is_refused_however_it_is_spelled"]),
    ("the trailing \"/.\" taken off the folder handed in",
     'elif p.endswith("/."):', "elif False:",
     ["PrivateCopy.test_a_handed_in_link_to_a_folder_is_refused_however_it_is_spelled"]),
    ("the refusal of a folder handed in that ends in \"..\"",
     'if p == ".." or p.endswith("/.."):', "if False:",
     ["PrivateCopy.test_a_handed_in_path_ending_in_dotdot_is_refused"]),
    ("the one reason for a folder handed in that is refused",
     "    except OSError:\n        raise SnapshotRefused(TOP_REFUSED)",
     '    except OSError as e:\n        raise SnapshotRefused(f"{TOP_REFUSED} ({e.strerror})")',
     ["PrivateCopy.test_a_handed_in_link_to_a_folder_is_refused_however_it_is_spelled"]),
    ("the comparison of the two copies",
     'if h in in_a and h in in_b:', "if True:",
     ["encounter_removed_from_one_log_is_shown_by_the_other_copy"]),
]


def failed_on_assertion(r, n):
    return r.returncode != 0 and re.search(rf"FAILED \(failures={n}\)", r.stderr) and "AssertionError" in r.stderr and "Error:" not in r.stderr.replace("AssertionError:", "")


def main():
    bad = 0
    for name, tests in TAMPER.items():
        env = dict(os.environ, ENCOUNTER_CONTROL=name)
        r = subprocess.run([sys.executable, os.path.join(HERE, "test_encounter.py")] + [T + t for t in tests],
                           capture_output=True, text=True, env=env)
        ok = failed_on_assertion(r, len(tests))
        print(f"{'ok  ' if ok else 'BAD '} tamper control {name}: {len(tests)} test(s) {'fail as they must' if ok else 'did NOT fail on their assertion'}")
        bad += 0 if ok else 1
    for what, old, new, tests in CHECKS:
        pairs = list(zip(old, new)) if isinstance(old, tuple) else [(old, new)]
        code = ("import sys, unittest; sys.argv=['x']; sys.path.insert(0, %r); import encounter, test_encounter; "
                "src = open(encounter.__file__).read()\n"
                "for o, n in %r:\n    assert src.count(o) == 1, 'control text not found'; src = src.replace(o, n)\n"
                "exec(compile(src, encounter.__file__, 'exec'), encounter.__dict__); "
                "s = unittest.TestLoader().loadTestsFromNames(%r, test_encounter); "
                "r = unittest.TextTestRunner().run(s); sys.exit(0 if len(r.failures) == %d and not r.errors else 1)"
                ) % (HERE, pairs, [t if "." in t else "Encounter.test_" + t for t in tests], len(tests))
        r = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=HERE)
        ok = r.returncode == 0 and "AssertionError" in r.stderr
        print(f"{'ok  ' if ok else 'BAD '} check control, without {what}: {len(tests)} test(s) {'fail as they must' if ok else 'did NOT fail on their assertion'}")
        bad += 0 if ok else 1
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
