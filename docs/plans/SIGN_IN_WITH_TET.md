# Sign in with TET: a second factor any site can add (design, for review)

Status: **design only, no code** (founder, 2026-10-10). It covers:
- a second factor next to a site's normal password: the site sends a challenge, the user signs it
  with their TET key, and the site verifies the signature;
- an anonymous mode that proves "member of group X" without revealing who;
- a tiny example site, as a sketch below, to be built after review.

**Never:** passwords or password hashes on TET or on any TET node. A site keeps its own password
handling, exactly as before. TET adds a second, separate factor.

**Wording:** the signatures are hybrid (Ed25519 + ML-DSA-44), but full quantum resistance is not
claimed before Phase 1's `wallet_id_v2`. See "What it proves" below.

## Why a site would use it (stated truthfully)

- **Nothing secret on any server for the TET part.** A site stores only public keys for Sign in
  with TET, so a breach of its database leaks nothing that lets anyone sign in with TET: no mass
  leak. (A site that also keeps passwords as its first factor still has those, as before; a site
  that uses TET as its only login holds no password at all.)
- **Anonymous mode reveals only membership:** "a member of group X signed in", and nothing that
  links one sign-in to another unless the site asks for a stable pseudonym and says so.
- **The limit, on every sign-in screen:** "If you lose your passphrase (12 words), nobody can
  recover your account." TET can't; a site that needs recovery keeps its own (codes, support).
  (The founder's wording is "If you lose your 12 words, nobody can recover your account."; the
  page's term "passphrase (12 words)" keeps the plain-words guard unchanged.)

## Design rules (docs/THREAT_MODEL.md rules 1–5), each tested when built

1. **Challenge = {origin, nonce, expiry}, single use.** `origin` is the requesting site's full
   origin (`https://example.org`, scheme, host and port). The signer refuses to sign unless the
   origin it will return to (the callback URL's origin, and the page that sent the user) equals the
   challenge's `origin`. Test: a challenge for `https://evil.example` returned to
   `https://example.org` is refused (control: skip the origin check → FAILED).
2. **Per-site keys:** derived from the words and the origin, so two sites never see the same key.
   Test: the keys for two origins differ; the signer refuses to sign origin B's challenge with
   origin A's key (control: derive without the origin → FAILED, the same key on both).
3. **PAE domain "tet signin v1":** a sign-in signature is never a valid transaction, record or key
   registration, and none of those is a valid sign-in. Tested in both directions (control: one
   shared domain → FAILED).
4. **No blind signing:** before approving, the signer shows in plain words, large: "example.org
   asks you to sign in. This signature can't move TET, post anything or sign for another site."
5. **No SMS, email codes or push approvals, anywhere.** A cooldown: at most 3 sign-in requests
   from one origin per minute, then the signer waits; it never approves on its own.

## Named mode (the second factor)

### Keys: one per site, by default

- **Derivation.** A user's TET words give them a different key pair for each site, so two sites
  can't link one person's accounts. It's the same idea as passkeys:
  - `seed_site = HKDF-SHA256(BIP39 seed, info = "tet-signin-v1|" + origin)`, where `origin` is the
    site's origin, lowercased (e.g. `https://example.org`);
  - the Ed25519 key comes from `seed_site`, as wallets do;
  - the ML-DSA-44 key comes from `HKDF(seed_site, "tet:pqc:mldsa44-seed:v1")`, as wallets do.
- **Same words, same keys.** The same words re-create the same per-site keys on any device. A
  site can ask for the user's main TET ID instead, if the user agrees, e.g. to show "signed in
  as TET:ab12…"; the default is the per-site key.

### Enrolling (once, while signed in with the password)

1. The site makes an enrolment challenge (below, `purpose: "enroll"`).
2. The user signs it in their TET signer.
3. The site stores the two public keys with the account: Ed25519 (32 bytes) and ML-DSA-44
   (1312 bytes). Public keys only: nothing secret leaves the user's device.

### Signing in

1. **The password**, checked by the site as always.
2. **The challenge.** The site makes it, ties it to this browser session (a cookie), and keeps it
   for at most 5 minutes:
   ```json
   {"v":1,"kind":"tet_signin_challenge_v1","origin":"https://example.org","purpose":"login",
    "nonce":"<32 random bytes, hex>","issued_at_ms":1791500000000,"expires_at_ms":1791500300000}
   ```
3. **The user signs it** in their TET signer. Both keys sign `PAE("tet signin v1",
   [origin, challenge bytes])`. That's a new domain, separate from records and transactions, so a
   sign-in signature can't be replayed as either. Before the user approves, the signer shows the
   site's name in large type: **"example.org asks you to sign in"**.
4. **The signature goes back to the browser session that asked for it**, by a redirect to
   `https://example.org/tet/callback`. It's never posted to whichever page opened the signer.
5. **The site verifies:**
   - both signatures, with the enrolled keys;
   - `origin` equals its own origin;
   - the nonce is the one stored for *this session*, unused and unexpired;
   - then it deletes the nonce (single use).

### Where the user signs

- **Same device (preferred).** The TET page at `/sign-in?challenge=…` opens, the user reviews the
  site's name and approves with their device password, and it redirects back. This is phishing-
  resistant (see the threats below).
- **Another device (QR).** The site shows a QR code of the challenge; the phone's TET page signs it
  and posts the signature to the site's callback URL inside the challenge. This is convenient but
  open to real-time relay, like every QR login. The page says so, and sites can turn it off.

## Anonymous mode: "member of group X", not who

- **Groups.** A group is a member list with a root the node builds from its own registry, exactly
  like members-only polls and Shelter. Group X is named by its root's wallet. The site trusts that
  group: "anyone in the TET chemistry club may read this".
- **The proof.** The user proves membership with the zero-knowledge proof TET already has, bound
  to this sign-in:
  - receiver = `SHA-256("tet-signin-v1" ‖ origin ‖ nonce)`, in the 64-hex wallet-id format, so
    the proof answers this challenge only;
  - **by default, only membership:** the nullifier is fresh for every sign-in (it depends on the
    nonce), so the site can't tell two sign-ins apart. **The site learns only "a member of group X
    signed in".**
  - **optional, stated by the site:** a stable per-site pseudonym (receiver from the origin only,
    day 0), for a site that needs an account: then it also learns "the same member as last time",
    still not who, and still unlinkable across sites. The signer shows which one before signing.
- **What the site receives:** a valid proof against group X's current root; the nullifier (fresh,
  or the stable pseudonym); a one-time session key, the proof's ephemeral key.
- **Cost.** About 30 s of proving on the user's own machine (the local prover), once per sign-in.
  A site can keep the session long, because the pseudonym is stable.
- **Verifying.** A site can verify the proof itself with the RISC Zero verifier and TET's pinned
  program id, or ask any TET node's verify endpoint (new, read-only). That node sees the proof and
  the site, not the person.

## What TET stores

- **Named mode:** nothing. The site verifies the signatures itself, with a small library: the same
  code that checks proof codes, `verify_anything.mjs`, published as a package. No node is involved.
- **Anonymous mode:** group member lists and roots, as for polls. Nothing per sign-in, except that
  a node used as a verifier answers that one request and keeps nothing.
- **Passwords and password hashes:** never, anywhere in TET. The example site stores its own, the
  way it already does; that is the site's database, not TET's.

## What it proves, and what it doesn't

- **Proves (named):** the person holds the TET words that made this site's enrolled keys. A
  stolen password alone isn't enough.
- **Proves (anonymous):** a member of group X, the same one as before on this site.
- **Doesn't prove:**
  - who the person is;
  - that the site's own login (password, TLS) is quantum-resistant: it isn't;
  - full quantum resistance of TET identities, which waits for `wallet_id_v2`. A site that
    enrols both public keys and checks both signatures does hold both halves for its own accounts.
    The document says that much and no more.

## Threats

| Threat | Answer |
|---|---|
| Stolen password | Not enough: the TET signature is needed too. |
| Phishing page relaying the real site's challenge (same device) | The signer redirects the signature to the real site, into the user's own browser session. The attacker's session holds the nonce, so the real site rejects it. Covered by a test. |
| Phishing over QR (cross-device) | Not prevented (real-time relay). Stated on the page; sites may disable QR. |
| Replay | Single-use nonce, 5-minute expiry, `site` signed in. |
| Signature reused elsewhere | A separate PAE domain, `tet signin v1`: not valid as a record, a transaction or another site's sign-in. |
| Tracking across sites | Per-site keys by default. The anonymous mode's pseudonym is per site. |
| Lost TET words | The site's own recovery (codes, support). TET can't recover them. |
| Compromised device | Out of scope: the attacker has the words. |
| A TET node used as anonymous-mode verifier | Sees the proof and the site, not the person; keeps nothing. Verifying locally avoids even that. |

## The tiny example site (sketch; built after review)

One file, Node.js, no framework. It uses the same `verify_anything.mjs` the TET page uses, as a
package. The password is the site's own (scrypt, in its own `users.json`), never sent to TET.

```js
// example-site.mjs — password + Sign in with TET (named mode)
import http from "node:http";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { verifySignIn } from "@tet/verify";            // verify_anything.mjs, packaged
const SITE = "example.org";
const users = { alice: { pw: scrypt("…"), tet: null } }; // the site's own store
const pending = new Map();                                // session → { nonce, exp }

route("POST /login", (req, res, s) => {                  // 1. the site's own password check
  if (!checkPassword(users[req.body.user], req.body.password)) return res.deny();
  s.user = req.body.user;
  if (!users[s.user].tet) return res.ok("signed in (no second factor enrolled)");
  const c = { v: 1, kind: "tet_signin_challenge_v1", site: SITE, purpose: "login",
              nonce: randomBytes(32).toString("hex"), issued_at_ms: Date.now(),
              expires_at_ms: Date.now() + 300_000 };
  pending.set(s.id, c);                                  // tied to THIS session
  res.redirect(`https://try.stevenexus.org/sign-in?challenge=${encode(c)}`);
});

