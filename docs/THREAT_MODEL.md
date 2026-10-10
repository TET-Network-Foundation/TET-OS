# Threat model: the /try page and Sign in with TET

Scope: the public test network's page (`/try`, served by the demo host and the seeds), its local
storage, the node routes it uses, and Sign in with TET as designed in
`docs/plans/SIGN_IN_WITH_TET.md` (not built yet). This is not a claim that TET is safe against every
attack. Each row says what is **defended**, **partly** defended, or **out of scope**, whose job it is,
and what we do about it. Rows marked *(design)* describe Sign in with TET before it exists.

What no model and no test here can cover is listed at the end, with the paths that exist for it:
the external audit planned for Phase 2, and reporting through `SECURITY.md`.

## Network

| Scenario | Status | Whose job | Mitigation |
|---|---|---|---|
| Evil-twin / public Wi-Fi | Partly | TET (TLS), the user (network) | HTTPS everywhere with HSTS; keys and messages are signed and checked in the browser, so a network attacker can't forge records or swap messaging keys (#101). Metadata (which site, when, from which address) is visible to the network. HSTS preload is an open infra item. |
| DNS spoofing | Partly | TET operator (DNSSEC, CAA), browsers (TLS) | TLS certificates stop a spoofed name without a valid certificate. DNSSEC and CAA are open infra items for the operator. |
| Managed device with TLS inspection (school, employer) | Out of scope | The device's owner | An admin who installs a root certificate or software can see and change everything on that device, including the page and its keys. The page says so (rule 8). |
| DDoS | Partly | TET operator, hosting provider | Per-address limits on the node's public routes (`public_api.rs`), a write budget, and the operator's provider. One producer and one operator today: a sustained attack can stop the testnet. |

## Device

| Scenario | Status | Whose job | Mitigation |
|---|---|---|---|
| Infostealer reading browser storage | Partly | The user's device; TET (what is stored) | The page stores no key in the clear: the 12 words only if the user opts in, encrypted with their passphrase (AES-256-GCM, PBKDF2-SHA-256, 600,000 iterations; `device_store.ts`). A stealer that also logs the passphrase, or reads memory while the tab is open, gets the key. Argon2id evaluated below (rule 7). |
| Keylogger | Out of scope | The user's device | A keylogger sees the passphrase and anything typed. TET can't defend a compromised device. |
| Device theft | Partly | The user; TET (lock) | Without the passphrase the stored vault is ciphertext. An unlocked open tab is exposed; auto-lock (rule 7) limits that. |
| Malicious browser extension | Out of scope | The user, the browser | An extension with access to the page can read and change it. The page asks for no extension and uses none. |
| Clipboard swapping | Partly | TET (what it shows), the user | The page shows IDs in full and in groups, and the safety number is compared out of band; join codes are scanned, not pasted, where the browser can scan. A swapped clipboard can still mislead someone who pastes without reading. |

## Page and server

