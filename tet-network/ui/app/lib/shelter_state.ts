/**
 * Is Shelter open on this node? Four answers, so the page never says "not open" when the node was
 * only busy (429) or didn't answer: those are temporary and say so.
 */
export type ShelterState = "open" | "closed" | "busy" | "unreachable";

export async function shelterState(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<ShelterState> {
  let r: Response;
  try {
    r = await fetchFn(`${baseUrl}/shelter/status`, { cache: "no-store" });
  } catch {
    return "unreachable";
  }
  if (r.status === 429 || r.status === 503) return "busy";
  if (!r.ok) return "unreachable";
  const j = (await r.json().catch(() => null)) as { on?: unknown } | null;
  if (!j) return "unreachable";
  return j.on === true ? "open" : "closed";
}

/** A node's refusal for load (429), as the node or the gate in front of it words it. */
export function isBusyError(message: string): boolean {
  return /\bHTTP 429\b|\brate limit\b|\bnode is busy\b|\btry again in a moment\b/i.test(message);
}
