#!/usr/bin/env python3
"""Guard for the agent console demo (console.py).

    python3 prep/demos/agent-console/test_console.py   (TET_CLI=path/to/tet-cli, else target/release/tet-cli)

Three agents under new test keys, signed and checked only through notebook.py and tet-cli (no mock of
either). The outside check copies a log into a second folder with no key and runs notebook.py verify
there. Each "try to cheat" button must be refused for the reason it is named for, and for nothing else
that could answer first:
  Overuse  one more record citing a used permit, signed by the agent's own key and linked correctly
           -> exactly one problem: "permit: <id> was already used by record N"
  Alter    the newest record's value edited -> that record's signature is refused
  Swapkey  the newest record signed again by another agent's key -> that record's key is refused,
           and its signature is NOT (the new signature is valid)
Also: a grant of N gives N uses; a use takes one; paused and revoked agents are refused here; a check
against another agent's key id is refused; the page server answers only 127.0.0.1 and same-origin JSON;
every label, every Japanese string, no money words.

Negative controls: controls.sh removes each cheat's tamper line (marked "# control:<name>") in a copy
of this folder and runs that cheat's test, which must then FAIL on its own assertion.

tet-cli is required: without it this fails, it does not skip.
"""

import http.client
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True
import console  # noqa: E402


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.exists(console.tet_cli()):
            raise AssertionError(f"tet-cli not found at {console.tet_cli()}: set TET_CLI")
        cls.tmp = tempfile.mkdtemp(prefix="agent-console-test-")
        cls.con = console.Console(os.path.join(cls.tmp, "w"))
        cls.con.init(seed=False)
        cls.con.grant("rover", "open-gate", 2)
        cls.con.use("rover", "open-gate")          # record 1 uses the first permit
        cls.con.grant("arm", "read-sensor", 1)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp)

    def problems(self, r):
        return [(int(k), w) for k, ws in r["by_seq"].items() for w in ws] + [(None, w) for w in r["log"]]


class Untouched(Base):
    def test_valid_and_counts(self):
        r = self.con.check("rover", "rover")
        self.assertEqual(r["verdict"], "VALID", r)
        self.assertEqual(self.problems(r), [])
        row = self.con.row("rover")
        self.assertEqual(row["may"], [{"action": "open-gate", "left": 1}])
        self.assertEqual(row["records"], 1)

    def test_outside_copy_holds_no_key_or_pin(self):
        self.con.check("rover", "rover")
        d = os.path.join(self.con.outside, "rover")
        self.assertFalse(os.path.exists(os.path.join(d, "device.key")))
        self.assertFalse(os.path.exists(os.path.join(d, "device.pin")))

    def test_another_agents_key_id_is_refused(self):
        r = self.con.check("rover", "arm")
        self.assertEqual(r["verdict"], "INVALID")
        self.assertTrue(any(w.startswith("key: signed by") for _, w in self.problems(r)), r)


class CutShort(Base):
    def test_whether_the_newest_record_is_present_is_not_judged_and_the_page_says_so(self):
        # Not judged: whether the newest record is present (the page's "does not show" list says so).
        self.con.use("rover", "open-gate")  # record 2, so that one record is left after the cut
        d = self.con.copy_out("rover")
        for ext in (".json", ".json.sig.json"):
            os.remove(os.path.join(d, "records", f"2{ext}"))
        chain = console.notebook.chain_lines(d)[:-1]
        with open(os.path.join(d, "chain.txt"), "w") as f:
            f.write("".join(h + "\n" for h in chain))
        r = self.con.verify("rover", "rover")
        self.assertEqual((r["verdict"], self.problems(r), r["records"]), ("VALID", [], 1), r)
        # So "does not show" must say that completeness at the end is not judged.
        self.assertTrue(any("That the log is complete at its end: not judged" in s for s in console.NOT_SHOWN), console.NOT_SHOWN)


class CountFromVerify(Base):
    def test_records_checked_is_the_number_of_record_files_verify_read_not_chain_lines(self):
        # One line more in chain.txt than records/ holds: verify refuses the log, and the page's
        # "record(s) checked" stays the number of record files verify read.
        d = self.con.copy_out("rover")
        n = len([x for x in os.listdir(os.path.join(d, "records")) if re.fullmatch(r"[0-9]+\.json", x)])
        with open(os.path.join(d, "chain.txt"), "a") as f:
            f.write("0" * 64 + "\n")
        r = self.con.verify("rover", "rover")
        self.assertEqual(r["verdict"], "INVALID", r)
        self.assertEqual(r["records"], n)


class Overuse(Base):
    def test_overuse_is_refused_by_the_permit_check_only(self):
        r = self.con.check("rover", "rover", "overuse")
        self.assertEqual(r["verdict"], "INVALID", r)
        rover = os.path.join(self.con.device, "rover")
        pid = next(iter(console.notebook.cited_permits(rover, *console.notebook.read_head(rover))))
        self.assertEqual(self.problems(r), [(2, f"permit: {pid} was already used by record 1")])


class Alter(Base):
    def test_altered_record_signature_is_refused(self):
        r = self.con.check("rover", "rover", "alter")
        self.assertEqual(r["verdict"], "INVALID", r)
        self.assertEqual(r["cheat"]["seq"], 1)
        self.assertTrue(any(w.startswith("signature: ") and "is not the" in w for w in r["by_seq"].get("1", [])), r)


class Swapkey(Base):
    def test_other_key_is_refused_by_the_pin_not_the_signature(self):
        r = self.con.check("rover", "rover", "swapkey")
        self.assertEqual(r["verdict"], "INVALID", r)
        ws = r["by_seq"].get("1", [])
        self.assertTrue(any(w.startswith("key: signed by") for w in ws), r)
        self.assertFalse(any(w.startswith("signature:") for w in ws), r)


