/**
 * Who a DM from a post goes to (docs/THREAT_MODEL.md: impersonation). Only a named post's
 * **verified signer key**, the key its signature was checked against in this tab
 * (`BoardPost.verifiedSigner`). Never the short ID shown in the thread, never a typed prefix, never
 * the sender field the node returned: short IDs can be imitated by grinding a key with the same
 * opening characters. An anonymous post, or a named one whose signature wasn't checked, has none.
 */
export function dmTargetFor(post: { label: { kind: string }; verifiedSigner?: string }): string | null {
  if (post.label.kind !== "named") return null;
  const k = post.verifiedSigner?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{64}$/.test(k) ? k : null;
}
