#!/usr/bin/env python3
"""Negative controls for test_samples.py. Each control changes one line of samples.py (or the test's
input) in a scratch copy, and every test it names must then FAIL. A control whose tests still pass is
reported, and the script exits 1.

    TET_CLI=/path/to/tet-cli python3 prep/demos/two-party-v0/controls_samples.py
"""

import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
TOOLS = os.path.normpath(os.path.join(HERE, "..", "..", "..", "tools"))

# (what the control does, file, old text, new text, tests that must fail)
CONTROLS = [
    ("(a) made honest: the Ed25519 half is not swapped", "samples.py",
     "sigs_a[pa] = swap_half(sigs_a[pa], other_sig, nb.ED)", "pass",
     ["test_a_ed25519_half_of_another_record_is_refused_for_that_half"]),
    ("(b) made honest: the ML-DSA-44 half is not swapped", "samples.py",
     "sigs_b[pa] = swap_half(sigs_b[pa], other_sig, nb.ML)", "pass",
     ["test_b_ml_dsa_half_of_another_record_is_refused_for_that_half"]),
    ("(c) made honest: the summary is not changed", "samples.py",
     'r["summary"] = "sample: box 6 handed over"', "pass",
     ["test_c_summary_changed_after_signing_is_refused_by_both_signatures"]),
    ("(d) made honest: the second record cites no permit", "samples.py",
     'permit=(dA, pid))\n        tp.append(dB, rec, sigs, tp.pin_of(dA))\n        seq = hand_entry(dA, rec, permit=pid)',
     'permit=None)\n        tp.append(dB, rec, sigs, tp.pin_of(dA))\n        seq = hand_entry(dA, rec, permit=None)',
     ["test_d_second_use_of_a_permit_is_a_log_conflict_at_the_permit_holder"]),
    ("(e) made honest: the record number is not moved past the next one", "samples.py",
     'r[p + ".seq"] = str(int(r[p + ".seq"]) + 1)', "pass",
     ["test_e_record_number_past_the_next_one_is_a_log_conflict_at_that_side"]),
    ("(f) made honest: the record names two keys", "samples.py",
     'r[("b" if mine == "a" else "a") + "." + k] = r[mine + "." + k]', "pass",
     ["test_f_one_key_for_both_parties_is_refused_as_a_record"]),
    ("check prints a wrong verdict (its first problem dropped)", "samples.py",
     "tp.report(problems, notes)", "tp.report(problems[1:], notes)",
     ["test_check_all_matches_every_folder"]),
    ("a device.key is copied into every sample folder", "samples.py",
     'o.write(what + "\\n" + "\\n".join(expected) + "\\n")',
     'o.write(what + "\\n" + "\\n".join(expected) + "\\n")\n        shutil.copyfile(os.path.join(self.A, "device.key"), os.path.join(f, "device.key"))',
     ["test_no_private_key_anywhere_in_the_set"]),
    ("a device.key is copied in under the name of a record", "samples.py",
     'o.write(what + "\\n" + "\\n".join(expected) + "\\n")',
     'o.write(what + "\\n" + "\\n".join(expected) + "\\n")\n        if exports[0]:\n            shutil.copyfile(os.path.join(self.A, "device.key"), os.path.join(f, "export-1", "records", "99.json"))',
     ["test_no_private_key_anywhere_in_the_set"]),
    # The sample clock: the machine's clock put back, one way at a time.
    ("machine clock back: notebook.py runs as it is, not through sample_clock.py", "samples.py",
     'tp.NOTEBOOK = tp.NOTEBOOK, os.path.join(HERE, "sample_clock.py")', "tp.NOTEBOOK = tp.NOTEBOOK, tp.NOTEBOOK",
     ["test_every_record_carries_the_sample_time_and_not_the_clock_at_make_time",
      "test_nothing_of_the_machine_that_made_it_is_in_the_set"]),
    ("machine clock back: sample_clock.py leaves notebook.py's clock as it is", "sample_clock.py",
     "nb.dt = fixed_clock_module()", "pass",
     ["test_every_record_carries_the_sample_time_and_not_the_clock_at_make_time",
      "test_nothing_of_the_machine_that_made_it_is_in_the_set"]),
    ("machine clock back in the entries samples.py writes by hand", "samples.py",
     '"clock_utc": sample_clock.SAMPLE_CLOCK_UTC}',
     '"clock_utc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")}',
     ["test_every_record_carries_the_sample_time_and_not_the_clock_at_make_time",
      "test_nothing_of_the_machine_that_made_it_is_in_the_set"]),
    ("the files keep the time they were written at", "samples.py",
     "    set_times(out)\n", "",
     ["test_nothing_of_the_machine_that_made_it_is_in_the_set"]),
    # The checks themselves, switched off one at a time in the scratch copy of twoparty.py.
    ("twoparty: tet-cli agent verify's refusal is ignored", "twoparty.py",
     "    if rc != 0:\n        return f\"signature: {nb.refusal(out)}\"", "    pass",
     ["test_a_ed25519_half_of_another_record_is_refused_for_that_half",
      "test_b_ml_dsa_half_of_another_record_is_refused_for_that_half",
      "test_c_summary_changed_after_signing_is_refused_by_both_signatures"]),
    ("twoparty: the exports are not checked", "twoparty.py",
     "problems += log_problems(p, rec, h, exports[i], pins[i])", "pass",
     ["test_d_second_use_of_a_permit_is_a_log_conflict_at_the_permit_holder",
      "test_e_record_number_past_the_next_one_is_a_log_conflict_at_that_side"]),
    ("twoparty: two different Ed25519 keys in key-id order are not required", "twoparty.py",
     'if not rec["a.ed"] < rec["b.ed"]:', "if False:",
     ["test_f_one_key_for_both_parties_is_refused_as_a_record"]),
]


def copy_tree(t):
    d = os.path.join(t, "prep", "demos", "two-party-v0")
    os.makedirs(d)
    for n in ("twoparty.py", "samples.py", "sample_clock.py", "test_samples.py"):
        shutil.copy(os.path.join(HERE, n), d)
    os.symlink(TOOLS, os.path.join(t, "tools"))
    return d


def main():
    bad = 0
    for what, fname, old, new, tests in CONTROLS:
        t = tempfile.mkdtemp(prefix="two-party-samples-control-")
        try:
            d = copy_tree(t)
            path = os.path.join(d, fname)
            with open(path, encoding="utf-8") as f:
                text = f.read()
            if text.count(old) != 1:
                print(f"CONTROL BROKEN: {what}: the text to change is found {text.count(old)} times, not once")
                bad += 1
                continue
            with open(path, "w", encoding="utf-8") as f:
                f.write(text.replace(old, new))
            for test in tests:
                r = subprocess.run([sys.executable, "-m", "unittest", f"test_samples.Samples.{test}"], cwd=d,
                                   capture_output=True, text=True)
                # An assertion failure in the named test, not an error while making the set.
                ok = r.returncode != 0 and f"FAIL: {test} " in r.stderr and "ERROR: " not in r.stderr
                bad += not ok
                print(f"{'FAILS as it must' if ok else 'DOES NOT FAIL AS IT MUST'}: {what}: {test}")
                if not ok:
                    print(r.stderr[-1500:])
        finally:
            shutil.rmtree(t)
    print(f"{len(CONTROLS)} controls, {bad} not failing as they must")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
