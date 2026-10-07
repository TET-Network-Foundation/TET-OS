// Guard for the Try TET board directory (app/lib/board_directory.mjs): the page's own code.
//
//   node scripts/try_directory_guard.mjs
//
// SECURITY properties:
// 1. A board is listed only by an announcement its own wallet signed (sender == the invite's board
//    wallet). An announcement by any other wallet, even with a valid invite, lists nothing, so an
//    invite-only board can't be pushed into the directory by someone who has its invite.
//    Control: a parser without the sender check → FAILED.
// 2. Anonymous posts never list a board, whatever they contain.
// 3. Malformed announcements (not JSON, wrong kind, bad invite, no name, a name with a newline) list
//    nothing; one bad post doesn't hide the good ones.
// 4. One listing per board; the newest valid announcement wins.

import assert from "node:assert/strict";

const d = await import("../app/lib/board_directory.mjs");
const board = await import("../app/lib/board.mjs");

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

const W1 = "11".repeat(32);
const W2 = "22".repeat(32);
const MALLORY = "ee".repeat(32);
const seed = (b) => new Uint8Array(32).fill(b);
const inv1 = board.encodeInvite({ boardWalletId: W1, seed: seed(1), name: "Study group" });
const inv2 = board.encodeInvite({ boardWalletId: W2, seed: seed(2), name: "Bike repair" });
let n = 0;
const post = (sender, text, sentAtMs, named = true) => ({ msgId: `m${++n}`, sentAtMs, sender, named, text });

/** The property in (1) and (2), run against a parser. */
function onlyTheBoardItselfLists(parse) {
  const ls = parse([
    post(MALLORY, d.encodeAnnouncement(inv1, 1000), 1000), // someone else announcing board 1
    post(W2, d.encodeAnnouncement(inv2, 1500), 1500), // board 2 announcing itself
    post(W1, d.encodeAnnouncement(inv1, 1200), 1200, false), // anonymous
  ]);
  assert.deepEqual(
    ls.map((l) => l.boardWalletId),
    [W2],
  );
}

await check("SECURITY: only the board's own wallet lists it; others' and anonymous announcements list nothing", () => {
  onlyTheBoardItselfLists(d.parseListings);
});

await check("control: a parser without the sender check is caught", () => {
  const noSenderCheck = (posts) => d.parseListings(posts.map((p) => ({ ...p, sender: board.parseInvite(JSON.parse(p.text).invite).boardWalletId })));
  assert.throws(() => onlyTheBoardItselfLists(noSenderCheck));
});

await check("SECURITY: malformed announcements list nothing and don't hide good ones", () => {
  const noName = board.encodeInvite({ boardWalletId: W1, seed: seed(1), name: "" });
  const ls = d.parseListings([
    post(W1, "not json", 100),
    post(W1, JSON.stringify({ kind: "something_else", invite: inv1 }), 110),
    post(W1, JSON.stringify({ kind: d.ANNOUNCE_KIND, invite: "tetboard1.zz" }), 120),
    post(W1, JSON.stringify({ kind: d.ANNOUNCE_KIND, invite: noName }), 130),
    post(W1, JSON.stringify({ kind: d.ANNOUNCE_KIND }), 140),
    post(W2, d.encodeAnnouncement(inv2, 150), 150),
  ]);
  assert.deepEqual(
    ls.map((l) => l.name),
    ["Bike repair"],
  );
  assert.throws(() => d.encodeAnnouncement(noName, 1), /needs a name/);
});

await check("one listing per board; the newest announcement wins; newest listed first", () => {
  const ls = d.parseListings([post(W1, d.encodeAnnouncement(inv1, 1), 1000), post(W2, d.encodeAnnouncement(inv2, 1), 2000), post(W1, d.encodeAnnouncement(inv1, 1), 3000)]);
  assert.deepEqual(
    ls.map((l) => [l.name, l.listedAtMs]),
    [
      ["Study group", 3000],
      ["Bike repair", 2000],
    ],
  );
});

await check("search is by name, case- and width-insensitive", () => {
  const ls = d.parseListings([post(W1, d.encodeAnnouncement(inv1, 1), 1), post(W2, d.encodeAnnouncement(inv2, 1), 2)]);
  assert.deepEqual(
    d.searchListings(ls, "ＳＴＵＤＹ").map((l) => l.name),
    ["Study group"],
  );
  assert.equal(d.searchListings(ls, "  ").length, 2);
  assert.equal(d.searchListings(ls, "nothing").length, 0);
});

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
