// Which language a page opens in (app/lib/pick_lang.ts): `?lang=`, else the visitor's earlier choice
// on this device, else the browser's languages (what it sends as Accept-Language), else English.
// Controls: a remembered English choice beats a Japanese browser; a link's ?lang= beats both.
import assert from "node:assert/strict";
import { pickLang, fromBrowser } from "../app/lib/pick_lang.ts";

let failed = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message.split("\n")[0]}`);
  }
};
check("first visit follows the browser", () => {
  assert.equal(pickLang(null, null, ["ja-JP", "en"]), "ja");
  assert.equal(pickLang(null, null, ["zh-HK"]), "zh-HK");
  assert.equal(pickLang(null, null, ["zh-TW", "en"]), "zh-HK");
  assert.equal(pickLang(null, null, ["fr-FR", "ja"]), "ja");
  assert.equal(pickLang(null, null, ["en-GB", "ja"]), "en");
  assert.equal(pickLang(null, null, ["fr", "de"]), "en");
  assert.equal(pickLang(null, null, []), "en");
});
check("the visitor's earlier choice wins over the browser, English included", () => {
  assert.equal(pickLang(null, "en", ["ja-JP"]), "en");
  assert.equal(pickLang(null, "zh-HK", ["ja-JP"]), "zh-HK");
});
check("?lang= in a link wins over both", () => {
  assert.equal(pickLang("ja", "en", ["en"]), "ja");
  assert.equal(pickLang("en", "ja", ["ja"]), "en");
  assert.equal(pickLang("zh-hk", null, ["en"]), "zh-HK");
});
check("junk values are ignored", () => {
  assert.equal(pickLang("xx", "yy", ["ja"]), "ja");
  assert.equal(fromBrowser(["*"]), null);
});
check("control: ignoring the stored choice would be caught", () => {
  const bad = (q, s, b) => pickLang(q, null, b);
  assert.notEqual(bad(null, "en", ["ja-JP"]), "en");
});
// The provider uses pickLang and remembers English too.
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../app/try/i18n.tsx", import.meta.url), "utf8");
check("the provider picks with pickLang and stores every choice", () => {
  assert.match(src, /pickLang\(new URLSearchParams\(window\.location\.search\)\.get\("lang"\), getUi\("tet\.ui\.v1\.lang"\), navigator\.languages/);
  assert.match(src, /setUi\("tet\.ui\.v1\.lang", l\);/);
});
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
