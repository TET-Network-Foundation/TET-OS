# Provisioning the "Try TET" host

Design: [`docs/DEMO_NODE.md`](../../docs/DEMO_NODE.md). Nothing here depends on a hosting provider:
any plain Ubuntu 24.04 host works. For testnet-2 **one host is both the demo and the chain's only
producer** (`TET_NODE_ROLE=demo-producer`); a separate `seed` or `demo` follower can join later.

## 1. The host (any provider)

- **Machine:** Ubuntu 24.04, 2 vCPU, 4 GB RAM, 40 GB disk or more; public IPv4 and IPv6; **your SSH
  key** at creation (no password login).
- **Account:** in an adult's name, with **two payment methods** on file and the billing email read
  every week (`docs/OPS_CHECKLIST.md`). A host lost to a missed payment is lost with its data.
- **Provider firewall** (in the provider's console; inbound, TCP only). `provision-seed.sh` prints
  the same list at the end of its run:

  | Port | For | Note |
  |---|---|---|
  | `8443/tcp` | SSH | The host's SSH port (also works from networks that block outbound 22). |
  | `22/tcp` | SSH | Only until you have logged in on 8443 once; then close it here and run the script again with `TET_SSH_KEEP_22=0`. |
  | `8002/tcp` | P2P | Like any node. |
  | `80/tcp` | ACME, redirect | Caddy gets its certificate here. |
  | `443/tcp` | The /try page | Caddy. |
  | anything else | deny | `5010` (the node API) is bound to 127.0.0.1 and never published. |

- **DNS:** `A` and `AAAA` records for the demo name pointing at the host, **before** provisioning,
  so Caddy can get its certificate. Names that redirect to it (`TET_DEMO_REDIRECTS`) need records
  too. No TET name may keep pointing at an address that is no longer ours.
- **Cloud config (optional):** `deploy/demo/cloud-config.yaml` enables `ssh.socket` on 8443 and 22
  and adds **no** firewall rules. Don't put nftables/iptables reject rules in a cloud-config: a
  reject answers with a reset, which looks from outside like sshd isn't listening.

## 2. healthchecks.io

A new check, `tet-demo`:
- **Period 2 minutes, grace 5 minutes.**
- **Integrations:** Discord, as before.
- Copy its ping URL.

## 3. Provision

The chain's genesis file is made once by the owner for the new chain: `{"chain_id",
"founder_wallet_id", "treasury_address", "genesis_hash"}`. It never holds the dev values; the node
refuses them with `TET_ENV=testnet`.

```bash
# from the repository root, on your machine (first login: port 22, until 8443 is confirmed)
scp genesis.json root@<host>:/etc/tet/genesis.json
COPYFILE_DISABLE=1 git archive --format=tar <commit> \
  | ssh root@<host> 'mkdir -p /opt/TET-OS && tar -x -C /opt/TET-OS'
ssh root@<host> 'cd /opt/TET-OS && \
  TET_NODE_ROLE=demo-producer TET_CHAIN_ID=<chain id> \
  TET_DEMO_DOMAIN=<name> TET_DEMO_ACME_EMAIL=<you@…> \
  TET_DEMO_REDIRECTS="<other names>" \
  TET_HC_URL=<ping url> \
  bash deploy/provision-seed.sh'
