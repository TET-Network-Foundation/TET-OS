# Run your own TET node

A short guide. The full reference is `docs/RUNNING_A_NODE.md`.

## Why

- **Check for yourself.** Your node verifies every block and signature itself; you don't have to
  trust the demo server.
- **The page can talk to your node.** Run the web app locally and it uses your node, not ours.
- **The network gets stronger** with every independent copy of the chain.

What your node does **not** do: it doesn't produce blocks (one producer today, more planned), and it
doesn't hold anyone's keys.

## What you need

A machine with Docker, about 4 GB of RAM, a few GB of disk, and an outbound internet connection. No
open ports are needed to follow the chain.

## Three steps

```bash
git clone https://github.com/TET-Network-Foundation/TET-OS.git
cd TET-OS
cat >> .env <<'ENV'
TET_ENABLE_P2P=1
TET_PRODUCER_PEERS=local-wallet=12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC
TET_BOOTNODES=/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC,/ip4/46.224.223.54/tcp/8002/p2p/12D3KooWSam648Et2FXCUrqUBM6AEoZR5GAwDnoMG77JnA3ajonM
TET_AUTO_MINE=0
ENV
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

Most of the time is the first Docker build.

## Check you're on the same chain

Equal height isn't enough; compare the block id and the state root at the same height with what the
public node shows:

```bash
H=$(curl -sf http://127.0.0.1:5010/ledger/state | jq '.block_height')
curl -sf http://127.0.0.1:5010/ledger/block/$H | jq '.block | {height, block_id, state_root}'
curl -sf https://tetnet.org/tet-node-api/ledger/state | jq '{block_height, state_root}'
```

## Use it

Open `http://localhost:3000/try`: the same page as tetnet.org, talking to your node.

## Stay up to date

`git pull`, then the same `docker compose … up -d --build`. Leave the genesis settings in the
committed compose file alone: a different value is a different chain.

## When something's wrong

`docs/RUNNING_A_NODE.md` has troubleshooting. Questions: Discord (link in the README). Security
problems: `SECURITY.md`, never a public issue.
