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

**Two seeds, one block producer.** There are two public seeds, in Helsinki and Nuremberg, and either
is enough for a new node to join and sync. Only Helsinki produces blocks, so liveness depends on one
machine: if it is down, the network stops making blocks. It is also a single point of censorship and a
single operator's machine. There is no committee and no failover.

**The producer can wedge, and it did for 33 hours.** On 2026-10-03 the producer's block-plane
event loop stopped, and the network made no blocks for 32 h 53 m. Monitoring went red at once;
nothing restarted the node and nobody saw the alert. The node now exits after 180 s of stall so its
supervisor restarts it, the host probe restarts a producer it cannot read, and alerts go to a phone.
The wedge's cause is not yet fixed. See
[the postmortem](docs/postmortems/2026-10-04-producer-wedge-33h.md).

**Hybrid signatures: identity binding currently rests on Ed25519 alone.** Until the Phase 1
genesis, the ML-DSA key is not bound to the wallet id, so a signature's post-quantum half does not
tie it to the sender. Each signature is still verified, and the Ed25519 half authenticates the
wallet. The fix (the wallet id commits to both public keys, ML-DSA level pinned at 44) changes every
wallet id and is scheduled for Phase 1.

**Blocks are authenticated by the producer's PeerId, not yet by a producer signature.** Followers pin
the producer's PeerId by default, for blocks that arrive by gossip and by sync alike; the sole
producer takes no blocks from peers unless its operator names one. The full producer signature lands
at Phase 1.

**Anonymity is weak today, by construction.** An anonymous sender is anonymous among the
registrations *their node has seen*. On today's testnet that set is small, so the anonymity set is
small. Registration is free, so there is no sybil resistance until the Phase 1 escrow. This is
disclosed in the product itself, not only here.

**What an anonymous send reveals, and to whom.** The node receives a download of its whole registry,
a content-addressed receipt and an envelope signed by a one-day key. None of these names the sender,
and two guards check that: the node half in tet-core (requests, logs and stored state) and the client
half in `scripts/anon_poster_guard.mjs`. The member secret goes only to the native prover on the
sender's own machine (`tet-prover-host`, loopback only). Not hidden: the sender's IP address and
request timing, from their node and the first relaying peer. Registration itself is public.

**Fixed: the desktop's anonymous mode could send a named message.** Before #17, ticking *Send
anonymously* sent the wallet id to the node
(`POST /tmail/anon/send`). Once that answered, the button sent an ordinary envelope signed by the
user's own wallet. Anyone who used anonymous mode from the desktop before then should treat those
messages as signed by their own wallet. Anonymous sends from the step scripts were not affected.

**Fixed: a transaction did not have to be signed by the wallet it acts for.** Until 2026-10-08 a
validly signed transaction was accepted without checking that its signer was the wallet it debits,
registers or claims for. Since 01d7192, deployed on both seeds on 2026-10-08, every node refuses such
a transaction at admission and when it applies a block. The whole chain up to block 104,006 was
checked before the fix was deployed: no transaction had been signed by a wallet other than the one it
acts for.

**Fixed: an anonymous post whose proof did not verify could still be kept and passed on.** Until
2026-10-09 a node checked an anonymous post's proof only after storing it: a post whose proof failed
was labelled as failed, but it was still kept, served and relayed to other nodes. Since f5f968a,
deployed on both seeds on 2026-10-09, a node checks the proof before it stores anything, refuses a
post whose proof fails with the reason, and deletes a failed post that reaches it any other way.
Such posts were always labelled as failed; none was shown as verified.

**Fixed: blocks received during chain sync were not held to the producer pin.** Until 2026-10-09 the
producer-PeerId pin applied only to blocks that arrived by gossip; blocks and height announcements
that arrived through chain sync were taken from any connected peer. Since 8239d10, deployed on both
seeds on 2026-10-09, a node takes them only from trusted peers: a follower from its pinned producer,
and the sole producer from no peer unless its operator names one. Transaction signatures were checked
throughout, so no balance could move without its wallet's signature.

**Fixed: pages trusted the messaging keys a node served.** Until 2026-10-11, the page encrypted
direct messages and files to whatever messaging keys the node returned for a wallet, without
checking that wallet had signed them, so a dishonest or compromised node could have substituted its
own keys and read what was sent after that. Since bea1e45, deployed on both seeds on 2026-10-11,
keys are registered only with a v2 signature by the wallet (Ed25519 + ML-DSA-44, PAE
domain-separated), and the browser checks that signature before encrypting and checks each
sender's signature before showing who sent something; older registrations are refused until their
owner opens TET once. Each conversation shows a safety number: the guarantee that only the two
people can read their messages holds when they have compared it. The page's own code still has to
be trusted (see the threat model).

**Fixed: unverified anonymous posts could push a verified one out of a board.** Until 2026-10-10,
anonymous posts were grouped for message retention by a value they announce before their proof is
checked, so posts whose proofs would later fail could share a verified post's group and cause it
to be deleted. Since 39036cf, deployed on both seeds on 2026-10-10, only a value from a verified
proof groups posts; an unverified post stands alone. No post could be forged or deanonymised this
way.

**Fixed: one invalid transaction could make the block producer drop every pending transaction.**
Until 2026-10-10, a transaction that the network accepted into its pending pool but a block would
refuse (sent by anyone, from a free wallet) made the producer's next block fail, and every pending
transaction was lost with it; repeated, this could keep all transactions off the testnet. Since
26744ca, deployed on both seeds and the demo node on 2026-10-10, transactions no block can accept,
and transfers their sender can't cover (counting the sender's other pending transfers), are refused
when they arrive; a block is built without any transaction that would break it, and only that one is
dropped. No balance could change without its wallet's signature. This issue's class was named by
mistake in a public branch a few hours before the fix was deployed; working logs are now kept out of
the repository.

**Fixed: a message's time was not checked against the node's clock.** Until 2026-10-11, the time a
sender put on a message or post was stored as given, so a post could be dated anywhere: backdated
to the top of a board thread, dated in the future to be kept past the retention limit, or (for an
anonymous post) dated on another day. Since 404bd86, deployed on both seeds and the demo node on
2026-10-11, a node refuses a message whose time is more than 5 minutes from its own clock, saying
"your device clock is off", and an anonymous post must be dated on the node's current UTC day. The
nodes keep their clocks in sync, and their health check fails if they don't. No message could be
read or forged this way.

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
Win95 boot sequence are specified and not built. Their tests are marked #[ignore] on purpose and stay red until
the Phase 1 genesis (AT-5(b), AT-7(b)), so a green suite cannot be read as Pin or escrow working.

**The testnet runs on a development chain id.** The public testnet runs with chain_id tet-local-dev
and a placeholder treasury address. Renaming the chain is a genesis change and lands at Phase 1;
every signature, including the devlog's, is bound to the current id and will be re-signed then.

## Branch protection

`main` is protected by a repository ruleset that targets the default branch:

- changes land only through a pull request;
- five CI checks must pass, each pinned to GitHub Actions so nothing else can report them green:
  `rust (build, test, guards)`, `ui (next build)`, `shell (shellcheck deploy scripts)`,
  `wasm (tet-pqc-wasm → ui/public/pqc)`, `docker (images build)`;
- force pushes and deletion of `main` are blocked;
- nobody can bypass it.

It requires **zero** approving reviews. This is a one-maintainer project, and GitHub does not let
the author of a pull request approve it, so a required approval would mean nothing could be merged.
Every change is still a reviewed diff with green CI; it is not a second person's review.

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
