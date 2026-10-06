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
- **Two independent layers enforce the allow-list:** tet-core's gate (below) and Caddy, whose
  `@tet_allowed` matcher is the same `(method, path)` set (a CI test keeps them equal).
  - Caddy also refuses the UI's own server routes (`/api/*`) and serves only `/try`, its static files
    and the allow-listed node API.
  - `provision-seed.sh` starts Caddy only after tet-core has proved public mode: `/metrics` must come
    back as the gate's own 404.
  - So an image without public mode, or a missing env var, can't open the node. (Commit security
    review of #37.)

## Public mode (`tet-core/src/rest/public_api.rs`)

### Allow-list
`PUBLIC_ALLOWLIST` holds exactly the routes the try page needs:
- status, chain binding, ledger state, balance;
- Tmail send, inbox, keys, read receipt, and anonymous register/root/leaves/receipt;
- Files upload, inbox, fetch, delete;
- the file-fee sponsor, `POST /demo/files/sponsor-fee` (below).

**Everything else is a 404 from the gate**, which runs before any handler, rate limiter or CORS
layer. That includes mining, `/execute`, logs, admin, founder, the server-side mnemonic generator,
the faucet/airdrop routes, metrics, `/files/fee` (the sponsor replaces it, below) and the
wallet-keyed `/tmail/anon/path/*`.

### Path matching
Path matching is strict: a `:param` matches exactly one non-empty segment without `%` that is not
`.` or `..`. Trailing
slashes, double slashes and extra segments never match.

### Per-client rate limits
These are token buckets, separate for reads and writes:

| Class | Default | Env |
|---|---|---|
| Reads (GET) | 10/s, burst 40 | `TET_PUBLIC_READ_PER_SEC`, `TET_PUBLIC_READ_BURST` |
| Writes (POST/PUT/DELETE) | 20/min, burst 10 (**30 on the demo node**) | `TET_PUBLIC_WRITE_PER_MIN`, `TET_PUBLIC_WRITE_BURST` |
| Tracked clients | 50,000; idle clients are dropped first, then new clients share one overflow bucket | `TET_PUBLIC_MAX_CLIENTS` |

An over-limit request gets `429` with `Retry-After: 5`.

**The demo node's write burst is 30** (`deploy/demo/docker-compose.demo.yml`). Each page action
costs a few writes: registering keys, a message, a file upload and its sponsored fee. In the local
run, a burst of 10 was used up by someone sending three files in quick succession, before any
sponsor cap applied. The refill rate is unchanged at 20 a minute, so sustained use is limited
exactly as before; only a short burst is larger.

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

## File fees: sponsored, capped, never a faucet (part 3)

A visitor's disposable wallet has 0 TET. The file is delivered either way; the fee is settled
after delivery. The demo node pays it from a **sponsor wallet** (`tet-core/src/demo_sponsor.rs`):

- **The sponsor wallet** is demo-only. Its 12 words are in `/etc/tet-demo/sponsor.mnemonic` on the
  demo host (root only), mounted read-only into tet-core as `TET_DEMO_SPONSOR_MNEMONIC_FILE`. They
  are never in `.env`, the repository, or the seeds. The operator funds it with a fixed budget by an
  ordinary transfer, for example 50 TET (50,000 fees of 1,000 µTET). Until the file exists the
  sponsor is off; a file that exists but is unusable stops the node at start.
- **The only thing it signs** is `TxV1::FileFee`, with `from_wallet` = the sponsor, for a file that
  was **uploaded through this node** (`/files/upload` recorded it), by the sender who asks, and
  that **this node has not sponsored before**. Nothing records whether someone else already paid a
  file's fee, so "not paid yet" can only mean "not sponsored here". The module has no other signing
  path, so it cannot become a faucet. `FileFee` already allows a payer other than the file's
  sender, so **nothing changes in consensus**.
