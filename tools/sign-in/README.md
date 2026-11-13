# Sign in with TET: a local-only prototype

**Status: prototype. The design has not been reviewed. Not for real logins.** It runs on
`127.0.0.1` only, keeps its state in memory, and is bound to an example chain id no node runs. The
design it is a small piece of is `docs/plans/SIGN_IN_WITH_TET.md` (branch `plan-sign-in-with-tet`,
design only, for review).

## What it does

1. A tiny server issues a challenge:
   `{"v":1,"kind":"tet_signin_challenge_v1","domain":"example.test","nonce":"<32 random bytes, hex>","expires_seq":N}`
2. The client signs the challenge's exact bytes with `tet-cli agent sign`, payload type
   `application/vnd.tet.signin-challenge+json`, and posts the envelope back.
3. The server checks the envelope with `tet-cli agent verify` (both halves, Ed25519 and ML-DSA-44),
   then, in this order: the payload type; that the payload is a canonical challenge; that its
   domain is the server's own; that the nonce was issued here; that the challenge is byte for byte
   the one issued; that the nonce has not been used; that it has not expired. Then it marks the
   nonce used and answers with the signer's key id.

No new cryptography: every signature and every signature check is `tet-cli agent sign` / `verify`.

`expires_seq` counts challenges, not time. The server's seq goes up by one for every challenge it
issues, and a challenge is good while seq <= its `expires_seq` (8 more challenges by default).

```sh
cargo build -p tet-cli --release            # or set TET_CLI=path/to/tet-cli
python3 tools/sign-in/signin.py serve --domain example.test --port 8765
TET_MNEMONIC='…12 words…' python3 tools/sign-in/signin.py login --server http://127.0.0.1:8765
python3 tools/sign-in/test_signin.py        # the guard, also run in CI
```

## Tests (`test_signin.py`, real tet-cli, over HTTP)

| case | expected |
|---|---|
| a signed answer to an open challenge | accepted, as the client's key |
| the same signed answer posted again | refused: `nonce: already used` |
| our challenge with its domain rewritten to `evil.test`, validly signed | refused: `domain:` |
| a challenge from an `evil.test` server, signed and relayed here | refused: `domain:` |
| answered after the challenge expired | refused: `expired:` |
| control: the replay against a server with the used-nonce check off | **accepted** |

Every answer is validly signed by the client's own key, so the signature check passes and the
check each case is named for is the one reached. Each refusal asserts its own reason.

The replay is refused only by the used-nonce check: the challenge is ours, exact and still open
(asserted at the replay). The control test keeps that true: with the check off, the same replay is
accepted, so nothing else is standing in for it.

The domain check is not the only thing between a wrong-domain answer and acceptance: with it
removed, the two domain cases are still refused, by "not the one issued for this nonce" and "nonce:
not issued here". The tests pin the domain reason, so they fail when the domain check goes, but the
refusal itself would not.

## What it shows

In the everyday words the `/signin` page uses: a "question" is the server's challenge, "the site" is
the server's domain, and "a key" is the signer's key id. The page shows these lines word for word,
and `tet-network/ui/scripts/signin_demo_guard.mjs` compares them.

- **This key answered this site's question**, once, before it expired.

## What it does not show

- **Who holds the key.** Anyone with the 12 words can answer. The site learns a key, not a person.
- That you meant to sign in to this site: the prototype signs any question it is given. The full
  design would check where the question came from and show the site's name first; neither is built.
- Anything after a restart: the server keeps its questions in memory only.

## Not in the prototype (from the design)

Per-site keys (the prototype signs with the key it is given), a dedicated `tet signin v1` signing
domain (it uses the agent envelope with its own payload type), origins with scheme and port (it uses
a bare domain), challenges tied to a browser session, the anonymous membership mode, and the
request cooldown. Each needs review, and some need new signing code, which this prototype does not add.
