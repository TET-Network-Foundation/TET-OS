# TET

**In an age when AI can make anything: prove "I put this out, on this day" in 10 seconds.**

Your proofs and keys, in your hands, not a company's. TET is a public **test network** for checking
who signed something, and when. Every transaction and signed record carries two signatures, Ed25519
and ML-DSA-44, and the page checks them in your browser instead of trusting a server.

Try it: **<https://tetnet.org>** (no sign-up; an ID is made in your browser).

> **Testnet. One block producer, one operator. Not audited. The units have no value:** they are
> practice units that can't be exchanged for money, and the chain may be reset.

## What works today, and what each part proves

| Part | What it does | What it proves, and what it doesn't |
|---|---|---|
| Sign | Sign a file or text with your key; optionally stamp it on chain. | This key signed these exact bytes (and, stamped, that they existed by a block). Not who holds the key, and not authorship by itself. |
| Verify | Check a `.sig.json`, a proof code, a stamp; also offline, without TET (`tet-network/ui/public/verify/`). | Each step says what it proves; a valid signature alone doesn't say who holds the key. |
| Boards | Threads with anonymous or named posts. | An anonymous post proves a member wrote it, not which one. It doesn't hide your IP from the node. |
| DM | End-to-end encrypted messages; a safety number to compare in person. | Which key sent it. The node still sees who writes to whom, and when. |
| Files | Encrypted files up to 100 MB, kept 7 days. | Only the recipient can open it. Not that the file is what its name says. |
| Sealed prediction | Seal a text now (only its salted hash is posted); reveal it later. | The text was fixed when it was sealed. Not that it was a good guess, or that the same person didn't seal others. |

## Honest limits

- **Testnet.** One block producer and one operator today; a sustained attack, or the operator,
  can stop it. More producers are on the roadmap (technical paper §13).
- **No external audit yet.** It is planned (Phase 2).
- **Quantum resistance is incomplete.** Every signature is hybrid, but the wallet ID is the Ed25519
  key and the ML-DSA key isn't bound to it until `wallet_id_v2` (Phase 1). Once it is, forging a
  transaction will require breaking both Ed25519 and ML-DSA-44. Messages use X25519 + Kyber-768
  (Round 3), not the final ML-KEM standard (FIPS 203); moving to ML-KEM is planned.
- **No token value.** Testnet units are practice units; there is no sale, and this chain can never
  become mainnet. Its genesis contains a founder wallet, locked by a one-year cliff, and a treasury
  address that collects test fees. Mainnet supply and allocation are undecided.
- **Not IP privacy.** Nodes see addresses and timing; use Tor or your own node.
- **Lose your passphrase (12 words) and nobody can recover it.**

## Read more

- **Technical paper v2:** <https://tetnet.org/whitepaper> (source
  `tet-network/ui/app/whitepaper/paper.ts`; HTML and PDF in `tet-network/ui/public/paper/`, each with
  a proof code you can check, also offline).
- **Security:** [`SECURITY.md`](./SECURITY.md) (how to report, and every known limitation and fixed
  issue) and [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md).
- **Contributing:** [`CONTRIBUTING.md`](./CONTRIBUTING.md).
- **Discord:** the invite link is posted on tetnet.org at launch.
- Older documents (whitepapers v1.0 and v1.1, status snapshots) are in [`archive/`](./archive):
  historical, not the current design.

## Repository

- [`tet-core/`](./tet-core): the node (Rust), one binary, `TET-Core`.
- [`tet-network/ui/`](./tet-network/ui): the web app (Next.js): the `/try` page, the technical paper,
  the offline verifier.
- [`tet-pqc-wasm/`](./tet-pqc-wasm): ML-DSA-44 compiled to WebAssembly for the browser. The build
  artifact is gitignored: a fresh clone builds it first (see `docs/RUNNING_A_NODE.md`).
- [`methods/`](./methods), [`prover/`](./prover): the RISC Zero membership proof (anonymous posts).
- [`deploy/`](./deploy): the seed and demo host setup.

## Quick start: run a node on the public testnet

This brings up a node that syncs from the public seeds, plus the web app. Most of the ten minutes
is the Docker build.

```bash
git clone https://github.com/TET-Network-Foundation/TET-OS.git
cd TET-OS

# Follow the public seeds. Two are listed: Helsinki produces the blocks, Nuremberg is a
# full node and bootnode that does not mine. Either will catch you up; listing both means
# one being down does not stop you joining.
# TET_AUTO_MINE=0 because the seed produces the blocks -- a second producer on the same
# genesis just races it. TET_PRODUCER_PEERS is the compose default, written out so you can see it:
# your node takes gossiped blocks only from Helsinki's PeerId.
cat >> .env <<'EOF'
TET_ENABLE_P2P=1
TET_PRODUCER_PEERS=local-wallet=12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC
TET_BOOTNODES=/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC,/ip4/46.224.223.54/tcp/8002/p2p/12D3KooWSam648Et2FXCUrqUBM6AEoZR5GAwDnoMG77JnA3ajonM
TET_AUTO_MINE=0
EOF

docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Then confirm you are actually on the seed's chain. Equal height is **not** enough (a fork can sit
at the same height), so compare `block_id` and `state_root`:

```bash
curl -sf http://127.0.0.1:5010/health/swarm | jq '.peer_count'        # 1 once the dial lands
H=$(curl -sf http://127.0.0.1:5010/ledger/blocks | jq '.[0].height')
curl -sf http://127.0.0.1:5010/ledger/block/$H | jq '.block | {height, block_id, state_root}'
```

Open **http://localhost:3000/try** for the same page as tetnet.org, against your own node.

Leave the genesis variables in the committed compose alone: they are what the seed runs, and a
mismatch changes the genesis hash, which makes every signed request fail with
`401 ed25519 verification failed`.

**The seeds' REST API is deliberately not public**: only `8002/tcp` is open, so port 5010 in the
commands above is *your* node, not the seed's.

Single node with no network, or the full three-node local stack: [`tet-core/README.md`](./tet-core/README.md).
Operator detail, env reference and troubleshooting: [`docs/RUNNING_A_NODE.md`](./docs/RUNNING_A_NODE.md).

> Commit hashes before 2026-09-26 were rewritten when key material was purged from history
> (see [`SECURITY.md`](./SECURITY.md)).

## License

Dual-licensed under either of

- Apache License, Version 2.0 ([`LICENSE-APACHE`](./LICENSE-APACHE))
- MIT License ([`LICENSE-MIT`](./LICENSE-MIT))

at your option. Unless you explicitly state otherwise, any contribution you
intentionally submit for inclusion in this work shall be dual-licensed as above,
without any additional terms or conditions.
