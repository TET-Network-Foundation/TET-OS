# Security Policy

TET is a **Phase 0 public testnet and developer preview**. It has not been audited. The token has
no value. Run it on hardware and with keys you are willing to lose.

## Reporting a vulnerability

Email **tetsteve@proton.me**. Please include:

- what the issue is and which component (`tet-core`, the UI, the ZK guest, the specs),
- how to reproduce it, ideally the smallest input that triggers it,
- what an attacker gains — funds, divergence, deanonymisation, denial of service.

Please report privately first and give us a chance to fix it before publishing. Do not open a public
issue for anything that lets someone move funds, fork the chain, or deanonymise a sender.

**What to expect.** This is a one-person project, so honesty about response times matters more than
a policy that sounds good: an acknowledgement within **7 days**, and an assessment with a fix plan
or a reasoned "won't fix" within **30 days**. If you have not heard back in 7 days, assume the mail
went astray and send it again.

**There is no bug bounty.** No money, no swag, no promises. If you want credit you will get it in
the commit and the release notes; if you would rather not be named, say so.

## Scope

**In scope:** the node (`tet-core`), the Sovereign OS UI, the RISC0 guest and verifier, the Tmail
and Files protocols, the public seed node, and defects in the specs where the design itself is
unsound.

**Out of scope:** the known limitations below — they are documented, not undiscovered; anything
requiring physical access to a user's unlocked device; denial of service by brute traffic volume
against a testnet with one seed; dependency CVEs with no demonstrated path to impact here (send a
report if you can show the path); and social engineering.

## Known limitations

These are stated as classes, deliberately without exploitation detail. They are design status, not
secrets.

**Not audited.** No third-party security review has been performed on any part of this system. The
audit document in this repository is self-authored and is a working record, not an independent
assessment.

**The signature stack is young.** Hybrid Ed25519 + ML-DSA-44 signing depends on `dilithium-rs`, a
small crate that has not itself been audited, and it carries every signature in the system. The KEM
is Kyber Round-3, not the final FIPS-203 ML-KEM; migrating is a Phase 1 item because it invalidates
every existing messaging identity.

**One seed node.** The network has a single well-known seed. It is a single point of failure, a
single point of censorship, and a single operator's machine. There is no committee and no failover.

**Anonymity is weak today, by construction.** An anonymous sender is anonymous among the
registrations *their node has seen*. On today's testnet that set is small, so the anonymity set is
small. Registration is free, so there is no sybil resistance until the Phase 1 escrow. This is
disclosed in the product itself, not only here.

**Some balance writes do not go through consensus.** A number of paths still change balances outside
the block pipeline. They are all signed or admin-gated — none is anonymous — but a signature
authorises a caller, it does not put a write through consensus, so two nodes can disagree about
state while their block history stays identical. Consensus-routing these is a Phase 1 genesis item.

**Wall-clock time is a consensus input.** Block application reads the node's own clock when deciding
whether time-locked balance is spendable. Two nodes applying the same block either side of a lock
expiry can reach different results. This is the single most important Phase 1 consensus fix.

**Invalid ZK receipts are refused but not punished.** Slashing has to be a consensus transaction,
and that variant does not exist yet, so an invalid receipt is rejected without penalty.

**Acceptance tests that are red on purpose.** Pinned messages, the anonymous-sending escrow, and the
Win95 boot sequence are specified and not built. Their tests fail deliberately rather than being
quietly skipped, so that nothing reads as shipped when it is not.

## Key material published in this repository's history

Between 2026-05-10 and 2026-05-26 this repository tracked runtime artefacts that contained real key
material, and the repository was public for part of that period. Specifically: four ML-DSA-65
**node** secret keys from local development databases, and one testnet wallet JSON containing a
24-word mnemonic.

The history was rewritten on 2026-09-26 and the repository recreated on 2026-09-28 to remove them —
a force-push alone was not enough, because GitHub keeps merged pull-request refs that a force-push
does not touch, and those refs still served the keys.

**All of that material is treated as compromised permanently, and none of it is reused.** It was
verified before the rewrite that none of it corresponds to anything in use: the seed node's libp2p
identity was never committed at all, the seed's node key does not match any of the four, and the
wallet address holds a zero balance and is not the genesis founder or the treasury. Removal reduces
casual exposure; it does not un-publish anything. If you find those keys in a mirror or a cached
clone, they are known and dead.
