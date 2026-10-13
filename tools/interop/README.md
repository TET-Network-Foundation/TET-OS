# Interop probes

## py-libp2p ↔ tet-core (`py_libp2p_probe.py`)

A py-libp2p node dials one tet-core node, subscribes to TET's gossipsub topics, and reports each
layer: the TCP dial, Noise, the muxer, identify, the gossipsub stream, mesh membership and the
messages received. It never publishes anything.

```sh
python3.13 -m venv .venv
# macOS: fastecdsa (a py-libp2p dependency) needs GMP: brew install gmp, then
CFLAGS="-I$(brew --prefix gmp)/include" LDFLAGS="-L$(brew --prefix gmp)/lib" \
  .venv/bin/pip install "libp2p==0.8.0"
.venv/bin/python tools/interop/py_libp2p_probe.py \
  --peer /ip4/127.0.0.1/tcp/<block-plane port>/p2p/<tet-core peer id> --seconds 60
```

A local tet-core prints its peer ID at start-up (`listening on …/p2p/12D3Koo…`). Use a local node
for this, not a public seed.

**Options:**
- `--key rsa`: shows the refusal (tet-core takes Ed25519 identities only);
- `--muxer mplex`: shows the refusal (tet-core speaks Yamux only);
- `--json`: one summary line;
- `--debug`: py-libp2p's logs.

Results so far, and the tet-core side of the setup: `docs/LIBP2P_CONFIG.md`.
