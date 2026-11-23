#!/usr/bin/env python3
"""Tests for the home-permit scene, through the real notebook.py, the two-party sketch and tet-cli;
nothing mocked and nothing skipped. Each refusal test asserts the one exact reason, on an input that
passes every earlier check.

    TET_CLI=/path/to/tet-cli python3 prep/demos/home-permit/test_scene.py
"""

import json
import os
import re
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scene as sc  # noqa: E402

tp = sc.tp


class Scene(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.path.isfile(sc.tp.cli()):
            raise RuntimeError(f"tet-cli not found at {sc.tp.cli()}; set TET_CLI")  # an error, never a skip
        cls.work = tempfile.mkdtemp(prefix="home-permit-test-")
        cls.s = sc.Scene(cls.work)
        cls.out = cls.s.run()
        cls.h = cls.s.party(cls.s.R, "H")
        cls.n = cls.s.party(cls.s.R, "N")

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.work)

    def test_outside_check_is_valid_as_promised_and_the_permit_is_cited_once(self):
        hon = self.s.honest
        self.assertEqual((hon["problems"], hon["notes"]), ([], []))
        self.assertEqual(hon["raw"], ("SIGNATURES: valid", "LOGS: as promised"))
        self.assertEqual(hon["cited"], 1)
        rec = tp.decode(self.s.R)
        self.assertEqual((rec["summary"], rec["permit.party"], rec["permit.id"]), (sc.REQUEST, self.h, self.s.permit_id))

    def test_the_checker_reads_pins_held_outside_the_folders(self):
        exports, pins = self.s.handed_over()
        for n in ("H", "N"):
            self.assertEqual(pins[n], self.s.pin[n])
            self.assertFalse(os.path.exists(os.path.join(exports[n], "device.pin")))
            self.assertFalse(os.path.exists(os.path.join(exports[n], "device.key")))

    def test_second_request_with_the_same_permit_is_refused_by_h_for_reuse(self):
        seq = tp.decode(self.s.R)[self.h + ".seq"]
        self.assertEqual(self.s.refusal, "append: notebook.py record refused: error: not recorded: "
                         f"permit: {self.s.permit_id} was already used by record {seq}")

    def test_every_step_shows_the_permit_and_after_the_second_request_it_reads_used(self):
        seq = tp.decode(self.s.R)[self.h + ".seq"]
        for step in self.out["steps"]:
            self.assertEqual(len(step.get("permit") or []), 2, step["id"])  # EN and JA, on every step
        labels = {st["id"]: st["permit"] for st in self.out["steps"]}
        self.assertEqual(labels["permit"], ["Permit: 1, unused", "許可 1 件: 未使用"])
        for sid in ("agree", "hand", "again", "check", "tamper-1", "tamper-2"):
            self.assertTrue(labels[sid][0].startswith(f"Permit: 1, used by record {seq} in H's notebook"), sid)
            self.assertTrue(labels[sid][1].startswith(f"許可 1 件: H のノートの記録 {seq} で使用済み"), sid)
            self.assertNotIn("unused", labels[sid][0])
        self.assertIn("a second request citing it was refused", labels["again"][0])

    def test_again_step_says_both_signed_then_h_refused_the_write_and_both_aborted(self):
        step = [st for st in self.out["steps"] if st["id"] == "again"][0]
        for part in ("Both sides check the new record and both sign it.",
                     "Then H's notebook refuses to write it: the permit was already used.",
                     "Both sides write an abort entry at its position."):
            self.assertIn(part, step["en"])
        for part in ("両方が新しい記録を確かめ、両方が署名する。", "そのあと H のノートが書き込みを拒否する",
                     "両方が、その位置に中止の項目を書く。"):
            self.assertIn(part, step["ja"])
        self.assertEqual(step["lines"], ["both signatures given: H, N", self.s.refusal, "abort entry written: H, N"])
        self.assertNotRegex(step["en"] + step["ja"], r"(?i)refuses? to sign|refused to sign|署名を拒否|署名しない")

    def test_tamper_summary_resigned_by_n_is_refused_on_h_signature(self):
        t = self.s.tamper1
        sig_problems = [p for p in t["problems"] if not isinstance(p, tp.LogConflict)]
        self.assertEqual(sig_problems, [f"{self.h}: signature: record is not the {len(self.s.R)} bytes this envelope signed"])
        self.assertEqual([p for p in t["problems"] if isinstance(p, tp.LogConflict)],
                         [f"{p}: record {tp.decode(t['record'])[p + '.seq']} is not this record" for p in (self.h, self.n)])  # check() lists them in pin order: H, then N
        # Every earlier check passes: the changed record decodes, names both pins, and N's new signature is good.
        self.assertEqual(tp.decode(t["record"])["summary"], sc.OTHER)
        self.assertIsNone(tp.signature_problem(t["record"], t["sigs"][self.n], t["pins"]["N"], sc.nb.chain_env(t["exports"]["N"])))
        self.assertEqual(t["raw"][0], "SIGNATURES: invalid")

    def test_dropped_record_at_h_is_a_log_conflict_at_h_not_a_bad_signature(self):
        t = self.s.tamper2
        seq = int(tp.decode(self.s.R)[self.h + ".seq"])
        self.assertEqual((t["problems"], t["notes"]), ([f"{self.h}: log ends at record {seq - 1}, before record {seq}"], []))
        self.assertIsInstance(t["problems"][0], tp.LogConflict)
        self.assertEqual(t["shown"], ("SIGNATURES: valid", "LOGS: conflict at H (cause not shown)"))
        step = [s for s in self.out["steps"] if s["id"] == "tamper-2"][0]
        self.assertIn(sc.FORGERY_LINE + " / 食い違いは偽造の判定ではありません", step["lines"])

    def test_scene_text_keeps_the_wording_rules(self):
        text = json.dumps(self.out, ensure_ascii=False)
        assert_wording(self, text)
        self.assertEqual(self.out["banner"], "simulation: no robot moved")


