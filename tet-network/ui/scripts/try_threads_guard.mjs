import { readFileSync } from "node:fs";
// Guard for Try TET board threads (app/lib/board_threads.mjs): the page's own code, plain Node.
//
//   node scripts/try_threads_guard.mjs
//
// SECURITY properties:
// 1. Only the first line is a header: whatever a body contains, it never starts a thread, moves the
//    post to another thread, or sets a title. Control: a parser that looks for the header on any
//    line → FAILED.
// 2. A title is one line and bounded: a title with a newline (which would forge the body
//    boundary) is refused when posting and ignored when reading.
// 3. A thread's title comes from its earliest titled post; a later post that also carries a title
//    does not rename it. Control: a "last title wins" grouping → FAILED.
// 4. Posts without a header never join a thread.
// 5. sage: a sage reply doesn't bump its thread; only the header can sage (a body saying "sage"
//    doesn't), and a thread's opener can't be sage. Control: bumping on every post → FAILED.

import assert from "node:assert/strict";

const t = await import("../app/lib/board_threads.mjs");

let failed = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e instanceof Error ? e.message : String(e)}`);
  }
}

const A = "0123456789abcdef";
const B = "fedcba9876543210";
let n = 0;
const post = (text, sentAtMs) => ({ msgId: `m${String(++n).padStart(3, "0")}`, sentAtMs, text });

await check("a thread post round-trips: id, title, body", () => {
  const opener = t.parseThreadPost(t.encodeThreadPost({ threadId: A, title: "Exam notes", body: "line 1\n\nline 3" }));
  assert.deepEqual(opener, { threadId: A, title: "Exam notes", sage: false, name: "", body: "line 1\n\nline 3" });
  const reply = t.parseThreadPost(t.encodeThreadPost({ threadId: A, body: ">>1 thanks" }));
  assert.deepEqual(reply, { threadId: A, title: null, sage: false, name: "", body: ">>1 thanks" });
  const sage = t.parseThreadPost(t.encodeThreadPost({ threadId: A, body: "quiet reply", sage: true }));
  assert.deepEqual(sage, { threadId: A, title: null, sage: true, name: "", body: "quiet reply" });
});

/** The property in (1), run against a parser. */
function bodyCannotForge(parse) {
  const forged = `hello\n${t.THREAD_HEADER} ${B}\ntitle: Hijacked\n\nbody`;
  const asReply = t.encodeThreadPost({ threadId: A, body: forged });
  const r = parse(asReply);
  assert.equal(r.threadId, A, "the post moved to another thread");
  assert.equal(r.title, null, "a body set a title");
  assert.equal(r.body, forged, "the body changed");
  const plain = parse(forged);
  assert.equal(plain.threadId, null, "a body line started a thread");
}

await check("SECURITY: only the first line is a header; a body cannot start, move or title a thread", () => {
  bodyCannotForge(t.parseThreadPost);
});

await check("control: a parser that finds the header on any line is caught", () => {
  const sloppy = (text) => {
    const lines = String(text).split("\n");
    const i = lines.findIndex((l) => /^tet-thread v1 [0-9a-f]{16}$/.test(l));
    if (i === -1) return { threadId: null, title: null, body: text };
    const id = lines[i].split(" ")[2];
    const title = /^title: /.test(lines[i + 1] ?? "") ? lines[i + 1].slice(7) : null;
    return { threadId: id, title, body: lines.slice(i + (title ? 3 : 2)).join("\n") };
  };
  assert.throws(() => bodyCannotForge(sloppy));
});

await check("SECURITY: a title is one bounded line, refused when posting and ignored when reading", () => {
  assert.throws(() => t.encodeThreadPost({ threadId: A, title: "a\nb", body: "x" }), /one line/);
  assert.throws(() => t.encodeThreadPost({ threadId: A, title: "x".repeat(t.THREAD_TITLE_MAX + 1), body: "x" }), /at most/);
  assert.throws(() => t.encodeThreadPost({ threadId: A, title: "   ", body: "x" }), /needs a title/);
  const long = `${t.THREAD_HEADER} ${A}\ntitle: ${"x".repeat(t.THREAD_TITLE_MAX + 1)}\n\nbody`;
  assert.equal(t.parseThreadPost(long).title, null);
  assert.throws(() => t.encodeThreadPost({ threadId: "not-hex", body: "x" }), /thread id/);
});

/** The property in (3), run against a grouping. */
function earliestTitleWins(group) {
  const ps = [
    post(t.encodeThreadPost({ threadId: A, title: "Original", body: "first" }), 1000),
    post(t.encodeThreadPost({ threadId: A, title: "Renamed", body: "later" }), 2000),
    post(t.encodeThreadPost({ threadId: A, body: "reply" }), 3000),
  ];
  const [th] = group(ps);
  assert.equal(th.title, "Original");
  assert.deepEqual(
    th.posts.map((p) => p.body),
    ["first", "later", "reply"],
  );
}

await check("SECURITY: a thread's title is its earliest titled post; a later title doesn't rename it", () => {
  earliestTitleWins(t.groupThreads);
});

await check("control: a last-title-wins grouping is caught", () => {
  const lastWins = (ps) =>
    t.groupThreads(ps).map((th) => ({ ...th, title: [...th.posts].reverse().find((p) => p.title)?.title ?? null }));
  assert.throws(() => earliestTitleWins(lastWins));
});

await check("threads list by last post; posts number per thread; unthreaded posts stay apart, listed last", () => {
  const ps = [
    post("an old post from before threads", 500),
    post(t.encodeThreadPost({ threadId: A, title: "Quiet", body: "a1" }), 1000),
    post(t.encodeThreadPost({ threadId: B, title: "Busy", body: "b1" }), 1500),
    post(t.encodeThreadPost({ threadId: A, body: "a2" }), 2000),
    post(t.encodeThreadPost({ threadId: B, body: "b2" }), 3000),
    post(`${t.THREAD_HEADER} nothex\n\nnot a header`, 3500),
  ];
  const ths = t.groupThreads(ps);
  assert.deepEqual(
    ths.map((x) => [x.threadId, x.title, x.count]),
    [
      [B, "Busy", 2],
      [A, "Quiet", 2],
      ["", null, 2],
    ],
  );
  assert.equal(ths[0].lastAtMs, 3000);
  assert.deepEqual(
    ths[1].posts.map((p) => p.body),
    ["a1", "a2"],
  );
});

await check("a thread whose opener dropped out has no title (the notice explains why)", () => {
  const [th] = t.groupThreads([post(t.encodeThreadPost({ threadId: A, body: "reply only" }), 1000)]);
  assert.equal(th.title, null);
});

await check("thread ids are 16 hex and differ", () => {
  const a = t.newThreadId();
  const b = t.newThreadId();
  assert.match(a, /^[0-9a-f]{16}$/);
  assert.notEqual(a, b);
});

/** The property in (5), run against a grouping. */
function sageDoesNotBump(group) {
  const ps = [
    post(t.encodeThreadPost({ threadId: A, title: "Older", body: "a1" }), 1000),
    post(t.encodeThreadPost({ threadId: B, title: "Newer", body: "b1" }), 2000),
    post(t.encodeThreadPost({ threadId: A, body: "quiet", sage: true }), 3000), // sage: A stays below B
    post(t.encodeThreadPost({ threadId: B, body: "sage" }), 2500), // a body saying sage bumps normally
  ];
  const ths = group(ps);
  assert.deepEqual(
    ths.map((x) => x.title),
    ["Newer", "Older"],
  );
  assert.equal(ths[1].count, 2, "the sage post is still in its thread");
  assert.equal(ths[1].lastAtMs, 3000, "last post time still shows the sage post");
}

await check("sage: a sage reply doesn't bump; a body saying sage does; posts still count", () => {
  sageDoesNotBump(t.groupThreads);
});

await check("control: a grouping that bumps on every post is caught", () => {
  const alwaysBump = (ps) => t.groupThreads(ps).sort((a, b) => b.lastAtMs - a.lastAtMs);
  assert.throws(() => sageDoesNotBump(alwaysBump));
});

await check("a thread's opener can't be sage", () => {
  const opener = t.parseThreadPost(`${t.THREAD_HEADER} ${A} sage\ntitle: x\n\nbody`);
  assert.equal(opener.sage, false);
  assert.ok(!t.encodeThreadPost({ threadId: A, title: "x", body: "y", sage: true }).startsWith(`${t.THREAD_HEADER} ${A} sage`));
});

await check("kiriban marks 100, 200 … 1000, nothing else", () => {
  assert.deepEqual(
    [1, 99, 100, 101, 200, 999, 1000, 1001].filter(t.isKiriban),
    [100, 200, 1000],
  );
});

await check("AA is recognised by its spacing or drawing characters; ordinary posts are not", () => {
  assert.ok(t.looksLikeAA("　 ∧＿∧\n （　´∀｀）\n （　　　　）"));
  assert.ok(t.looksLikeAA("┌──┐\n│ok│\n└──┘"));
  assert.ok(!t.looksLikeAA("one line, no art"));
  assert.ok(!t.looksLikeAA("Two lines.\nJust text, with >>1 and a URL https://x.y/z"));
});

// ── Display names: optional, cleaned, never mistaken for body text ─────────────────────────────
function namesSafe(clean, parse, encode) {
  const p = parse(encode({ threadId: A, title: "T", name: "モナー", body: "hi" }));
  assert.equal(p.name, "モナー");
  assert.equal(p.body, "hi");
  assert.equal(clean("a\u202eb\u0000c\nd"), "abcd", "bidi overrides and control characters are removed");
  assert.equal([...clean("x".repeat(100))].length, t.NAME_MAX, "a name is capped");
  // A body that starts with "name:" is body text, not a name.
  const q = parse(encode({ threadId: A, body: "name: spoof\nreal text" }));
  assert.equal(q.name, "");
  assert.equal(q.body, "name: spoof\nreal text");
}
await check("a display name round-trips cleaned, and a body can't pose as one", () => namesSafe(t.cleanName, t.parseThreadPost, t.encodeThreadPost));
await check("control: a name cleaner that keeps bidi overrides is caught", () => {
  assert.throws(() => namesSafe((x) => String(x).trim(), t.parseThreadPost, t.encodeThreadPost));
});

// ── Names can't pose as an ID or a label, and never ride on an anonymous post ──────────────────
function namesCantSpoof(clean) {
  for (const bad of ["0lbabab8", "O1babab8", "01ba-bab8", "An0nymous", "Anonyrnous", "Verlfied", "1D ab12", "lD:ab12", "Anon\u{E0100}ymous", "01ba\u{E0100}bab8", "Anon\u{E0041}ymous", "An\u0585nymous", "\u13AAnonymous", "\u00c1nonymous", "Ano\u0301nymous", "01\u044c\u0430\u044c\u0430\u044c8", "0\u0251b\u0251b\u0251b8", "Anon\u180bymous", "01babab\u20338", "01b\u0430b\u0430b8", "\u0410n\u043enym\u043eus", "名 無しさん", "名・無しさん", "N o n a m e", "id 01ba", "01babab8", "ID:01ba bab8", "ab12 cd34", "Anonymous", "名無しさん", "匿名", "記名", "anonymous · verified", "ＩＤ：ａｂ１２ｃｄ", "Mo\u200bnar\u200b ab\u200b12cd"]) {
    // Either no name, or what's left (allowed characters only) reads as neither an ID nor a label.
    const c = clean(bad);
    assert.ok(c === "" || (!/[0-9a-f]{6,}/i.test(c.replace(/[^0-9A-Za-z]/g, "")) && !/anonymous|verified|named|\bid\b|名無し|匿名|記名/i.test(c)), `"${bad}" → "${c}" passes for an ID or a label`);
  }
  assert.equal(clean("Mo\u200bnar"), "Monar", "zero-width characters are removed");
  assert.equal(clean("モナー"), "モナー");
  assert.equal(clean("Sakura 2"), "Sakura 2");
  for (const ok of ["Ida", "陈小明", "김철수", "モナーA", "ひろゆきX", "佐々木", "Sakura 2"]) assert.equal(clean(ok), ok, `an ordinary name "${ok}" is refused`);
  assert.equal(clean("José"), "Jose", "accents come off");
  assert.equal(clean("ＭＯＮＡ"), "MONA", "full width is normalised");
  assert.equal(clean("ｶﾞｯ"), "ガッ", "half-width kana is normalised");
  // Outside the allowed ranges, a name is dropped (decision: Cyrillic and Greek names show as 名無しさん).
  assert.equal(clean("Иван"), "");
}
await check("a name can't pose as an ID or a status label", () => namesCantSpoof(t.cleanName));

// Every name the parser shows is exactly what the cleaner makes, whether the post came from the
// encoder or was written by hand: no input is read one way by one and another way by the other.
function noNameDifferential(clean, parse, encode, n) {
  const pool = ["\u{E0100}", "\u{E0041}", "\u180b", "\u0301", "\u0585", "\u13aa", "a", "Z", "0", "9", "b", " ", "\r", "\u2028", "\u2029", "\u0085", "\u00a0", "\u3000", "\u200b", "\u202e", "\ufeff", "ﾃ", "Ⅸ", "ﬁ", "①", "e\u0301", "名", "無", "し", "：", "title: ", "name: ", "\t", "𝟎", "\u0430", "\u03bf"];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < n; i++) {
    let s = "";
    for (let k = 1 + Math.floor(rnd() * 8); k > 0; k--) s += pool[Math.floor(rnd() * pool.length)];
    const c = clean(s);
    assert.equal(clean(c), c, `cleaning isn't stable for ${JSON.stringify(s)}`);
    const viaEncoder = parse(encode({ threadId: A, name: s, body: "B" }));
    assert.equal(viaEncoder.name, c, `encoded ${JSON.stringify(s)}`);
    assert.equal(viaEncoder.body, "B");
    const byHand = parse(`${t.THREAD_HEADER} ${A}\nname: ${s.replace(/\n/g, "")}\n\nB`);
    assert.equal(byHand.name, clean(s.replace(/\n/g, "")), `hand-written ${JSON.stringify(s)}`);
  }
}
// A name holds only the allowed code points, whatever comes in: the same in every browser.
function onlyAllowed(clean, n) {
  const ok = /^[A-Za-z0-9 ._'!?&\-\u3005\u3041-\u3096\u309d\u309e\u30a1-\u30fa\u30fb\u30fc-\u30fe\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3]*$/u;
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < n; i++) {
    let s = "";
    for (let k = 1 + Math.floor(rnd() * 10); k > 0; k--) {
      // Mostly anywhere in Unicode, sometimes plain ASCII so real names are in the mix.
      const cp = rnd() < 0.3 ? 0x20 + Math.floor(rnd() * 0x5f) : Math.floor(rnd() * 0x10ffff);
      if (cp >= 0xd800 && cp <= 0xdfff) continue;
      s += String.fromCodePoint(cp);
    }
    const c = clean(s);
    assert.match(c, ok, `${JSON.stringify(s)} → ${JSON.stringify(c)} holds a character outside the allowed ranges`);
  }
}
await check("SECURITY: a name holds only the allowed code points (50,000 random inputs)", () => onlyAllowed(t.cleanName, 50000));
await check("control: a blocklist cleaner (the previous design) is caught", () =>
  assert.throws(() => onlyAllowed((x) => String(x).replace(/[\u0000-\u001f\u200b-\u200f\u202a-\u202e]/g, "").trim(), 50000)),
);