class Permits(Base):
    def test_grant_n_gives_n_and_use_takes_one(self):
        self.con.grant("reporter", "send-report", 3)
        self.assertEqual(self.con.row("reporter")["may"], [{"action": "send-report", "left": 3}])
        self.con.use("reporter", "send-report")
        self.assertEqual(self.con.row("reporter")["may"], [{"action": "send-report", "left": 2}])
        self.assertEqual(self.con.check("reporter", "reporter")["verdict"], "VALID")

    def test_grant_bounds(self):
        for bad in (0, console.MAX_PER_GRANT + 1, "2", True):
            with self.assertRaises(console.Refused):
                self.con.grant("arm", "read-sensor", bad)
        with self.assertRaises(console.Refused):
            self.con.grant("arm", "fly", 1)
        with self.assertRaises(console.Refused):
            self.con.grant(["arm"], "read-sensor", 1)

    def test_no_use_left_is_refused(self):
        with self.assertRaisesRegex(console.Refused, "no use of open-gate left"):
            self.con.use("arm", "open-gate")


class States(Base):
    def test_pause_refuses_then_resume(self):
        self.con.pause("arm")
        with self.assertRaisesRegex(console.Refused, "paused"):
            self.con.use("arm", "read-sensor")
        with self.assertRaisesRegex(console.Refused, "paused"):
            self.con.grant("arm", "read-sensor", 1)
        self.con.pause("arm")
        self.assertEqual(self.con.row("arm")["state"], "active")

    def test_revoke_destroys_the_key_and_stays(self):
        self.con.grant("reporter", "read-sensor", 1)
        self.con.revoke("reporter")
        self.assertFalse(os.path.exists(os.path.join(self.con.device, "reporter", "device.key")))
        with self.assertRaisesRegex(console.Refused, "revoked"):
            self.con.use("reporter", "read-sensor")
        with self.assertRaisesRegex(console.Refused, "stays revoked"):
            self.con.pause("reporter")
        with open(os.path.join(self.con.work, "console.json")) as f:
            self.assertEqual(json.load(f)["reporter"]["state"], "revoked")


class Server(Base):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        import http.server
        cls.srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), None)
        cls.port = cls.srv.server_address[1]
        cls.srv.RequestHandlerClass = console.make_handler(cls.con, cls.port)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()
        super().tearDownClass()

    def req(self, method, path, body=None, headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        c.request(method, path, body=body, headers=headers or {})
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, data

    def test_bound_to_loopback(self):
        self.assertEqual(self.srv.server_address[0], "127.0.0.1")

    def test_other_host_is_refused(self):
        self.assertEqual(self.req("GET", "/state", headers={"Host": "example.org"})[0], 403)

    def test_other_origin_and_non_json_are_refused(self):
        h = {"Content-Type": "application/json", "Origin": "http://example.org"}
        self.assertEqual(self.req("POST", "/pause", json.dumps({"agent": "arm"}), h)[0], 403)
        self.assertEqual(self.req("POST", "/pause", "agent=arm", {"Content-Type": "application/x-www-form-urlencoded"})[0], 415)
        self.assertEqual(self.con.row("arm")["state"], "active")

    def test_state_and_check_over_http(self):
        s, data = self.req("GET", "/state")
        self.assertEqual(s, 200)
        self.assertEqual([a["slug"] for a in json.loads(data)["agents"]], ["rover", "arm", "reporter"])
        s, data = self.req("POST", "/check", json.dumps({"log": "rover", "key": "rover", "cheat": "nope"}), {"Content-Type": "application/json"})
        self.assertEqual(s, 400)


class Page(unittest.TestCase):
    with open(os.path.join(HERE, "page.html"), encoding="utf-8") as f:
        page = f.read()

    def test_the_console_uses_the_same_colour_tokens_as_the_simulation_page(self):
        # The two demos are one style (../robot-sim/DESIGN.md): the light token line must be the same.
        def tokens(text):
            m = re.search(r':root, \[data-theme="light"\] \{([^}]*)\}', text)
            self.assertIsNotNone(m, "no light token line")
            return " ".join(m.group(1).split())
        with open(os.path.join(HERE, "..", "robot-sim", "page.html"), encoding="utf-8") as f:
            sim = f.read()
        self.assertEqual(tokens(self.page), tokens(sim))

    def ja(self):
        body = self.page.split("const JA = {", 1)[1].split("\n};", 1)[0]
        return dict(re.findall(r'^\s*"((?:[^"\\]|\\.)*)": "((?:[^"\\]|\\.)*)",?', body.replace('", "', '",\n "'), re.M))

    def test_every_control_has_a_label(self):
        for cid in re.findall(r'<(?:select|input)[^>]*\bid="([^"]+)"', self.page):
            self.assertIn(f'<label for="{cid}"', self.page, cid)

    def test_every_string_has_japanese(self):
        ja = self.ja()
        need = set(re.findall(r'data-t="([^"]+)"', self.page)) | set(console.NOT_SHOWN) | set(console.notebook.SHOWS)
        need |= set(re.findall(r'\bt\("((?:[^"\\]|\\.)*)"', self.page))
        self.assertEqual(sorted(need - set(ja)), [])

    def test_not_live_is_marked_in_japanese(self):
        self.assertEqual(self.ja()["planned"], "設計中")

    def test_no_money_words(self):
        low = self.page.lower() + " ".join(console.NOT_SHOWN).lower()
        for w in ("earn", "reward", "money", "price", "profit", "payment", "token", "invest", "報酬", "稼", "お金", "収益", "価格"):
            self.assertNotIn(w, low, w)


if __name__ == "__main__":
    unittest.main()
