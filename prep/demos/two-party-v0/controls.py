#!/usr/bin/env python3
"""Negative controls: break ONE check at a time in a scratch copy and require its tests to FAIL.

    TET_CLI=/path/to/tet-cli python3 prep/demos/two-party-v0/controls.py

Exit 0 only if every control made its tests fail (and the unbroken copy passes them).
"""

import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, "..", "..", ".."))

# (name, old text, new text, tests that must fail)
CONTROLS = [
    ("length prefixes removed (separator only)",
     'return str(len(b)).encode() + b":" + b + b","', 'return b + b","',
     ["Separator.test_field_lists_that_differ_only_in_where_a_separator_falls_do_not_collide",
      "Separator.test_summary_that_imitates_a_field_decodes_to_itself"]),
    ("NFC check removed",
     'if unicodedata.normalize("NFC", s) != s:', "if False:",
     ["Text.test_nfd_summary_is_refused_not_normalised", "Text.test_hand_built_nfd_record_is_refused_by_decode"]),
    ("leading and trailing spaces allowed",
     'if s != s.strip(" ") or "  " in s:', 'if "  " in s:',
     ["Text.test_whitespace_variants_are_refused"]),
    ("double spaces allowed",
     'if s != s.strip(" ") or "  " in s:', 'if s != s.strip(" "):',
     ["Text.test_whitespace_variants_are_refused", "FormatFillers.test_hand_built_whitespace_record_is_refused_by_decode"]),
    ("control and format characters allowed",
     'if any(unicodedata.category(c) in ("Cc", "Cf", "Zl", "Zp") for c in s):', "if False:",
     ["FormatFillers.test_format_fillers_are_refused", "FormatFillers.test_hand_built_whitespace_record_is_refused_by_decode",
      "Text.test_whitespace_variants_are_refused"]),
    ("spaces other than U+0020 allowed",
     'if any(c.isspace() and c != " " for c in s):', "if False:",
     ["Text.test_whitespace_variants_are_refused", "FormatFillers.test_hand_built_whitespace_record_is_refused_by_decode"]),
    ("one ML-DSA-44 key for both parties not refused",
     'if rec["a.ml"] == rec["b.ml"]:', "if False:",
     ["SameKey.test_one_ml_dsa_key_named_for_both_parties_is_refused"]),
    ("sign does not check the counterparty",
     'raise Refused("sign: the record does not name the pinned counterparty")', "pass",
     ["SignChecks.test_sign_refuses_a_record_naming_another_counterparty"]),
    ("sign does not check the agreed hash",
     'raise Refused("sign: the record does not carry the agreed hash this side computed")', "pass",
     ["SignChecks.test_sign_refuses_a_record_with_another_agreed_hash"]),
    ("random value not mixed into the agreed hash",
     "return sha(netstring(AGREED_TAG) + netstring(random_value) + netstring(document))",
     "return sha(netstring(AGREED_TAG) + netstring(document))",
     ["RandomValue.test_guessing_does_not_find_the_agreed_hash_with_the_random_value"]),
    ("random value length not checked",
     "if len(random_value) != RANDOM_LEN:", "if False:",
     ["RandomValue.test_a_random_value_of_another_length_is_refused"]),
    ("prev not compared with the record",
     'if entry.get("prev") != rec[p + ".prev"]:', "if False:",
     ["Logs.test_log_rewritten_before_the_record_shows"]),
    ("a log conflict counted as a bad signature",
     "sig = [x for x in problems if not isinstance(x, LogConflict)]", "sig = list(problems)",
     ["Logs.test_report_says_signatures_valid_and_a_log_conflict_for_a_withheld_copy"]),
    ("a missing export reported as a pass",
     "    elif notes:\n", "    elif False:\n",
     ["Logs.test_report_without_an_export_says_so_and_not_as_promised"]),
    ("printed list shorter than the README",
     '    "that a permit was not used in another notebook: once is once per notebook",\n', "",
     ["PrintedList.test_readme_lists_exactly_what_the_check_prints"]),
    ("field count not checked",
     "if len(parts) != 1 + len(FIELDS):", "if False:",
     ["Separator.test_extra_field_such_as_a_time_is_refused"]),
    ("append does not check its own position",
     'if next_position(d) != (rec[me + ".seq"], rec[me + ".prev"]):\n        raise Refused(f"append:',
     'if False:\n        raise Refused(f"append:',
     ["Threats.test_replayed_into_the_same_notebook_later_is_refused"]),
    ("sign does not check its own position",
     'raise Refused(f"sign: this notebook is not at record {rec[me + \'.seq\']} after the record the record names")', "pass",
     ["Threats.test_signing_a_position_this_notebook_has_left_is_refused"]),
    ("append does not check the counterparty pin",
     'tuple(peer_pin):\n        raise Refused("append: the record does not name the pinned counterparty")',
     'tuple(peer_pin):\n        pass',
     ["Threats.test_wrong_counterparty_pin_is_refused_at_append"]),
    ("append does not check that the record names this notebook",
     "    if me is None:\n        raise Refused(\"append: the record does not name this notebook\")\n", "",
     ["Threats.test_replayed_into_another_notebook_is_refused_at_append"]),
    ("check does not match pins to the record",
     "        if p is None:\n            return [f\"record: does not name the pinned party {pin[0]}\"], []\n", "",
     ["Threats.test_replayed_to_another_counterparty_is_refused_by_the_check"]),
    ("tet-cli verify not called (key ids compared only)",
     '    rc, out = nb.verify_bytes(cli(), chain_env, env_bytes, record, "record")\n', "    rc, out = 0, ''\n",
     ["OneHalf.test_ml_dsa_half_from_another_record_is_refused", "OneHalf.test_ed25519_half_from_another_record_is_refused"]),
    ("key ids not compared with the pin",
     "    why = key_problem(nb.half_keyids(env), pin)\n", "    why = None\n",
     ["Threats.test_signature_by_the_other_party_in_this_slot_is_refused",
      "SignChecks.test_ml_dsa_half_of_the_other_party_in_this_slot_is_refused"]),
    ("Ed25519 key id not compared with the pin",
     "    if got[0] != pin[0]:\n", "    if False:\n",
     ["Threats.test_signature_by_the_other_party_in_this_slot_is_refused"]),
    ("ML-DSA-44 key id not compared with the pin",
     "    if got[1] != pin[1]:\n", "    if False:\n",
     ["SignChecks.test_ml_dsa_half_of_the_other_party_in_this_slot_is_refused"]),
    ("log end not checked",
     "    if seq not in bodies:\n", "    if False:\n",
     ["Threats.test_withheld_copy_shows_with_its_export"]),
    ("log entry not compared with this record",
     'if entry.get("reading", {}).get("value") != f"two-party {h}" or entry["reading"].get("unit") != UNIT:', "if False:",
     ["Threats.test_other_text_at_the_same_position_shows"]),
    ("permit citation not checked",
     'if rec["permit.party"] == p and entry.get("permit") != rec["permit.id"]:', "if False:",
     ["Permit.test_record_naming_a_permit_its_log_does_not_cite_shows"]),
    ("append does not pass the permit to the notebook",
     '        argv += ["--permit", rec["permit.id"]]\n', "        pass\n",
     ["Permit.test_permit_cited_twice_is_refused_at_append", "Permit.test_cited_permit_checks_once"]),
    ("sign does not check the reservation",
     'raise Refused(f"sign: record {seq} is reserved for another record")', "pass",
     ["Reservation.test_sign_refuses_a_second_record_at_a_reserved_position"]),
    ("append does not check the reservation",
     'if reserved_for_another(d, rec[me + ".seq"], rec[me + ".prev"], h):', "if False:",
     ["Reservation.test_append_refuses_another_record_at_a_reserved_position"]),
    ("sign does not check the summary",
     'raise Refused("sign: the record does not carry the summary this side was given")', "pass",
     ["SignMeant.test_sign_refuses_a_record_with_another_summary"]),
    ("sign does not check the permit",
     'if (rec["permit.party"], rec["permit.id"]) != permit_meant(me, permit):', "if False:",
     ["SignMeant.test_sign_refuses_a_record_naming_its_own_permit_it_did_not_mean",
      "SignMeant.test_sign_refuses_a_record_naming_another_permit_id_of_this_side",
      "SignMeant.test_sign_refuses_a_record_naming_the_meant_permit_id_as_the_other_sides"]),
    ("sign compares only the permit id, not which side holds it",
     'if (rec["permit.party"], rec["permit.id"]) != permit_meant(me, permit):',
     'if rec["permit.id"] != permit_meant(me, permit)[1]:',
     ["SignMeant.test_sign_refuses_a_record_naming_the_meant_permit_id_as_the_other_sides"]),
    ("sign compares only which side holds the permit, not its id",
     'if (rec["permit.party"], rec["permit.id"]) != permit_meant(me, permit):',
     'if rec["permit.party"] != permit_meant(me, permit)[0]:',
     ["SignMeant.test_sign_refuses_a_record_naming_another_permit_id_of_this_side"]),
    ("append does not check where the record landed",
     'if str(landed) != rec[me + ".seq"]:', "if False:",
     ["Landing.test_append_refuses_when_another_write_came_between_its_check_and_its_write"]),
    ("abort does not check its own position",
     'raise Refused(f"abort: this notebook is no longer at record {rec[me + \'.seq\']}; the abort entry cannot be written there")', "pass",
     ["AbortPosition.test_abort_refuses_when_the_notebook_has_left_the_reserved_number"]),
]