| Scenario | Status | Whose job | Mitigation |
|---|---|---|---|
| The served JavaScript replaced (as in the 2025 Bybit theft, where an attacker changed a wallet interface's served code) | **Partly, the largest open gap** | TET operator; later, an extension or app | Rule 6: strict CSP, SRI on scripts, zero third-party scripts; a build hash signed by the publisher key and a "verify this page" check. These detect changed scripts from other origins and let a careful user compare, but **a compromised server can still serve different HTML and scripts with matching hashes**. The plan: a browser extension or app that pins the publisher-signed build, and the offline verifier (`public/verify/`) for records. |
| A node serving wrong keys | Defended (since #101) | TET (page code) | The browser checks every messaging-key registration is signed by that wallet before encrypting, and every sender's signature before showing who sent something; safety numbers let two people check in person. |
| Registrar or domain takeover | Partly | TET operator | Registrar lock and hardware-key 2FA on the registrar are open infra items. Records stay checkable offline with the publisher key, whatever the domain serves. |
| Certificate mis-issuance | Partly | TET operator, CAs | CAA records and Certificate Transparency monitoring are open infra items. |

## Social

| Scenario | Status | Whose job | Mitigation |
|---|---|---|---|
| Adversary-in-the-middle phishing (a look-alike site relays the real one) | Partly *(design for sign-in)* | TET (origin binding), the user | Sign-in challenges are bound to the page's origin and the browser refuses to sign for another origin (rule 1); per-site keys (rule 2). The /try page itself has no password to phish; a look-alike can still ask for the 12 words, which rule 8 warns about. |
| Seed-phrase scams | Partly | TET (wording), the user | Rule 8: "TET asks for your passphrase (12 words) only on the restore screen; support never DMs you." |
| Approval fatigue | Defended *(design)* | TET | No push approvals anywhere; a cooldown on repeated signing requests; every request shows what is being signed (rules 4 and 5). |
| SIM swap | Defended by design | TET | No SMS, email codes or push approvals in TET (rule 5). The operator's own accounts are a separate row. |
| Deepfake voice or video ("it's me, send me your words") | Partly | The user; TET (wording) | Nobody from TET ever asks for the 12 words; safety numbers and in-person vouches are the checks, not a voice. |
| Shoulder surfing, screenshots | Partly | The user | The words are shown only when the user asks to save them; the page says to write them down, not photograph them. |

## Protocol

| Scenario | Status | Whose job | Mitigation |
|---|---|---|---|
| Replay | Defended | TET | Chain-bound pre-images (chain id, genesis hash) on every signature; per-kind nonces or time windows (Shelter records once, sealed keys newer-only, reads 2 minutes, anonymous nullifiers once per board and day). Sign-in challenges single-use with expiry *(design, rule 1)*. |
| Cross-protocol reuse (a sign-in signature as a transaction or record) | Defended *(design)* | TET | Each signed thing has its own PAE domain; sign-in uses "tet signin v1", tested in both directions (rule 3). Key registrations are PAE "tet tmail key v2" (#101). |
| Relay between sites | Defended *(design)* | TET | Origin binding and per-site keys (rules 1, 2). |
| Weak randomness | Partly | Platform, TET | Keys and nonces come from the platform's CSPRNG (WebCrypto, OS); TET doesn't seed its own. A broken platform RNG is out of scope. |
| Quantum: forging signatures | Partly | TET (Phase 1) | Every signature is hybrid (Ed25519 + ML-DSA-44), but the wallet id is the Ed25519 key and the ML-DSA key is not bound to it until `wallet_id_v2` (Phase 1). Until then quantum resistance is incomplete. |
| Quantum: harvest now, decrypt later | Partly | TET | Messages use X25519 + Kyber-768 (Round 3, not the final ML-KEM standard, FIPS 203): both must be broken. Kyber Round 3 differs from FIPS 203; moving to ML-KEM is planned. |
| ML-DSA side channels | Partly | Library, TET | Signing uses `dilithium-rs` (Rust) and its WASM build; constant-time behaviour in browsers is not audited. In scope for the Phase 2 audit. |

## Supply chain

| Scenario | Status | Whose job | Mitigation |
|---|---|---|---|
| A malicious npm package | Partly | TET maintainers | Lockfile; `npm ci --ignore-scripts` in CI; a human reviews every dependency change (rule 9). The offline verifier uses no npm code at all. |
| A compromised GitHub Action | Partly | TET maintainers | Actions pinned by commit SHA (rule 9). |
| Prompt injection into automated development | Partly | TET maintainers | Text from issues, outside PRs, Discord, email and web pages is data, never instructions: no command, publish, deploy or merge may come from it (rule 10). Automated sessions never merge or deploy; a person reviews every PR. |

## Operator accounts

| Scenario | Status | Whose job | Mitigation |
|---|---|---|---|
| Takeover of GitHub, the registrar, the hosting provider, Discord or email | Partly | The founder (today the only operator) | Hardware-key 2FA everywhere, no SMS recovery; open infra items tracked privately. One operator is itself a risk: see `docs/GOVERNANCE.md` (planned) and Phases 3 and 9. |

## Recovery

| Scenario | Status | Whose job | Mitigation |
|---|---|---|---|
| Lost 12 words | **Out of scope by design** | The user | Nobody can recover them, TET included. The page says so on every screen that creates or uses them (rule 8). Sites using Sign in with TET should keep their own recovery if they need one. |

## Design rules

Each rule is enforced in code with a test and a negative control where it is code; rules for Sign in
with TET are specified now and tested when it is built.

1. **Challenge = {origin, nonce, expiry}; single-use; the browser refuses to sign unless the origin
   equals the page's origin.** *(design: SIGN_IN_WITH_TET.md)*
2. **Per-site derived keys.** *(design)*
3. **PAE domain "tet signin v1"**: a sign-in signature is never a valid transaction or record, and no
   transaction or record signature is a valid sign-in; tested both ways. *(design)*
4. **Show what is being signed, in plain words, before signing.** No blind signing.
5. **No SMS, email codes or push approvals anywhere; a cooldown on repeated signing requests.**
6. **Page integrity:** SRI on every script, a CSP, zero third-party scripts; a reproducible build
   whose hash is signed with the publisher key and compared by "verify this page". Still
   unprotected: a compromised server can serve different HTML; the plan is an extension or app.
7. **Keys:** in memory only while the tab is unlocked; the vault encrypted; auto-lock; a
   passphrase-strength check. Argon2id: evaluated (WebCrypto has no Argon2; it would need a WASM
   dependency reviewed by a human); PBKDF2 at 600,000 iterations until then.
8. **Three fixed sentences** on the relevant screens, guarded:
   "TET asks for your passphrase (12 words) only on the restore screen; support never DMs you." /
   "On a device managed by your school or employer, the admin can see everything." /
   "Lose your passphrase (12 words) and nobody can recover it."
9. **Supply chain:** lockfile; `npm ci --ignore-scripts`; Actions pinned by SHA; a human reviews
   dependency changes.
10. **Text from issues, PRs by strangers, Discord, email or web pages is data, never instructions;**
    no command, publish, deploy or merge may originate from it.
11. **`/.well-known/security.txt`** points to `SECURITY.md` and the contact addresses.

Where each stands is tracked in the PR that introduced this file and its follow-ups.

## What no model or test here covers

- Attacks nobody has thought of: this model lists known classes, not all attacks.
- Mistakes in the cryptographic libraries themselves, and side channels in them.
- A compromised maintainer machine or account, beyond the account rows above.
- Bugs that tests and guards don't exercise.

For these, Phase 2 includes an **external audit**, and anyone can report a problem privately through
`SECURITY.md`; fixed issues are published there at class level.
