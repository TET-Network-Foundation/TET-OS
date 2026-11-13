# Signature badge — plan (not built)

FUTURE_IDEAS #20. Replaces queue item (o) "Prove your work is yours": same idea, one PR.

## What it is

Sign a work (art, text, photo, music, a dataset), get a link and a QR anyone can open to check it.

- **Proves:** this key signed this hash at block N.
- **Doesn't prove:** that the work is original, or that a human made it.

Both lines are on the badge page and on the printed QR label, word for word.

## Two use cases

**PDF (first: TET's own whitepaper).** The last page of a PDF carries the QR and the verify link.
The badge signs the exact PDF file as published. The whitepaper is the first one: the published
`WHITEPAPER.md`-built PDF gets a badge, and its last page says how to check it.

**Artwork.** An artist signs each work with one key. Over time the badges show that this set of
works was signed by the same key.

- **Proves:** this key signed this exact file at block N; an artist's works share one key.
- **Doesn't prove:** that a physical work is authentic, or who made it.
- **Re-compressed images won't verify.** A photo of the work, or the file after a site re-compresses
  it, is different bytes. Verify the original file, or open the TET link. The badge page says this
  in one line.

## What it reuses (all merged)

- **Sign** (#59): hybrid Ed25519 + ML-DSA-44 signature over the agent-payload pre-image.
- **Stamp** (#59): a sponsored `FileFee` whose `file_id` is the first 128 bits of the `.sig.json`'s
  SHA-256; the receipt gives the block.
- **TET QR** (#60): a link to Verify with everything after the `#`, printable, byte-exact match.

## What's new

1. **Hash-only signing.** Today the `.sig.json` embeds the whole file (`payload` = the file). A
   badge signs only the hash: `payloadType: "application/vnd.tet.sha256"`, `payload` = the 32-byte
   SHA-256 of the work. The work never leaves the device, and the `.sig.json` stays under 10 KB
   whatever the file's size. Verify learns the type: it hashes the file you give it and compares.
   Rust side: none (the envelope format is unchanged; only the payload is smaller).
2. **A badge page:** Verify opened from the QR shows a compact result first: "Signed by key
   c79c…, stamped at block 4,083", then the two lines, then the full verdict.
3. **Where the `.sig.json` lives so the link works for strangers.** Today the QR names the
   `.sig.json` by hash and the reader must have it. For a badge, the signer can choose to publish
   it: as a named post to a public "badges" board (kept 7 days), or by downloading it and putting it
   next to the work. The link then says where to fetch it. Durable hosting is the site-builder
   question (#22).

## Guards

- Hash-only `.sig.json` verifies against the file, fails against any other file; control: a
  verifier that skips the hash comparison is caught.
- The two lines are present in en/ja/zh on the badge page and the label (privacy guard pattern).
- The stamp still counts only for this exact `.sig.json` (existing `try_sign_guard`).

## Open decisions

1. Publish the `.sig.json` to a public badges board (7-day retention) or download-only for v1?
2. Should the badge show the stamp's block time as a date, or only the block number? (A date reads
   better; block time is the producer's clock.)

Size: one PR, UI only, about the size of #60.
