// Try TET boards: threads (スレ), as a convention inside the post text. No node change: the node
// stores a board post as an encrypted Tmail message and never sees a thread.
//
// A thread post's plaintext is
//
//     tet-thread v1 <16 hex id>[ sage]
//     title: <one line>            (only on the post that opens the thread)
//
//     <body>
//
// - **Only the first line can be a header,** and a title is one line. So a body can never start a
//   thread, switch threads or set a title, whatever it contains.
// - **Anyone who can read the board can post in any thread or open one.** A thread id is random and
//   chosen by its opener; it is not a secret and not an access control.
// - **A thread's title is the first one the node still has:** the earliest post carrying a title,
//   ties broken by message id. The sender sets a post's time, so a later post claiming an earlier
//   time could set the title of a thread whose opener has dropped out. The notice says so.
// - Posts without a header (from before threads) form one group, "posts without a thread".
// - **sage** (2ch): a reply whose header ends in " sage" doesn't bump its thread up the list. Only
//   the header can sage a post; a body saying "sage" is just text.
//
// Plain ESM with no I/O, so the guard runs the page's own code (scripts/try_threads_guard.mjs).

export const THREAD_HEADER = "tet-thread v1";
/** The longest thread title. */
export const THREAD_TITLE_MAX = 80;

const HEADER_RE = /^tet-thread v1 ([0-9a-f]{16})( sage)?$/;
const TITLE_RE = /^title: (.*)$/;

/** A new random thread id (8 bytes, hex). */
export function newThreadId() {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Normalise a title, or explain why it can't be one. */
export function checkThreadTitle(title) {
  const t = String(title ?? "").trim();
  if (!t) return { ok: false, reason: "A thread needs a title." };
  if (/[\r\n]/.test(t)) return { ok: false, reason: "A title is one line." };
  if ([...t].length > THREAD_TITLE_MAX) return { ok: false, reason: `A title is at most ${THREAD_TITLE_MAX} characters.` };
  return { ok: true, title: t };
}

/** The most characters a display name holds. */
export const NAME_MAX = 32;
// The rest of the line, whatever it holds (cleanName decides what's shown), so a raw name line
// can't be read one way here and another way by the cleaner.
const NAME_RE = /^name: ([^\n]*)$/;
const RESERVED = /\bid\b|anonymous|verified|named|noname|no name|proof|名無し|匿名|記名|検証|無名|具名|證明|証明/i;
/** Cyrillic and Greek letters that look like Latin ones (and O/o like 0), for the skeleton check. */
const LOOKALIKE = Object.fromEntries(
  [..."аеорсухіјѕԁԛԝАВЕКМНОРСТХІЈЅοΟνΑΒΕΖΗΙΚΜΝΡΤΥΧ"].map((c, i) => [c, "aeopcyxijsdqwABEKMHOPCTXIJSoOvABEZHIKMNPTYX"[i]]),
);

/**
 * A display name as shown: trimmed, without control or bidi-override characters (which could make
 * text display reversed), at most NAME_MAX characters; "" means none (shown as 名無しさん /
 * Anonymous). Names aren't checked by anyone: the page always shows the post's ID beside it.
 * @param {unknown} raw
 */
export function cleanName(raw) {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u061c\u115f\u1160\u17b4\u17b5\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\u3164\ufe00-\ufe0f\ufeff\uffa0]/g, "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim();
  const name = [...s].slice(0, NAME_MAX).join("");
  // A name that could pass for an ID or a status label is no name: checked on its skeleton (no
  // spaces or punctuation, look-alike Cyrillic and Greek letters read as Latin), and a name that
  // mixes Latin with Cyrillic or Greek letters is refused outright (the usual look-alike trick).
  const latin = /\p{Script=Latin}/u.test(name);
  if (latin && /[\p{Script=Cyrillic}\p{Script=Greek}]/u.test(name)) return "";
  const skeleton = [...name.replace(/[\s\p{P}\p{S}]/gu, "")].map((c) => LOOKALIKE[c] ?? c).join("");
  if (/[0-9a-f]{6,}/i.test(skeleton) || RESERVED.test(skeleton) || RESERVED.test(name)) return "";
  return name;
}

