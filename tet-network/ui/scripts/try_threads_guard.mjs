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

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
