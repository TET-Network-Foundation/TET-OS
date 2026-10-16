# Genuine tag: a brand registers a secure NFC tag, TET records registration and owners

Status: **design only, nothing built.** Written 2026-10-15. Real registrations wait for Phase 1 (§5).

A brand fixes a secure NFC tag (NXP NTAG 424 DNA, or its TagTamper variant) to a physical object.
Each tap makes the tag produce a fresh **SUN** message: a URL carrying its UID and a read counter,
encrypted, plus an AES-CMAC computed with keys only the tag and the brand hold. TET records who
registered the tag, under which brand key, and who claimed it since, as signed, anchored records.

## 1. What already exists and is reused

- **The genuine registry** (`tet-core/src/sigs.rs`): hash-only signed records, published with the
  signer's consent, searchable by signer and date, re-checked in the reader's tab. A tag record is
  a registry record whose payload is the SHA-256 of a canonical tag document (§2). The registry
  accepts only 32-byte payloads, so it needs no change.
- **The hash-only stamp anchor** (#148): each record is anchored by a mined `FileFee` whose
  `file_id` is the record's stamp id. The registry keeps the earliest anchor, so of two competing
  claims the one in the earlier block wins.
- **The owner manifest shape** (`AgentManifestV1`, `tet-core/src/agent.rs`): an owner wallet
  signs that another key is theirs, with an expiry and capabilities. Reused as a **brand
  manifest**: the brand's main ID vouches for its verifier key (capability `verify-tags`) and,
  if it wants one, a separate registering key (`register-tags`). Expiry is the revocation.

## 2. Record formats

Each document is canonical JSON. Its SHA-256 is signed as a hash-only record and published. The
document itself is served by the brand's verifier and shown on the scan page, where anyone can
recompute the hash.

- **Kind strings, fixed:** `kind` is `"tet_tag_registration"` or `"tet_tag_claim"`, and the
  version is the separate field `v: 1`.
- **Canonical form:** UTF-8 JSON, keys sorted, no whitespace, integers only, absent values
  written as `null` (never left out), hashes and IDs as lowercase hex. The record's payload is
  the SHA-256 of that text, as the `tet-tag-verify` crate computes it (pinned in its tests).
- **A change to either means a new version** (`v: 2`), not a new hash for `v: 1`.

```
tet_tag_registration_v1 {
  v: 1, kind, tag_id,            // SHA-256("tet tag v1" ‖ UID), never the raw UID
  chip: "ntag424dna" | "ntag424dna_tt",
  product: { label, ref, images_sha256: [] },   // the brand's own description
  verifier: "https://…",         // the brand's SUN verifier
  counter_at_registration,       // from the tap that registered it
}                                // signed by a key the brand manifest allows to register-tags

tet_tag_claim_v1 {
  v: 1, kind, tag_id,
  registration_record_sha256,
  previous_claim_sha256 | null,  // null for the claim on first scan
  release_sha256 | null,         // the current owner's signed release naming the new owner
  new_owner,                     // the claimant's ID
  tap: { counter, tamper: "closed" | "open" | null },
  verifier_attestation_sha256,   // the brand verifier's signed "this tap was valid"
}                                // signed by new_owner
```

**Claim on first scan:** the earliest valid tap after registration, with a verifier attestation,
claims the tag. **Transfer:** the current owner signs a release naming the next owner, then the
next owner taps the tag in person and claims. Each claim is anchored. A claim must cite the
previous one. When two claims cite the same previous claim, the one in the earlier block wins.

## 3. Who holds the tag's AES keys

- **Default: the brand.** The keys are written at manufacturing, diversified per tag. The brand
  runs its own SUN verifier (an open-source service we would publish), which checks the CMAC and
  that the counter went up, then signs an attestation with its manifest-listed verifier key.
  **TET nodes never hold tag keys.**
- **What that means for trust:** a scanner trusts the brand's verifier to say "this tap came from
  our tag". TET makes that statement signed, public, ordered and checkable later. It doesn't
  remove the trust. A brand, or a thief of its keys, can attest falsely, and the brand manifest's
  expiry is how a key is retired.
- **Later option: a hosted verifier.** A host holds the brand's keys and attests on its behalf.
  Trust moves to the host, so it needs per-brand keys in an HSM, a published policy, and the scan
  page naming it ("checked by {host} for {brand}").

## 4. The scan page

A tap opens `/tag?…` with the SUN data. The page asks the listed verifier, then shows:

- the brand: its ID card and manifest;
- the product as the brand registered it;
- "registered before block N", checked in the tab;
- the current owner's short ID and the claim history, each with its block;
- this tap's result: valid or not, whether the counter went up, and the tamper loop where the chip
  has one.

**What this shows**
- "This tap came from a tag that holds the brand's secret key. That was checked just now by the
  brand's verifier at {verifier}, not by TET's chain."
- "The brand's ID registered this tag before block {N}."
- "{owner} claimed it at block {M}, after a tap the same verifier checked."

**What this doesn't show**
- "A QR code or a copied link proves nothing on its own: anyone can copy one. Only a fresh tap of
  the tag counts."
- "The chain can't check the tag's signature. It records what the brand's verifier said."
- "A tag can be removed and moved. This shows the tag is the brand's, not that the object it's on
  is."
- "It doesn't show the object is authentic or undamaged beyond what the brand states. Ownership
  here is a record on TET, not a legal title."

## 5. Now vs Phase 1

- **Prototype now, locally:**
  - the verifier service against development tags;
  - the two document formats;
  - the scan page on a local node;
  - claims anchored with the hash-only stamp on a local or practice chain, labelled "practice:
    this chain will be reset".
- **Wait for Phase 1 before real registrations:**
  - records are signed against today's chain id, so the reset makes them unverifiable on the new
    chain;
  - blocks gain a signed time, so a claim gets a date, not just a height;
  - producer signatures make anchors stronger;
  - `wallet_id_v2` binds the brand key's ML-DSA half;
  - brands need a chain identity that won't change under them.

## 6. Open questions

- **Hardware:**
  - the SDM/SUN configuration: which file, the mirror offsets, encrypted PICCData;
  - per-tag key diversification (AN10922), and who writes the keys at manufacturing;
  - how TagTamper reports the loop;
  - counter rollover;
  - whether iOS and Android open the URL without an app;
  - tamper-evident attachment;
  - cost per tag;
  - per-tag key diversification (AN10922) and LRP mode are required before any real
    registration. The prototype doesn't need them;
  - test vectors so far come from sdm-backend's tests, which cite AN12196. The real check is
    the first physical tag.
- **Protocol (Manu):**
  - should verifier attestations themselves be anchored, or stay registry-only?
  - relay attacks: a live relay of a real tap can't be stopped by SUN alone. Is a short attestation
    lifetime plus counter checks enough?
  - verifier key compromise: is expiry-only revocation acceptable, or does this need the Agent ID
    plan's revocation record?
  - privacy: hashed UIDs, public owner IDs, whether the verifier keeps logs.
  - `tag_id = SHA-256("tet tag v1" ‖ UID)` can be enumerated: UIDs come in known ranges per
    brand, so anyone can hash a range and find its tags. Decide a keyed hash or a per-tag salt
    before Phase 1.
- **Product:**
  - is "ownership" the right word given it isn't a legal title?
  - what a brand must publish about its verifier before its tags show as registered.
