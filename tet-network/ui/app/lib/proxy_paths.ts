/**
 * The node's operator routes (`/operator/*`, tet-core operator_hide.rs) are never proxied by the
 * page's `/tet-node-api` route: they answer only on the node's own loopback, and the proxy runs on
 * the same host in local setups, so forwarding them would make any visitor look like loopback.
 * Path segments arrive decoded or encoded depending on the runtime, so both are normalised.
 */
export function isOperatorPath(path: string[] | undefined): boolean {
  const first = (path ?? []).find((p) => p !== "");
  if (first === undefined) return false;
  let seg = first;
  try {
    seg = decodeURIComponent(first);
  } catch {
    /* not percent-encoded */
  }
  return seg.trim().toLowerCase() === "operator";
}
