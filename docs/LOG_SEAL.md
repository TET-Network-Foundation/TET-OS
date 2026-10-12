# Log seal

The seeds record hashes of their own logs and configuration on TET, so a change made behind
everyone's back shows up, and a recorded log can't be quietly edited later.

Running on both seeds since 2026-10-13 (dogfood). Tool: `deploy/logseal/`. Tests:
`deploy/tests/logseal.test.sh`.

## What it does

Every 10 minutes, each seed writes a **seal**: a small JSON file with
- the SHA-256 of each tracked file:
  - the tree's `.env` and `/etc/tet/healthcheck.env`, with every secret **value** removed first
    (keys whose names contain KEY, SECRET, TOKEN, PASS, MNEMONIC, WORDS, PRIVATE, WEBHOOK, URL, SEED,
    SALT or AUTH);
  - the compose files, the health check and log seal units and scripts;
  - `sshd_config`, root's `authorized_keys` and the firewall rules;
- the node container's image ID and the SHA-256 of the `TET-Core` binary inside it;
- the SHA-256 of the node's log bytes written since the previous seal. A gzip copy of those exact
  bytes is kept for 7 days in `/var/lib/tet-logseal/log/`, so anyone with access can re-check it;
- the SHA-256 of the previous seal, so the seals form one chain.

About once an hour, the newest seal is **stamped** on TET. The seed's own seal wallet sends a
file-fee transaction whose `file_id` is the first 16 bytes of the seal's SHA-256, the same rule
as a `.sig.json` stamp. A stamp anchors that seal and, through the chain, every seal before it.
Each stamp costs 0.001 TET (practice unit, can't be exchanged for money). Each seal wallet was
funded once by the welcome airdrop.

**A config change that wasn't accepted is an alert.** It's reported to the seed's healthchecks.io
check as a failure, naming what changed (never the content), so it reaches Discord, and it's
reported again every 10 minutes until it's accepted.

## What it proves, and what it doesn't

- **Proves:** a stamped seal, and every seal before it in the chain, hasn't been changed since its
  stamp's block; and roughly when a tracked file or the binary changed.
- **Doesn't prove:**
  - that nothing happened between two seals, or before the first one;
  - that an attack was stopped;
  - anything about a secret's value (only that the key is there);
  - anything about files it doesn't track.

  Someone with root on the seed can stop the timer. The seals then stop, and their absence is
  visible, but it isn't an alert yet.
- **Never recorded:** secret values, log text and file contents. Only hashes leave the host, in
  the seals and in the stamps.

## Operating it

| | |
|---|---|
| After every deploy | `set -a; . /etc/tet-logseal/logseal.env; set +a; /opt/tet-logseal/tet-logseal accept` |
| Check the chain, the log copies and the stamps | `… tet-logseal verify` |
| The newest seal and pending changes | `… tet-logseal status` |
| Logs | `journalctl -u tet-logseal.service` |
| Stop it | `systemctl disable --now tet-logseal.timer` |
| Install on a seed | copy `deploy/logseal/` to the host, then `bash install.sh <label>` |

Install creates the seal wallet's 12 words in a container with no network, writes them to
`/etc/tet-logseal/seal.mnemonic` (root, 0600), and never prints them. It never overwrites an
existing wallet.

**Checking a stamp yourself:**
1. Take a seal file and compute its SHA-256.
2. Its first 32 hex digits, formatted as a UUID, are the `file_id`.
3. Look up the stamp's transaction (`GET /explorer/tx/<hash>`, the hash is in `stamps.jsonl`). It's
   a `file_fee` with that `file_id`, in a canonical block.

## Later

- **An alert when seals stop** (a separate healthchecks.io check per seed).
- **A small tool for anyone's own servers** (FUTURE_IDEAS: "log seal").
- **Seal more logs** (the SSH log) once there's a plan for keeping their copies.
