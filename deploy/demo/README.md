# Provisioning the "Try TET" demo node

Design: [`docs/DEMO_NODE.md`](../../docs/DEMO_NODE.md). Needs tet-core with public-API mode
(PR #36) on the commit you deploy.

## 1. Hetzner

- **Server:** Hetzner Cloud → the project → **Add Server**.
  - **Location: Falkenstein (`fsn1`)**, a different datacentre from Helsinki (`hel1`) and
    Nuremberg (`nbg1`).
  - **Image:** Ubuntu 24.04. **Type:** CX22 (2 vCPU, 4 GB), the same class as the seeds.
  - **Networking:** public IPv4 and IPv6. **SSH key:** yours. **Name:** `ubuntu-4gb-fsn1-demo`.
- **Firewall:** a new one for this server only, inbound:
  - `22/tcp`, restricted to your own IP if you can. **The seeds use SSH on 443; here 443 belongs to
    Caddy.**
  - `80/tcp` (ACME and the redirect), `443/tcp` (the page), `8002/tcp` (P2P, like any node).
- **DNS:** create `A` and `AAAA` records for the demo name (e.g. `try.<your domain>`) pointing at the
  server, **before** provisioning, so Caddy can get its certificate.

## 2. healthchecks.io

A new check, `tet-demo`:
- **Period 2 minutes, grace 5 minutes.**
- **Integrations:** Discord, as on the seeds' checks.
- Copy its ping URL.

## 3. Provision

```bash
# from the repository root, on your machine
COPYFILE_DISABLE=1 git archive --format=tar <commit> \
  | ssh root@<demo-ip> 'mkdir -p /opt/TET-OS && tar -x -C /opt/TET-OS'
ssh root@<demo-ip> 'cd /opt/TET-OS && \
  TET_NODE_ROLE=demo \
  TET_DEMO_DOMAIN=try.<your domain> TET_DEMO_ACME_EMAIL=<you@…> \
  TET_BOOTNODES=/ip4/95.217.158.153/tcp/8002/p2p/12D3KooWNcdESJUC1uhuhrMn5anmsGEBhYgCkE8pCbXf8cD7MSEC,/ip4/46.224.223.54/tcp/8002/p2p/12D3KooWSam648Et2FXCUrqUBM6AEoZR5GAwDnoMG77JnA3ajonM \
  TET_HC_URL=<ping url> \
  bash deploy/provision-seed.sh'
```

`provision-seed.sh` refuses a demo role without bootnodes or a domain, or with `TET_AUTO_MINE=1`. It
generates the node's **own** libp2p key, writes its own `.env` (`TET_PUBLIC_API=1`), opens 80 and 443,
starts `tet-core`, `ui` and `caddy`, and sets the probe to follower mode (no self-restart).

## 4. Updating it later

The same as the seeds' update line (`docs/RUNNING_A_NODE.md`), with the **demo** overlay instead of
the seed overlay:

```bash
COPYFILE_DISABLE=1 git archive --format=tar <commit> | ssh root@<demo-ip> 'tar -x -C /opt/TET-OS'
ssh root@<demo-ip> 'cd /opt/TET-OS && f="-f docker-compose.yml"; grep -q "^RISC0_SKIP_BUILD=1" .env && f="$f -f docker-compose.dev.yml"; docker compose $f -f deploy/demo/docker-compose.demo.yml up -d --build tet-core ui caddy && install -m 0755 deploy/seed-healthcheck.sh /usr/local/bin/tet-healthcheck && install -m 0644 deploy/systemd/tet-healthcheck.service deploy/systemd/tet-healthcheck.timer /etc/systemd/system/ && systemctl daemon-reload && systemctl restart tet-healthcheck.timer && echo MONITOR-REFRESHED'
```

## 5. Check from outside

```bash
curl -s https://try.<your domain>/tet-node-api/status | head -c 200               # 200, JSON
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
   ssh -p 8443 root@<demo-ip> 'umask 077 && cat > /etc/tet-demo/sponsor.mnemonic'   # paste the words, Enter, Ctrl-D
   ssh -p 8443 root@<demo-ip> 'cd /opt/TET-OS && docker compose restart tet-core && sleep 10 && docker logs tet-core-mainnet 2>&1 | grep demo-sponsor | tail -1'
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