FORBIDDEN = [
    (r"(?i)nurse\s+signed|看護師が署名", "a person signed"),
    (r"(?i)\bfirst\b|初めて|世界初", "first"),
    (r"(?i)\b(pay|paid|payment|price|cost|money|fee|cash|yen|dollars?|euros?)\b|[$€¥]\s?[0-9]|円|料金|支払|お金", "money"),
    (r"\b20[0-9]{2}-[0-9]{2}-[0-9]{2}\b|[0-9]{4}年|[0-9]+月[0-9]+日", "a date"),
    (r"(?i)\b(owns?|holds?|held by)\b[^.]{0,30}\bkey\b|key (is )?(owned|held) by", "who holds a key"),
    (r"(?i)(?<!not a )safety device", "a safety claim"),
]


def assert_wording(tc, text):
    for pat, what in FORBIDDEN:
        tc.assertIsNone(re.search(pat, text.replace("not show who holds a key", "")), f"wording: {what}")


class Page(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(HERE, "page.html"), encoding="utf-8") as f:
            cls.page = f.read()

    def test_banner_is_on_screen_outside_every_step(self):
        m = re.search(r'<p id="banner"[^>]*>([^<]*)</p>', self.page)
        self.assertIsNotNone(m)
        self.assertEqual(m.group(1), "simulation: no robot moved")
        self.assertNotRegex(m.group(0), r"hidden|display:\s*none")
        self.assertRegex(self.page, r"#banner \{ position:sticky; top:0;")
        self.assertNotIn("banner", self.page.split("<script", 1)[1])  # no script touches it

    def test_page_has_the_not_judged_list_in_both_languages(self):
        for ja in ("人が命令を決めたか: 確認が判定するのは、どの鍵が署名したか。人や組織は判定しない。",
                   "ロボットがその動作をしたか、安全だったか: 判定しない。記録は取り決めについてで、動作についてではない。",
                   "いつ起きたか: 各ログの中の順序だけ。日付は判定しない。",
                   "許可の条件: 許可は H 自身のノートが出したもので、条件は記録に入っていない。",
                   "同じ許可の、他のノートでの使用: 判定しない。",
                   "これは安全装置ではない。"):
            self.assertIn(ja, self.page)
        not_judged = self.page.split('<ul id="not-judged">', 1)[1].split("</ul>", 1)[0]
        self.assertEqual(not_judged.count("<li>"), 6)
        self.assertIn("<li>Use of the same permit in another notebook: not judged.", not_judged)
        judged = self.page.split('<ul id="judged">', 1)[1].split("</ul>", 1)[0]
        self.assertEqual(judged.count("<li>"), 1)
        self.assertIn("<li>A second use of the permit inside H's log.", judged)
        self.assertNotIn("up to once", self.page)

    def test_page_says_the_keys_are_test_keys_in_software_in_a_simulation(self):
        m = re.search(r'<p id="test-keys">([^<]*)</p>\s*<p class="ja">([^<]*)</p>', self.page)
        self.assertIsNotNone(m)
        for word in ("test keys", "software", "simulation"):
            self.assertIn(word, m.group(1))
        for word in ("テスト用の鍵", "ソフトウェア", "シミュレーション"):
            self.assertIn(word, m.group(2))

    def test_page_shows_each_step_s_own_permit_label(self):
        self.assertIn("const [en, ja] = step.permit || [", self.page)
        self.assertNotIn("if (step.permit)", self.page)

    def test_page_uses_only_the_vendored_three_and_fetches_nothing_remote(self):
        self.assertIn('"three": "../robot-sim/px4/vendor/three/three.module.js"', self.page)
        self.assertTrue(os.path.isfile(os.path.join(HERE, "..", "robot-sim", "px4", "vendor", "three", "three.module.js")))
        self.assertNotRegex(self.page, r"(?i)https?://|//cdn|\.glb|\.gltf|mujoco")
        self.assertEqual(re.findall(r'fetch\("([^"]+)"', self.page), ["out/scene.json"])

    def test_page_and_readme_keep_the_wording_rules(self):
        assert_wording(self, self.page)
        with open(os.path.join(HERE, "README.md"), encoding="utf-8") as f:
            assert_wording(self, f.read())


if __name__ == "__main__":
    unittest.main(verbosity=2)