await check("SECURITY: no name is read differently by the parser and the cleaner (20,000 inputs)", () =>
  noNameDifferential(t.cleanName, t.parseThreadPost, t.encodeThreadPost, 20000),
);
await check("control: a parser whose name line stops at \\r is caught", () => {
  const narrow = (x) => {
    const r = t.parseThreadPost(x);
    const line = String(x).split("\n")[1] ?? "";
    return /^name: .*$/.test(line) ? r : { ...r, name: "" };
  };
  assert.throws(() => noNameDifferential(t.cleanName, narrow, t.encodeThreadPost, 20000));
});
await check("control: a cleaner that only trims is caught", () => assert.throws(() => namesCantSpoof((x) => String(x).trim())));

const BOARD = readFileSync(new URL("../app/try/BoardPanel.tsx", import.meta.url), "utf8");
function anonPostsUnnamed(src) {
  assert.match(src, /const \[named, setNamed\] = useState\(false\);/, "posting is not anonymous by default");
  assert.match(src, /encodeThreadPost\(\{[^}]*name: anonymous \? "" : name[^}]*\}\)/, "an anonymous post can carry a name");
  assert.match(src, /if \(!p\.label\.author\) return t\("Anonymous"\);/, "a name on an anonymous post is shown");
  assert.match(src, /return p\.name \|\| t\("No name"\);/, "a named post without a name is labelled anonymous");
}
await check("posts are anonymous by default, anonymous posts carry and show no name", () => anonPostsUnnamed(BOARD));
await check("control: a named default, or a name on anonymous posts, is caught", () => {
  assert.throws(() => anonPostsUnnamed(BOARD.replace("const [named, setNamed] = useState(false);", "const [named, setNamed] = useState(true);")));
  assert.throws(() => anonPostsUnnamed(BOARD.replace('name: anonymous ? "" : name', "name")));
  assert.throws(() => anonPostsUnnamed(BOARD.replace('return p.name || t("No name");', 'return p.name || t("Anonymous");')));
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