def run_tests(root, tests):
    d = os.path.join(root, "prep", "demos", "two-party-v0")
    # -B: no bytecode is written, so a control can never run a cached copy of an earlier edit (two
    # edits of equal size within one second share the mtime and size that the cache checks).
    r = subprocess.run([sys.executable, "-B", "-m", "unittest"] + [f"test_twoparty.{t}" for t in tests],
                       cwd=d, capture_output=True, text=True)
    return r.returncode, r.stderr


def scratch_copy(t):
    root = os.path.join(t, "repo")
    d = os.path.join(root, "prep", "demos", "two-party-v0")
    os.makedirs(d)
    for n in ("twoparty.py", "test_twoparty.py", "README.md"):
        shutil.copy(os.path.join(HERE, n), d)
    os.symlink(os.path.join(REPO, "tools"), os.path.join(root, "tools"))
    return root


def main():
    bad = 0
    with tempfile.TemporaryDirectory(prefix="two-party-controls-") as t:
        root = scratch_copy(t)
        all_tests = sorted({x for c in CONTROLS for x in c[3]})
        rc, err = run_tests(root, all_tests)
        if rc != 0:
            print("unbroken copy does not pass the controlled tests:\n" + err[-2000:])
            return 2
        path = os.path.join(root, "prep", "demos", "two-party-v0", "twoparty.py")
        with open(path) as f:
            clean = f.read()
        for name, old, new, tests in CONTROLS:
            if clean.count(old) != 1:
                print(f"CONTROL BROKEN  {name}: the text to change is found {clean.count(old)} times, not once")
                bad += 1
                continue
            with open(path, "w") as f:
                f.write(clean.replace(old, new))
            # every listed test on its own: one of them failing does not count for the others
            still = [x for x in tests if not (lambda r: r[0] != 0 and ("FAIL:" in r[1] or "ERROR:" in r[1]))(run_tests(root, [x]))]
            failed = not still
            print(f"{'fails as it must' if failed else 'STILL PASSES ' + ', '.join(still)}  {name}  ({', '.join(tests)})")
            bad += 0 if failed else 1
        with open(path, "w") as f:
            f.write(clean)
    print(f"{len(CONTROLS) - bad} of {len(CONTROLS)} controls fail as they must")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
