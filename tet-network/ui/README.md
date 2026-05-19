This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

## Phase 0 Autonomous AI Economy E2E

Run `tet-core` with auto-mining, mock ZK, and the POC worker daemon enabled:

```bash
cd /Users/sengokukazuma/Nexus_Network/tet-core

export PORT=5010
export TET_REST_BIND=127.0.0.1:5010
export TET_DB_DIR=tet-e2e-ai.db
export TET_ALLOW_MOCK_ZK=1
export TET_AUTO_MINE=1
export TET_BLOCK_TIME_SEC=3
export TET_DEV_FORCE_POC=1
export TET_WORKER_DAEMON=1
export TET_WORKER_DAEMON_ALLOW_WALLET_ALIAS=1
export TET_WORKER_DAEMON_MOCK_INFERENCE=1
export TET_WORKER_DAEMON_POLL_MS=1000
export TET_CONSENSUS_LEADER_MODE=hash
export TET_BASE_BLOCK_REWARD=0.1
export TET_JOULES_PER_FLOP=0.000001
export TET_NETWORK_DIFFICULTY_GAMMA=1
export TET_THERMO_STEVEMON_MICRO_SCALE=1

# Use the same wallet in the UI and node. Copy both from the UI Wallet dialog after unlock/import.
export TET_WORKER_MNEMONIC="paste the 12-word UI wallet mnemonic here"
export TET_WALLET_ID="paste the 64-hex UI Wallet ID here"
export TET_VALIDATOR_IDS="$TET_WALLET_ID"
export TET_DEV_FAUCET_MICRO=1000000000

RISC0_SKIP_BUILD=1 cargo run --bin TET-Core
```

Start the UI:

```bash
cd /Users/sengokukazuma/Nexus_Network/tet-network/ui
cp .env.example .env.local
# NEXT_PUBLIC_TET_TREASURY_ADDRESS must match the node's TET_TREASURY_ADDRESS
NEXT_PUBLIC_TET_CORE_URL=http://127.0.0.1:5010 npm run dev
```

Genesis hash alignment: see [`docs/RUNNING_A_NODE.md`](../../docs/RUNNING_A_NODE.md) (Sovereign OS UI env) and `node scripts/verify-genesis-hash.mjs`.

Test flow:

1. Open `http://localhost:3000`, create/import the same wallet mnemonic, and unlock it.
2. Go to `AI Task Terminal`, enter a prompt, then click `SEND PROMPT TO AI`.
3. Confirm the terminal logs `POST /enterprise/inference/submit` and a queued `task_id`.
4. Watch `Latest block height` advance as the auto-miner runs.
5. Watch `Worker Pool` decrease and `My wallet` increase after the daemon submits `VerifyZkProof`.
6. Check `Recent blocks` for blocks with `tx_count > 0`; those contain the demand/proof lifecycle.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
