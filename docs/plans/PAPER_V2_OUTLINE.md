# Technical paper v2: outline (for the founder's review; nothing written yet)

Same single source as v1 (`tet-network/ui/app/whitepaper/paper.ts` → /whitepaper, the HTML file and
the PDF), the same source citations pinned to one commit, the same guards (paper, KEM wording,
privacy, money, AI wording, founder privacy). After writing: re-mark the text and the PDF with the
publisher key; publish the marks only once the demo is open. v1 stays, marked "superseded by v2",
with its proof codes.

## 0. Header and changelog
- Version 2.0, the commit it describes, the date, scope "public test network, v0.2".
- **Changelog of the paper itself:** every version with its proof codes, text and PDF (v1:
  TET-418B-CFT2 / TET-QQGQ-B5MM; v2: added when marked), so the paper's own history is checkable,
  including with the offline verifier.

## 1. Positioning: a public proof layer no company owns
- **Opening sentence (the positioning line):** "Your proofs and keys, in your hands, not a
  company's." (ja: 「自分の証明と鍵を、会社から自分の手に。」)
- **Why now (one line):** AI makes faking text, images and voices easy, so "who signed this, and
  when" matters more than "does this look real".
- **The honest limit (one line):** lose your passphrase (12 words) and nobody can recover it; today
  TET still runs on one operator and one block producer (see the roadmap, section 13).
- What it is: proofs of who, when and what that anyone can check without trusting a company, and
  that stay checkable if TET itself disappears (section 10).
- **Comparison table** — what each is for, and what TET adds or leaves to it. True claims only,
  never "first":

  | | What it's for | What TET adds | What TET leaves to it |
  |---|---|---|---|
  | Bitcoin | Money; a very hard-to-rewrite ledger | Signed records of who/when/what, hybrid post-quantum signatures | Money, and a timestamp far harder to rewrite than TET's today |
  | Ethereum | Programs that run on a chain | Nothing on programs; records, membership proofs, messaging | Smart contracts |
  | C2PA | Credentials embedded by cameras and editing tools | Marks a person chooses to make on any file's hash, checkable offline | Provenance from the capture device itself |
  | OpenTimestamps | Free timestamps anchored in Bitcoin | Who signed, not only when; anonymous membership | Stronger timestamps (Bitcoin-anchored) |
  | Passkeys | Phishing-resistant sign-in | Per-site keys from words you hold; a membership-only mode (design) | Platform sync and recovery |
  | Signal | Mature end-to-end messaging | Messaging tied to the same keys as records; safety numbers | Metadata protection and a mature, audited protocol |
  | Tor | Hiding where traffic comes from | Hiding which member posted, among members | Hiding the network address: TET doesn't |

## 2. Principles
Verify, don't trust; your keys and proofs in your hands; every feature carries "proves / doesn't
prove"; weaknesses are published (SECURITY.md).

## 3. Architecture — as v1 (§1), sources cited, updated to the pinned commit.
## 4. Cryptography — as v1 (§2): the ML-DSA binding gap (`wallet_id_v2`, Phase 1), Kyber-768
Round 3 (not FIPS 203 ML-KEM), with the Phase 1 fixes; PAE domains, now including key
registrations (#101).
## 5. Anonymous membership — as v1 (§3), plus fast anonymous posting (#100; only once merged).
## 6. Messaging — Tmail with its limits; signed key registrations checked in the browser and
safety numbers (#101, deployed); what the node still sees (who, whom, when, from where).
## 7. Consensus today — one producer, one operator, said plainly (v1 §5), with what follows from it.
## 8. Threat model — docs/THREAT_MODEL.md condensed into one table (defended / partly / out of
scope, whose job) and the 11 design rules with their status (e.g. SRI only partial today).
## 9. Security history — class-level, linking SECURITY.md, including this week's four: the
anonymous-post proof check before storing (#78), chain-sync trust (#88), retention grouping (#98),
the browser checking messaging keys (#101).
## 10. Verify without TET — the standalone verifier (#104): Level 1 offline ("this key signed this
hash"); Level 2 inclusion with a chain copy (only internal consistency until producer signatures).
## 11. Sign in with TET — design (#97): origin-bound challenges, per-site keys, membership-only
anonymous mode, no SMS/email/push, the lost-words limit; not built.
## 12. Shelter and human spaces — proves: a vouched member wrote it, not served to crawlers;
doesn't prove: no AI was used (#105).
## 13. Roadmap — Phases 0 and 1 dated; 2–10 as vision; Phase 2's external audit and Phase 3's
multiple producers explained as prerequisites for section 1 to be fully true.
## 14. What TET is not — not money, not a smart-contract platform, not IP privacy, not a company,
and not yet decentralized.

## Depends on (written as "planned" or left out until merged)
#100, #104, #105, #106, #97; the infra items (the paper says they're in place only once done).

## Questions for the founder
1. The comparison table: are these seven the right ones, and is "what TET leaves to it" fair?
2. Section 9: name the four fixes by PR number, or only by class?
3. Japanese edition of v2 at the same time, or English first?