- **Route:** `POST /demo/files/sponsor-fee` with a `SponsorFeeRequestV1` `{file_id,
  sender_wallet_id, requested_at_ms, hybrid_sig}`, signed by the file's sender over
  `tet demo sponsor fee v1|chain_id=…|genesis_hash=…|file_id=…|sender=…|requested_at_ms=…|mldsa_pk=…`
  (ML-DSA-44, within 5 minutes of the node's clock). It is on the public allow-list; a node
  without a sponsor answers `no_sponsor`.

**Caps.** Each one, when hit, is a **refusal, not a queue**:

| Cap | Default (`.env`) | Refusal reason |
|---|---|---|
| Per client per UTC day | 5 files (`TET_DEMO_SPONSOR_PER_IP`) | `daily_cap_ip` (429) |
| Per sender wallet per UTC day | 5 files (`TET_DEMO_SPONSOR_PER_WALLET`) | `daily_cap_wallet` (429) |
| All visitors per UTC day | 500 files (`TET_DEMO_SPONSOR_GLOBAL`) | `daily_cap_global` (429) |
| Sponsor balance floor | stop below 10 TET (`TET_DEMO_SPONSOR_FLOOR_TET`) | `sponsor_low` (402) |
| Not uploaded here, not the sender's, or already sponsored | — | `not_sponsorable` (404) |
| No sponsor on this node | — | `no_sponsor` (404) |

- **The client** is the one public mode rate-limits (the TCP peer, or the right-most
  `X-Forwarded-For` from a trusted proxy; IPv6 by /64).
- **No IP address is stored.** The per-client counter is keyed by `SHA-256(daily salt ‖ client)`.
  The salt is random, held in memory only, and replaced each UTC day. A restart forgets it and
  resets that day's per-client counts; the wallet and global counts are durable.
- **What the page says:** *"Your file was delivered. Its fee wasn't sponsored (`<reason in
  words>`); that doesn't affect the file."* It never retries. A 429 from public mode's own rate
  limit (not a sponsor cap) is named as such.
- **Not built yet:** an alert when the sponsor runs low. Today `sponsor_low` is a refusal and a
  warning in tet-core's log; wiring it to the healthchecks.io check is a follow-up.

## The anonymous board (part 1)

- **A board is a Tmail wallet whose messaging keys are random.** They come from a 32-byte board
  seed, and the seed is the invite: `/try#board=tetboard1.<board wallet id>.<seed>.<name>`.
  Whoever has the invite can decrypt the board's inbox, so can read every post. Anyone can post,
  because posting needs only the public keys the node serves.
- **The invite is in the URL fragment,** which browsers never send to a server. No request the
  page makes carries the seed or a secret key (`scripts/try_board_guard.mjs`).
- **The board wallet's own 12 words register its keys,** and are not in the invite. An invite
  holder can read the board but cannot replace its keys. Opening an invite checks that the keys
  it derives equal the board's registered keys.
- **Posts are labelled by the envelope and the node:** *named, not anonymous* with the sender's
  wallet id, or anonymous with the node's verdict (verified, pending or failed; no verdict is
  pending).
- **Anonymous never falls back to named.** Without the native prover, an anonymous post is refused
  and nothing is sent. Posting named is a separate, labelled choice.
- **Allowance:** one anonymous post per member per board per UTC day (the node accepts the day
  either side of its own, so up to 3 around midnight UTC). The board keeps each named sender's
  newest 5 posts and 100 anonymous posts.

## Verify anything (part 4)

A file or text, its `.sig.json` (the agent payload envelope), and optionally an owner's manifest
and a pinned key give a **graded verdict**. Each step says only what it proves:

1. **The bytes match and both signatures are valid, by key X.** The content must be byte-identical
   to the signed payload, and both signatures (Ed25519 and ML-DSA-44, size-pinned) must verify on
   the chain binding. The binding is the node's `/chain`, or one the user types, and is never read
   from the sidecar.
2. **Key X belongs to agent A, owned by wallet W,** only with an `AgentManifestV1` that verifies as
   tet-core's `verify_agent_manifest_v1` does, and that names the same two keys.
3. **This is the key you pinned,** only with a pin.

Everything runs in the tab; nothing is uploaded. The UI's manifest code and tet-core agree byte for
byte (`ui_signed_agent_manifest_is_byte_identical_in_rust`, on
`tet-core/src/testdata/agent_manifest_v1.json`).

## AI asks a human (part 5)

- **A questions board** is a board (part 1) whose invite is **public** (`TET_QUESTIONS_INVITE`, see
  `deploy/demo/README.md` §8): anyone can read the questions.
- **An agent asks** with the agent SDK (`tet-agent-sdk/src/questions.ts`):
  - `registerAgentInbox` publishes the agent's messaging keys, derived from its mnemonic as every
    TET wallet's are;
  - `postQuestion` sends a named Tmail from the agent's own key to the board, with the owner's
    `AgentManifestV1` inside;
  - `markAnswered` posts a note naming the question;
  - `readAnswers` decrypts the agent's inbox.

  The SDK's encryption and envelope pre-image are ports of the UI's, checked both ways: tet-core
  verifies an SDK question and a page answer, the page reads the SDK's question, and the SDK reads
  the page's answer.
- **The window shows the owner** only when the manifest verifies (tet-core's rules) and vouches for
  **both** keys that signed the question. Otherwise it says the owner is unknown, and why.
- **"Answered"** is shown only from the key that asked.
- **An answer goes to the question's signed sender,** never to an address written in the question.
  It is anonymous with the native prover, or named and labelled so. Only the agent can read it.
- **Limits printed:**
  - no payment;
  - the prover requirement;
  - a manifest proves the owner vouched for the key, not who runs it;
  - questions are public, answers are private;
  - "answered" is the agent's word;
  - each agent's newest 5 posts are kept;
  - 7-day expiry, not on chain.

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
| 1 | the anonymous board |
| 2–3 | Tmail and Files on the page, and the file-fee sponsor |
| 4 | verify anything |
| 5 | AI asks a human |