export function encodeThreadPost(o) {
  if (!/^[0-9a-f]{16}$/.test(o.threadId ?? "")) throw new Error("bad thread id");
  const lines = [`${THREAD_HEADER} ${o.threadId}${o.sage && o.title == null ? " sage" : ""}`];
  if (o.title != null) {
    const c = checkThreadTitle(o.title);
    if (!c.ok) throw new Error(c.reason);
    lines.push(`title: ${c.title}`);
  }
  const name = cleanName(o.name);
  if (name) lines.push(`name: ${name}`);
  return `${lines.join("\n")}\n\n${String(o.body ?? "")}`;
}

/**
 * Read a post's plaintext: `{ threadId, title, body }`. A post without a valid header has
 * `threadId: null` and its whole text as the body; a malformed header is not a header.
 */
export function parseThreadPost(text) {
  const s = String(text ?? "");
  const nl = s.indexOf("\n");
  const first = nl === -1 ? s : s.slice(0, nl);
  const m = HEADER_RE.exec(first);
  if (!m) return { threadId: null, title: null, sage: false, name: "", body: s };
  let rest = nl === -1 ? "" : s.slice(nl + 1);
  let title = null;
  const nl2 = rest.indexOf("\n");
  const second = nl2 === -1 ? rest : rest.slice(0, nl2);
  const tm = TITLE_RE.exec(second);
  if (tm) {
    const c = checkThreadTitle(tm[1]);
    title = c.ok ? c.title : null;
    rest = nl2 === -1 ? "" : rest.slice(nl2 + 1);
  }
  let name = "";
  const nl3 = rest.indexOf("\n");
  const third = nl3 === -1 ? rest : rest.slice(0, nl3);
  const nm = NAME_RE.exec(third);
  if (nm) {
    name = cleanName(nm[1]);
    rest = nl3 === -1 ? "" : rest.slice(nl3 + 1);
  }
  // The blank line between the header and the body.
  if (rest.startsWith("\n")) rest = rest.slice(1);
  // A thread's opener can't be sage: it is what the thread starts from.
  return { threadId: m[1], title, sage: !!m[2] && title === null, name, body: rest };
}

const byTime = (a, b) => a.sentAtMs - b.sentAtMs || String(a.msgId).localeCompare(String(b.msgId));

/**
 * Group readable board posts (`{ msgId, sentAtMs, text, ... }`) into threads, newest activity
 * first, like a 2ch thread list. Each thread: `{ threadId, title, posts, count, lastAtMs }`, its
 * posts oldest first (so post n is `posts[n - 1]`), each with `{ ...post, body }`. Posts without a
 * header are one group with `threadId: ""`, listed last.
 */
export function groupThreads(posts) {
  const groups = new Map();
  for (const p of posts) {
    const parsed = parseThreadPost(p.text);
    const id = parsed.threadId ?? "";
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push({ ...p, body: parsed.body, title: parsed.title, sage: parsed.sage, name: parsed.name });
  }
  const threads = [...groups.entries()].map(([threadId, ps]) => {
    ps.sort(byTime);
    const titled = threadId ? ps.find((p) => p.title) : undefined;
    // The list is ordered by the last post that bumps (sage posts don't); the first post always counts.
    const bumping = ps.filter((p, i) => i === 0 || !p.sage);
    return {
      threadId,
      title: titled ? titled.title : null,
      posts: ps,
      count: ps.length,
      lastAtMs: ps[ps.length - 1].sentAtMs,
      bumpAtMs: bumping[bumping.length - 1].sentAtMs,
    };
  });
  return threads.sort((a, b) => (a.threadId === "" ? 1 : 0) - (b.threadId === "" ? 1 : 0) || b.bumpAtMs - a.bumpAtMs);
}

/** キリ番: a round post number (100, 200, … 1000, …), marked quietly. */
export function isKiriban(n) {
  return Number.isInteger(n) && n >= 100 && n % 100 === 0;
}

/**
 * Whether a post looks like ASCII/Shift-JIS art, which needs its spacing kept: two or more lines,
 * and a line with a run of 3+ spaces (half- or full-width) or box/line drawing characters.
 */
export function looksLikeAA(text) {
  const lines = String(text ?? "").split("\n");
  if (lines.length < 2) return false;
  return lines.some((l) => /[ \u3000]{3,}/.test(l) || /[─━│┃┌┐└┘├┤┬┴┼╋▓▒░█▄▀■□◆◇○●∀´｀＿￣ヽﾉ⊂⊃]{2,}|[／＼|]{2,}/.test(l));
}

