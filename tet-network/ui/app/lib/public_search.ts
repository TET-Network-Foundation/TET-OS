/**
 * Search over what this node serves publicly: the threads of public boards (boards whose invite is
 * listed in the directory, so anyone can read them). Read in the visitor's tab, like the directory
 * reads them; the search runs here, nothing is sent to the node but the same inbox reads the board
 * pages already make. Later the same box becomes TetSearch (docs/plans/TETSEARCH.md).
 */
import { groupThreads } from "./board_threads.mjs";
import { openBoard, readBoard, type OpenBoard } from "./try_board";

export type PublicListing = { name: string; invite: string; boardWalletId: string };
export type PublicThread = { title: string; board: string; invite: string; count: number; lastAtMs: number; text: string };

/** The threads of the newest `boards` public boards, newest activity first. */
export async function readPublicThreads(baseUrl: string, listings: PublicListing[], boards = 8): Promise<PublicThread[]> {
  const out: PublicThread[] = [];
  for (const l of listings.slice(0, boards)) {
    let b: OpenBoard;
    try {
      b = await openBoard(baseUrl, l.invite);
    } catch {
      continue; // a board that doesn't open is skipped
    }
    const posts = (await readBoard(baseUrl, b, 100).catch(() => [])).filter((p) => p.state === "open");
    for (const th of groupThreads(posts)) {
      if (!th.threadId) continue;
      out.push({
        title: th.title ?? "",
        board: l.name,
        invite: l.invite,
        count: th.count,
        lastAtMs: th.lastAtMs,
        text: th.posts.map((p: { body?: string }) => p.body ?? "").join("\n"),
      });
    }
  }
  return out.sort((a, b) => b.lastAtMs - a.lastAtMs);
}

const fold = (s: string) => s.normalize("NFKC").toLowerCase();

/** Threads whose title, board name or text contains every word of `query` (case- and width-insensitive). */
export function searchThreads(threads: PublicThread[], query: string): PublicThread[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return threads.filter((th) => {
    const hay = fold(`${th.title}\n${th.board}\n${th.text}`);
    return words.every((w) => hay.includes(w));
  });
}
