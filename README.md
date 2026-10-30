# TET

**A key you own · a membership proof that does not say who · a shared clock.**

TET is a public test network. You hold your own key, made in your browser. You can show you are a
member of a group without saying which member. Records are ordered by one shared chain, so anyone
can check that something existed before block N. Every signature is two signatures, Ed25519 and
ML-DSA-44, and the page checks them in your browser instead of trusting a server.

Try it: **<https://tetnet.org>** (no sign-up).

## What TET is not

- **Not a token.** Testnet units are practice units. They can't be exchanged for anything, and this
  chain will not become a mainnet.
- **Not a market.** Nothing is listed, offered or traded here.
- **Not tracking.** The chain holds public keys and proofs, never your passwords, personal data or
  private keys. Nodes do see network addresses and timing (see Limits).
- **Not a claim that an object is genuine.** A tag check shows that a chip knew a key when it was
  tapped. A tag can be removed and moved; the check is about the chip, not the object it is on.

## Running today, prototype, in design

| Running today | Prototype (code public, tests green) | In design |
|---|---|---|
| The demo at tetnet.org and two seeds: Helsinki makes the blocks, Nuremberg is a full node | Tag verifier `tet-tag-verify`: NTAG 424 DNA tap check (AN12196), per-tag keys (AN10922 `derive`), a `serve` prototype; 50 tests (PR #150, draft) | Tag registration and owners on TET (`GENUINE_TAG.md`, PR #149) |
| Sign a file or text; stamp its hash on chain to show it existed before block N | Hash-only stamp for "Mark as genuine": merged on main (#148), not yet confirmed on the demo | A new chain on Phase 1's blocks, with the time in the block header; today's records archived |
| Verify a signature, a proof code or a stamp, also offline | Phase 1 (PR #151, open, not merged): blocks carry a producer signature and a timestamp (`ts_ms`); the validator set is read from genesis | `wallet_id_v2`: the ML-DSA key bound to the wallet ID |
| Boards: anonymous posts that show a member wrote them, not which one (RISC Zero membership proof) | | Moving the message key exchange from Kyber-768 (Round 3) to ML-KEM (FIPS 203) |
| End-to-end encrypted messages, and encrypted files up to 100 MB kept 7 days | | More block producers, and an external audit |
| Sealed predictions: only a salted hash is posted until you reveal the text | | Agent identity for AI agents |

## How it differs

- **Each check says what it shows and what it does not.** A valid signature shows which key signed
  these bytes, not who holds the key. An anonymous post shows a member wrote it, not which one.
- **Nodes hold nothing worth taking.** They keep public keys, signatures, proofs and ciphertext; no
  passwords or private keys. For tags, the design keeps the maker's master key with the maker and
  gives a verifier per-tag keys only (in design: today's `serve` prototype still accepts a
  master-key file).
- **Built for thirty items.** The tag plan starts with one maker and thirty tags, not a catalogue.
- **One key model for people, objects and agents.** People and AI agents sign with the same hybrid
  key pair (the browser and `tet-agent-sdk`). An object is named by its tag's ID and registered
  with its maker's key (in design).
- **Records outlive the operator.** A signed record checks offline, without TET's servers. When the
  new chain starts, today's records are archived rather than dropped (in design).

## Where it goes

All of this is in design; nothing below is live.

1. **December 2026:** one maker, thirty tags.
2. **Early 2027:** a new chain with the time in the block header; today's records archived.
3. **Then:** small brands, and identity for AI agents.

## Links

- The demo: <https://tetnet.org>
- Tag verifier README: [`tet-tag-verify/README.md`](https://github.com/TET-Network-Foundation/TET-OS/blob/tag-verify-core/tet-tag-verify/README.md) (on the PR #150 branch)
- Tag plan: [`docs/plans/GENUINE_TAG.md`](https://github.com/TET-Network-Foundation/TET-OS/blob/plan-genuine-tag/docs/plans/GENUINE_TAG.md) (on the PR #149 branch, design only)
- [PR #150](https://github.com/TET-Network-Foundation/TET-OS/pull/150): the tag verifier (draft)
- [PR #151](https://github.com/TET-Network-Foundation/TET-OS/pull/151): Phase 1, main merged into it (draft, not merged)

Maintained by Steve (Kazuma Sengoku).

## Limits

- **Testnet.** One block producer and one operator today; a sustained attack, or the operator, can
  stop it. The chain may be reset.
- **No external audit yet.**
- **Quantum resistance is incomplete.** Every signature is hybrid, but the wallet ID is the Ed25519
  key until `wallet_id_v2`. Messages use X25519 + Kyber-768 (Round 3), not the final ML-KEM standard.
- **The genesis holds a founder wallet**, locked for one year, and a treasury address. Testnet units
  can't be exchanged for anything.
- **Nodes see network addresses and timing.** Use Tor or your own node if that matters to you.
- **Lose your 12 words and nobody can recover your key.**

## Read more

- **Technical paper v2:** <https://tetnet.org/whitepaper> (source
  `tet-network/ui/app/whitepaper/paper.ts`; HTML and PDF in `tet-network/ui/public/paper/`).
- **Security:** [`SECURITY.md`](./SECURITY.md) and [`docs/THREAT_MODEL.md`](./docs/THREAT_MODEL.md).
- **Contributing:** [`CONTRIBUTING.md`](./CONTRIBUTING.md).
- **Discord:** <https://discord.gg/ANcpc76k8m> (questions and reports; security problems go through `SECURITY.md`).
- Older documents are in [`archive/`](./archive): historical, not the current design.

## Repository

- [`tet-core/`](./tet-core): the node (Rust), one binary, `TET-Core`.
- [`tet-network/ui/`](./tet-network/ui): the web app (Next.js): the `/try` page, the technical paper,
  the offline verifier.
- [`tet-pqc-wasm/`](./tet-pqc-wasm): ML-DSA-44 compiled to WebAssembly for the browser. The build
  artifact is gitignored; a fresh clone builds it (see `docs/RUNNING_A_NODE.md`).
- [`tet-agent-sdk/`](./tet-agent-sdk): signing for AI agents, with the same hybrid keys.
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
