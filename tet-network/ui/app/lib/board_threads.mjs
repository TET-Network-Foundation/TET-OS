// Try TET boards: threads (スレ), as a convention inside the post text. No node change: the node
// stores a board post as an encrypted Tmail message and never sees a thread.
//
// A thread post's plaintext is
//
//     tet-thread v1 <16 hex id>
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
//
// Plain ESM with no I/O, so the guard runs the page's own code (scripts/try_threads_guard.mjs).

export const THREAD_HEADER = "tet-thread v1";
/** The longest thread title. */
export const THREAD_TITLE_MAX = 80;

const HEADER_RE = /^tet-thread v1 ([0-9a-f]{16})$/;
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

/** The plaintext for a post in a thread; `title` only when opening it. */
export function encodeThreadPost(o) {
  if (!/^[0-9a-f]{16}$/.test(o.threadId ?? "")) throw new Error("bad thread id");
  const lines = [`${THREAD_HEADER} ${o.threadId}`];
  if (o.title != null) {
    const c = checkThreadTitle(o.title);
    if (!c.ok) throw new Error(c.reason);
    lines.push(`title: ${c.title}`);
  }
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
  if (!m) return { threadId: null, title: null, body: s };
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
  // The blank line between the header and the body.
  if (rest.startsWith("\n")) rest = rest.slice(1);
  return { threadId: m[1], title, body: rest };
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
    groups.get(id).push({ ...p, body: parsed.body, title: parsed.title });
  }
  const threads = [...groups.entries()].map(([threadId, ps]) => {
    ps.sort(byTime);
    const titled = threadId ? ps.find((p) => p.title) : undefined;
    return { threadId, title: titled ? titled.title : null, posts: ps, count: ps.length, lastAtMs: ps[ps.length - 1].sentAtMs };
  });
  return threads.sort((a, b) => (a.threadId === "" ? 1 : 0) - (b.threadId === "" ? 1 : 0) || b.lastAtMs - a.lastAtMs);
}
