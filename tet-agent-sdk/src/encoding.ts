export function u8ToStdBase64(u8: Uint8Array): string {
  return Buffer.from(u8).toString("base64");
}

export function walletIdHexFromPublicKey(pub: Uint8Array): string {
  let s = "";
  for (let i = 0; i < pub.length; i++) s += pub[i]!.toString(16).padStart(2, "0");
  return s;
}
