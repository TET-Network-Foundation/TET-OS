# The "Try TET" demo node

A third public host, separate from the seeds, that serves the `/try` page and is the one place
TET's REST API faces the internet. It is a **follower** (`TET_AUTO_MINE=0`): it produces no blocks
and holds no validator key.

**Nothing is shared with the seeds:** no libp2p key, no producer key, no `.env`, no
healthchecks.io check. It dials them like any follower.

## Topology

```
internet ──443──> Caddy (TLS, Let's Encrypt) ──> ui:3000 (Next.js: /try and the other pages)
                                                    └─ /tet-node-api/* ──> tet-core:5010 (public mode)
host-only:  127.0.0.1:5010 ──> tet-core   (the health probe)
```

- **tet-core runs with `TET_PUBLIC_API=1`.** It is published only on `127.0.0.1`. The only route in
  from outside is Caddy → UI → the UI's server-side proxy.
- **Ports open to the internet:** 443 (and 80, for the ACME challenge and redirect), 8002 (P2P,
  like any node) and SSH. Nothing else.

## Public mode (`tet-core/src/rest/public_api.rs`)

### Allow-list
`PUBLIC_ALLOWLIST` holds exactly the routes the try page needs:
- status, chain binding, ledger state, balance;
- Tmail send, inbox, keys, read receipt, and anonymous register/root/leaves/receipt;
- Files upload, inbox, fetch, delete.

**Everything else is a 404 from the gate**, which runs before any handler, rate limiter or CORS
layer. That includes mining, `/execute`, logs, admin, founder, the server-side mnemonic generator,
the faucet/airdrop routes, metrics, `/files/fee` (the sponsor replaces it, below) and the
wallet-keyed `/tmail/anon/path/*`.

### Path matching
Path matching is strict: a `:param` matches exactly one non-empty segment without `%`. Trailing
slashes, double slashes and extra segments never match.

### Per-client rate limits
These are token buckets, separate for reads and writes:

| Class | Default | Env |
|---|---|---|
| Reads (GET) | 10/s, burst 40 | `TET_PUBLIC_READ_PER_SEC`, `TET_PUBLIC_READ_BURST` |
| Writes (POST/PUT/DELETE) | 20/min, burst 10 | `TET_PUBLIC_WRITE_PER_MIN`, `TET_PUBLIC_WRITE_BURST` |
| Tracked clients | 50,000; idle clients are dropped first, then new clients share one overflow bucket | `TET_PUBLIC_MAX_CLIENTS` |

An over-limit request gets `429` with `Retry-After: 5`.

### Client identity
The client is the **TCP peer**, except when the peer is a configured trusted proxy
(`TET_PUBLIC_TRUSTED_PROXIES`, addresses or CIDRs). Then the client is the **right-most**
`X-Forwarded-For` entry.

- **On the demo node** the trusted proxies are the compose network, a pinned subnet holding Caddy
  and the UI container. Caddy 2.5+ (with no `trusted_proxies`) replaces whatever the client sent, so
  the header is believed only from a hop that set it.
- **A request that reaches tet-core any other way** is keyed by its own address and can't invent new
  ones.
- **IPv6 clients are keyed by their `/64`.** One subscriber usually holds a whole `/64`; per-address
  keys would give them about 2⁶⁴ buckets.
- **The host probe** (`127.0.0.1`) is its own client.

Both rules come from the commit security review of #36.

### Guards
Each has its negative control recorded in the commit:

| Guard | Proves |
|---|---|
| `public_mode_refuses_every_route_off_the_allowlist` | every route defined in `routes.rs` (parsed, so a route added later is covered automatically), named dangerous routes, and near-miss spellings are refused |
| `public_mode_lets_every_allowlisted_route_through` | the allow-list doesn't lock the page out |
| `public_mode_rate_limit_fires_per_client` | the limit fires for one client, a second client is unaffected, a forged prefix doesn't help, and writes are tighter |
| `public_mode_is_off_by_default` | the seeds are unchanged |
| `public_mode_ignores_forwarded_for_from_an_untrusted_peer` | a direct peer rotating `X-Forwarded-For` is still one client |
| `public_mode_limits_ipv6_per_slash_64` | rotating addresses inside one `/64` is still one client |

## File fees: sponsored, capped, never a faucet (part 3; designed here)

A visitor's disposable wallet has 0 TET. The file is delivered either way; the fee is settled
after delivery. The demo node pays it from a **sponsor wallet**:

- **The sponsor wallet** is demo-only. Its mnemonic is in `/etc/tet-demo/sponsor.mnemonic` (mode
  600). It is never in `.env`, the repository, or the seeds. The founder funds it with a fixed
  budget by an ordinary transfer, for example 50 TET (50,000 fees of 1,000 µTET).
- **The only thing it signs** is `TxV1::FileFee`, with `from_wallet = sponsor`, for a `file_id` that
  **this node stored** (`/files/upload` came through it) and that hasn't been paid yet. The sponsor
  code has no transfer path, so it cannot become a faucet. `FileFee` already allows a payer
  different from the file's sender, so **nothing changes in consensus**.
- **Route:** `POST /demo/files/sponsor-fee {file_id}`, signed by the file's sender (proving it's
  their file). It's on the allow-list only when the sponsor is configured.

**Caps.** Each one, when hit, is a **refusal, not a queue**:

| Cap | Default | Refusal reason |
|---|---|---|
| Per client IP per UTC day | 5 files | `daily_cap_ip` |
| Per sender wallet per UTC day | 5 files | `daily_cap_wallet` |
| All visitors per UTC day | 500 files | `daily_cap_global` |
| Sponsor balance floor | stop below 10 TET | `sponsor_low` |
| Not uploaded here, already paid, or unknown | — | `not_sponsorable` |

- The counters live in a node-local sled tree keyed by **(UTC day, salted hash of the IP)**. The
  salt rotates daily, so the node never stores visitors' IP addresses.
- The refusal is `429` (`402` for `sponsor_low`) with `{reason}`.
- The page says: *"Your file was delivered. Its fee wasn't sponsored (`<reason>`); that doesn't
  affect the file."* It never retries automatically.
- `sponsor_low` alerts the operator: a healthchecks.io `/fail` with the balance.

## What the page must say (honest limits)

- **Everything is testnet.** The demo node sees your IP address and request timing, and it is
  run by one operator. Nothing here is audited.
- The disposable wallet lives in this tab. Download its words or lose it.
- See each panel's own limits in the "Try TET" design (anonymity set, Kyber round 3, best-effort
  burn, sponsored fees).

## Parts

| Part | Contents |
|---|---|
| 0a | public mode in tet-core (this document, guards) |
| 0b | the demo node deploy: compose with Caddy, provisioning that shares nothing with the seeds, its own healthchecks.io check |
| 0c | the `/try` page shell and the disposable wallet |
| 1–5 | board, Tmail, Files (with the sponsor), verify, AI asks a human |