ssh -p 8443 root@<host> true && echo "8443 works"      # then close 22 in the provider firewall and:
ssh -p 8443 root@<host> 'cd /opt/TET-OS && TET_SSH_KEEP_22=0 TET_NODE_ROLE=demo-producer TET_CHAIN_ID=<chain id> TET_DEMO_DOMAIN=<name> TET_DEMO_ACME_EMAIL=<you@…> bash deploy/provision-seed.sh'
```

Before it touches the host, `provision-seed.sh` refuses:
- a missing or dev chain id;
- a genesis file for another chain, or with the dev founder or treasury;
- a demo-producer with a bootnode, or without mining;
- a demo follower without bootnodes;
- a follower with no `TET_PRODUCER_PEERS`.

Then it:
- writes `.env` with `TET_ENV=testnet` and the genesis values;
- generates the node's **own** libp2p key;
- sets SSH to 8443 (and 22 until closed);
- applies ufw;
- starts `tet-core`, `ui` and `caddy` (Caddy only after tet-core proves public mode);
- installs the liveness probe and a **weekly backup** (`scripts/backup-node-data.sh`, into
  `/var/backups/tet`);
- prints the PeerId, the bootnode line and the provider firewall rules.

A follower joining later uses `TET_NODE_ROLE=demo` or `seed` with `TET_BOOTNODES=<that line>` and
`TET_PRODUCER_PEERS=local-wallet=<PeerId>`.

## 3b. Backups leave the host every week

```bash
ssh -p 8443 root@<host> 'ls -1t /var/backups/tet/*.tar.gz | head -1'           # the newest
scp -P 8443 root@<host>:/var/backups/tet/tet-node-data-<stamp>.tar.gz* .       # tarball + .sha256
shasum -a 256 -c tet-node-data-<stamp>.tar.gz.sha256
```

Keep them on a machine that isn't the host, and isn't at the same provider. To restore, unpack into
an empty data directory (or volume) and start the node there; `tools/node-backup/test_backup_restore.py`
does exactly that against a local node.

## 4. Updating it later

The same as the seeds' update line (`docs/RUNNING_A_NODE.md`), with the **demo** overlay instead of
the seed overlay:

```bash
COPYFILE_DISABLE=1 git archive --format=tar <commit> | ssh -p 8443 root@<host> 'tar -x -C /opt/TET-OS'
ssh -p 8443 root@<host> 'cd /opt/TET-OS && f="-f docker-compose.yml"; grep -q "^RISC0_SKIP_BUILD=1" .env && f="$f -f docker-compose.dev.yml"; f="$f -f deploy/demo/docker-compose.demo.yml"; grep -q "^TET_AUTO_MINE=1" .env && f="$f -f deploy/demo/docker-compose.producer.yml"; TET_GIT_SHA=<commit> docker compose $f up -d --build tet-core ui caddy && install -m 0755 deploy/seed-healthcheck.sh /usr/local/bin/tet-healthcheck && install -m 0644 deploy/systemd/tet-healthcheck.service deploy/systemd/tet-healthcheck.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl restart tet-healthcheck.timer && echo MONITOR-REFRESHED'
```

`TET_GIT_SHA=<commit>` (the same full commit as the `git archive`) is compiled into both images: the
node reports it in `GET /status/live` (the try page's **Live** channel) and the page's "verify this
page" names it. An archive has no `.git`, so the build can't find it on its own; left out, both say
the build doesn't name its commit.

## 4b. Sign the build (after each UI deploy)

The UI build writes `/build-manifest.json` (every file the site serves, with its SHA-256). On your
own machine, with the publisher key. Build the deployed commit yourself first (the same Docker image
the demo builds, then `node scripts/build_manifest.mjs --out mine.json`): the script signs only if
the served manifest is byte-identical to yours.

```bash
cd tet-network/ui
TET_PAPER_CHAIN_ID=<chain id> TET_PAPER_GENESIS_HASH=<genesis_hash from genesis.json> \
  node --experimental-strip-types scripts/sign_build_manifest.mjs https://tetnet.org --local mine.json --publish
