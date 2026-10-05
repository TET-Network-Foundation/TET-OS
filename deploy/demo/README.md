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