route("GET /tet/callback", (req, res, s) => {            // 2. the signer redirects back here
  const c = pending.get(s.id); pending.delete(s.id);     // single use
  if (!c || Date.now() > c.expires_at_ms) return res.deny("expired");
  const ok = verifySignIn({ challenge: c, signature: req.query.sig, keys: users[s.user].tet, site: SITE });
  if (!ok) return res.deny("signature doesn't match");
  s.secondFactor = true; res.ok("signed in with password + TET");
});
```

## Tests (each with a negative control)

- **Valid sign-in:** a sign-in with the enrolled keys verifies. A signature by another key fails
  (control: skip the key check).
- **Site and nonce:**
  - a challenge for `evil.org` signed and sent to `example.org` fails (control: skip the site
    check);
  - a replayed nonce fails (control: don't delete it);
  - an expired one fails.
- **Relay phishing:** a signature delivered into another session than the one holding the nonce
  fails (control: global nonces instead of per-session).
- **Domain separation:** a sign-in signature isn't a valid record or transaction signature
  (control: share the PAE domain).
- **Per-site keys:**
  - two sites get different keys from the same words;
  - the same site gets the same key on two devices;
  - the signer refuses to sign one origin's challenge with another origin's key (control: derive
    without the origin → FAILED).
- **Origin binding (rule 1):** a challenge whose origin isn't the return origin is refused, before
  any key is used (control: skip the check → FAILED).
- **Cooldown (rule 5):** the fourth request from one origin within a minute waits (control: no
  cooldown → FAILED).
- **The limit sentence** is on every sign-in screen (guarded like rule 8).
- **Anonymous mode:**
  - a proof against group X's root verifies; by default two sign-ins give different nullifiers
    (only membership); with the stable option the pseudonym is stable on one site and differs on
    another;
  - a non-member's proof fails;
  - another site's proof fails (wrong receiver).
- **Wording guard:** no "quantum-proof login" or "fully quantum-resistant", and no claim that TET
  stores or checks passwords.

## Open questions for the founder

1. Should the TET page host the signer (`/sign-in`), or is a browser extension worth it later?
2. Should the QR cross-device flow ship at all in v1, given relay phishing?
3. Should the anonymous mode's verify endpoint be on the demo node, or local verification only?
4. Under what name should the `verify_anything.mjs` package be published?