node --experimental-strip-types scripts/verify_site.mjs https://tetnet.org --commit <deployed sha>   # VERIFIED
```

`--commit` is required (or `--any-commit`): a signature only proves a build was signed once, so the
check must also know which build should be live, or an older signed build would pass (a rollback).

## 5. Check from outside

```bash
curl -s https://try.<your domain>/tet-node-api/status | head -c 200               # 200, JSON
curl -s https://try.<your domain>/tet-node-api/status/live | head -c 300          # 200: height, peers, commit
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://try.<your domain>/tet-node-api/ledger/mine   # 404
curl -s -o /dev/null -w "%{http_code}\n" https://try.<your domain>/tet-node-api/metrics             # 404
for i in $(seq 1 60); do curl -s -o /dev/null -w "%{http_code} " https://try.<your domain>/tet-node-api/status; done; echo   # 429s appear after the burst
```

## 6. Turning on the file-fee sponsor

Optional, and off until you do this. The sponsor pays visitors' file fees under the caps in
`docs/DEMO_NODE.md`; without it, the page says each fee is unpaid (the file is delivered either way).

1. **Make a demo-only wallet** on your own computer. It must not be a seed's or your founder wallet:
   ```bash
   cargo run -q -p tet-cli -- keys generate --words 12
   ```
2. **Fund it** from the founder wallet in the desktop with a fixed budget, for example 50 TET
   (50,000 fees). The sponsor stops at 10 TET.
3. **Put its 12 words on the demo host only,** readable by root only:
   ```bash
   ssh -p 8443 root@<host> 'umask 077 && cat > /etc/tet-demo/sponsor.mnemonic'   # paste the words, Enter, Ctrl-D
   ssh -p 8443 root@<host> 'cd /opt/TET-OS && docker compose restart tet-core && sleep 10 && docker logs tet-core-mainnet 2>&1 | grep demo-sponsor | tail -1'
   ```
   The log line should read `[demo-sponsor] on; sponsor wallet <id>`, with the wallet you funded.
4. **To turn it off,** delete the file and restart tet-core.

Caps can be changed in `.env`: `TET_DEMO_SPONSOR_PER_IP` (5), `TET_DEMO_SPONSOR_PER_WALLET` (5),
`TET_DEMO_SPONSOR_GLOBAL` (500 a day), `TET_DEMO_SPONSOR_FLOOR_TET` (10).

## 7. The "message the demo" address

Optional. Set `TET_DEMO_CONTACT=<64-hex wallet id>` in the demo host's `.env` to a wallet **you read in
the desktop** (not a seed's, not the founder's), and rebuild the UI (`up -d --build ui`). The try
page then offers it as a first recipient. Register that wallet's messaging keys in the desktop
first, or messages to it will be refused. Unset, the page suggests messaging yourself instead.

## 8. The questions board ("AI asks a human")

Optional. The questions board is an ordinary board (part 1) whose invite is **public**: anyone can
read the questions, and only the asking agent can read the answers.

1. On the try page, **Start a board** named "Questions", and save the board wallet's 12 words it
   shows (only needed to re-register the board's keys).
2. Put its invite link in the demo host's `.env` as `TET_QUESTIONS_INVITE=<the whole link>` and
   rebuild the UI (`up -d --build ui`). The page then opens it in "AI asks a human".
3. Agents post with the SDK (`tet-agent-sdk`: `registerAgentInbox`, then `postQuestion` with the
   board's wallet id and the owner's manifest). See `docs/DEMO_NODE.md`.

## 9. The public-board directory

Optional. The directory is an ordinary board whose invite is **public**: anyone can read it, and
its posts are the listings. A board is listed only by an announcement **its own wallet** signs, so
nobody can list a board they don't own (`tet-network/ui/app/lib/board_directory.mjs`).

1. On the try page, **Start or open a board** → **Invite only**, named "Directory". Save the board
   wallet's 12 words it would need to re-register its keys (they are not needed to list boards).
2. Put its invite link in the demo host's `.env` as `TET_DIRECTORY_INVITE=<the whole link>` and
   rebuild the UI (`up -d --build ui`). The page then shows **Public boards**, and **Start or open
   a board** offers **Public (listed)**.
3. Listings last 7 days (the node's Tmail TTL); a board's creator lists it again with the board's
   12 words. The page reads the directory's newest 200 posts.

## 10. Hiding content (operator)

The Terms panel says the operator may hide a board, thread, post or file from this node's public
API, that hiding never deletes chain data, and that every hide is logged. This is how.

One-time: give the node an admin key in `/opt/TET-OS/.env` (never commit it), then restart tet-core
with the up command in §4:

```bash
echo "TET_ADMIN_API_KEY=$(openssl rand -hex 32)" >> /opt/TET-OS/.env
```

The key never leaves the host: `deploy/operator-hide.sh` runs the request inside the container, so
it comes from loopback (the only place the node answers `/operator/*`; Caddy and the page's proxy
never forward it) and reads the key from the container's environment.

```bash
deploy/operator-hide.sh hide wallet <board wallet id> "report 2026-10-12: reason"   # a whole board
deploy/operator-hide.sh hide msg <msg_id> "reason"                                   # one post
deploy/operator-hide.sh hide file <file uuid> "reason"
deploy/operator-hide.sh unhide <kind> <id> "reason"
deploy/operator-hide.sh list
deploy/operator-hide.sh log          # /data/operator.log: one JSON line per hide/unhide
```

A thread: on your own machine, with the invite from the report,

```bash
cd tet-network/ui
TET_NODE=https://<domain>/tet-node-api node --experimental-strip-types scripts/operator_thread_ids.mjs '<invite>'           # list threads
TET_NODE=https://<domain>/tet-node-api node --experimental-strip-types scripts/operator_thread_ids.mjs '<invite>' <thread id>
```

then hide each printed `msg_id`. The invite stays on your machine; the node only sees an inbox read.

Hiding a wallet also hides everything it sent (its directory listing included) and refuses new
posts and files to or from it. Copies other nodes already hold stay on those nodes. Reports go to
abuse@tetnet.org and are reviewed within 48 hours.

## Before going public (checklist)

1. **No test boards in the public directory.** List them, then hide each test one (this keeps the
   chain and everyone's copies; it only stops this node serving them):
   ```sh
   # on any machine, in tet-network/ui
   TET_TRY_ORIGIN=https://<this host> NEXT_PUBLIC_TET_DIRECTORY_INVITE=<directory invite> \
     node --experimental-strip-types scripts/list_public_boards.mjs
   # on the host, for each test board
   deploy/operator-hide.sh hide wallet <board wallet> "test board before launch"
   ```
2. **The sample is marked** on this node and `TET_SAMPLE_CODE` is set (§11).
3. **Every page in ja and en** looks right (the i18n guard checks the strings; look at the pages).

## 11. Proof codes (the public signature registry)

Nothing to set up. Proof codes (Sign → **Get a proof code**, and the home search) live in the
node's public signature registry (`tet-core/src/sigs.rs`, `POST /sigs/publish`, `GET /sigs/search`).

- A record is stored only with its signer's consent for exactly its bytes, so nobody can publish a
  `.sig.json` they were given. Search by proof code, file SHA-256, signer and date.
- Limits: 16 KB per record, 1,000 per signer, a node-wide total (`TET_SIGS_MAX_TOTAL_BYTES`,
  default 256 MiB); each publish is charged to the client's daily upload budget. Records don't
  expire.
- Takedown: hiding a signer's wallet (§10) stops their records being listed.
- **The home page's "try it: verify this sample"**: once the node is up, run
  `TET_TRY_ORIGIN=https://<this host> node --experimental-strip-types scripts/make_sample.mjs`
  (in `tet-network/ui`). It marks `public/sample/tet-sample.txt` with a throwaway ID and prints
  `NEXT_PUBLIC_TET_SAMPLE_CODE=…`; put that code in `.env` as `TET_SAMPLE_CODE=…` and rebuild the UI.
  Without it the home page simply has no sample link.
