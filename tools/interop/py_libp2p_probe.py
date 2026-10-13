#!/usr/bin/env python3
"""py-libp2p <-> tet-core interop probe (gossipsub, block plane).

Starts a py-libp2p node, dials one tet-core node, subscribes to TET's gossipsub topics and reports,
layer by layer, what worked: TCP, Noise, the stream muxer, identify, the gossipsub stream, topic
subscriptions, and whether TET's messages (blocks every few seconds) arrive and parse.

It only listens: it never publishes. Run it against a local node, not a public seed.

    python tools/interop/py_libp2p_probe.py \
        --peer /ip4/127.0.0.1/tcp/16011/p2p/<tet-core peer id> --seconds 60

Options: --key ed25519|rsa (tet-core accepts Ed25519 identities only; rsa shows the handshake
refusal), --muxer yamux|mplex (tet-core speaks yamux only), --json (one JSON summary line at the end).

Tested with py-libp2p 0.8.0 on Python 3.13 against tet-core (rust-libp2p 0.57, gossipsub 0.50).
See docs/LIBP2P_CONFIG.md for the tet-core side.
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import time

import multiaddr
import trio

from libp2p import new_host
from libp2p.peer.peerinfo import info_from_p2p_addr
from libp2p.pubsub.gossipsub import (
    PROTOCOL_ID,
    PROTOCOL_ID_V11,
    PROTOCOL_ID_V12,
    PROTOCOL_ID_V13,
    GossipSub,
)
from libp2p.pubsub.pubsub import Pubsub
from libp2p.tools.anyio_service import background_trio_service

# tet-core block plane (tet-core/src/p2p.rs, files/mod.rs). Messages are JSON, serde's default
# externally tagged enum: {"BlockMined": {...}}, {"TxBroadcast": {...}}, {"TmailGossip": {...}}, ...
TOPICS = ["/tet/v1/blocks", "/tet/v1/txs", "/tet/v1/tmail", "/tet/v1/files/announce"]


def make_key(kind: str):
    if kind == "rsa":
        from libp2p.crypto.rsa import create_new_key_pair
    else:
        from libp2p.crypto.ed25519 import create_new_key_pair
    return create_new_key_pair()


def muxer_opt(kind: str):
    if kind == "mplex":
        from libp2p.stream_muxer.mplex.mplex import MPLEX_PROTOCOL_ID, Mplex

        return {MPLEX_PROTOCOL_ID: Mplex}
    from libp2p.stream_muxer.yamux.yamux import PROTOCOL_ID as YAMUX_ID, Yamux

    return {YAMUX_ID: Yamux}


def _walk(exc: BaseException, depth: int = 0, seen: set | None = None) -> list[str]:
    """Every exception inside `exc`: causes, contexts and grouped errors (py-libp2p wraps dial
    failures in SwarmDialAllFailedError / MultiError, so the useful one is several levels down)."""
    seen = seen if seen is not None else set()
    if exc is None or id(exc) in seen or depth > 12:
        return []
    seen.add(id(exc))
    out = [f"{type(exc).__name__}: {str(exc)[:160]}"]
    for inner in list(getattr(exc, "exceptions", []) or []) + list(getattr(exc, "errors", []) or []):
        if isinstance(inner, BaseException):
            out += _walk(inner, depth + 1, seen)
    for nxt in (exc.__cause__, exc.__context__):
        if nxt is not None:
            out += _walk(nxt, depth + 1, seen)
    return out


def classify(exc: BaseException) -> str:
    """Name the layer a dial failed at, from the innermost errors py-libp2p reports."""
    parts = _walk(exc)
    chain = " <- ".join(parts)
    text = chain.lower()
    if "security" in text or "noise" in text or "handshake" in text:
        return f"security handshake (Noise): {chain}"
    if "muxer" in text or "yamux" in text or "mplex" in text:
        return f"stream muxer: {chain}"
    if "multiselect" in text or "protocol" in text:
        return f"protocol negotiation (multistream-select): {chain}"
    if "connect" in text or "refused" in text or "openconnection" in text:
        return f"TCP dial: {chain}"
    return f"unclassified: {chain}"


async def run(args) -> dict:
    out: dict = {
        "py_libp2p": __import__("importlib.metadata").metadata.version("libp2p"),
        "python": sys.version.split()[0],
        "key": args.key,
        "muxer": args.muxer,
        "peer": args.peer,
        "stages": {},
        "messages": {t: 0 for t in TOPICS},
        "blocks": [],
        "parse_errors": 0,
    }
    st = out["stages"]
    key_pair = make_key(args.key)
    host = new_host(key_pair=key_pair, muxer_opt=muxer_opt(args.muxer))
    gossipsub = GossipSub(
        protocols=[PROTOCOL_ID_V13, PROTOCOL_ID_V12, PROTOCOL_ID_V11, PROTOCOL_ID],
        degree=6,
        degree_low=4,
        degree_high=12,
        heartbeat_initial_delay=0.5,
        heartbeat_interval=1,
    )
    pubsub = Pubsub(host, gossipsub)
    info = info_from_p2p_addr(multiaddr.Multiaddr(args.peer))
    listen = [multiaddr.Multiaddr("/ip4/127.0.0.1/tcp/0")]

    async with host.run(listen_addrs=listen):
        async with background_trio_service(pubsub), background_trio_service(gossipsub):
            await pubsub.wait_until_ready()
            subs = {t: await pubsub.subscribe(t) for t in TOPICS}
            st["local_peer_id"] = str(host.get_id())

            # 1. TCP + multistream-select + Noise + muxer (py-libp2p's upgrader does all four).
            t0 = time.monotonic()
            try:
                with trio.fail_after(20):
                    await host.connect(info)
                st["connect"] = {"ok": True, "ms": round((time.monotonic() - t0) * 1000)}
            except BaseException as e:  # noqa: BLE001 - report every failure, that's the point
                st["connect"] = {"ok": False, "where": classify(e), "error": str(e)[:300]}
                return out
            conns = host.get_network().get_connections(info.peer_id)
            if conns:
                c = conns[0]
                muxed = getattr(c, "muxed_conn", None)
                secured = getattr(muxed, "secured_conn", None)
                st["connection"] = {
                    "muxer": type(muxed).__name__ if muxed else None,
                    "security": type(secured).__name__ if secured else None,
                }

            # 2. identify: what the remote says it speaks (py-libp2p runs identify on connect).
            await trio.sleep(2)
            try:
                protos = host.get_peerstore().get_protocols(info.peer_id)
            except Exception as e:  # noqa: BLE001
                protos = [f"(not available: {type(e).__name__})"]
            st["identify_remote_protocols"] = sorted(str(p) for p in protos)

            # 3. gossipsub stream: which /meshsub version was negotiated.
            with trio.move_on_after(15):
                while info.peer_id not in pubsub.peers:
                    await trio.sleep(0.2)
            stream = pubsub.peers.get(info.peer_id)
            if stream is None:
                st["gossipsub_stream"] = {"ok": False, "where": "no pubsub stream within 15 s (meshsub negotiation)"}
            else:
                proto = None
                for attr in ("get_protocol",):
                    f = getattr(stream, attr, None)
                    if f:
                        try:
                            proto = str(f())
                        except Exception:  # noqa: BLE001
                            pass
                st["gossipsub_stream"] = {"ok": True, "protocol": proto}

            # 4. topic subscriptions seen from the remote.
            await trio.sleep(3)
            st["remote_subscribed_topics"] = sorted(
                t for t, peers in pubsub.peer_topics.items() if info.peer_id in peers
            )
            mesh = getattr(gossipsub, "mesh", {}) or {}
            st["in_mesh_topics"] = sorted(t for t, peers in mesh.items() if info.peer_id in peers)

            # 5. messages for --seconds.
            async def read(topic: str) -> None:
                sub = subs[topic]
                while True:
                    msg = await sub.get()
                    out["messages"][topic] += 1
                    try:
                        ev = json.loads(msg.data.decode("utf-8"))
                    except Exception:  # noqa: BLE001
                        out["parse_errors"] += 1
                        continue
                    if topic == "/tet/v1/blocks" and isinstance(ev, dict) and "BlockMined" in ev:
                        b = ev["BlockMined"]
                        out["blocks"].append(
                            {
                                "height": b.get("block_height"),
                                "block_id": str(b.get("block_id", ""))[:18],
                                "txs": len(b.get("txs") or []),
                                "from": msg.from_id.hex()[:16] if msg.from_id else None,
                                "signed": bool(msg.signature),
                            }
                        )
                        if args.verbose:
                            print(f"block {b.get('block_height')} {str(b.get('block_id', ''))[:18]}", flush=True)

            with trio.move_on_after(args.seconds):
                async with trio.open_nursery() as n:
                    for t in TOPICS:
                        n.start_soon(read, t)
            st["still_connected"] = bool(host.get_network().get_connections(info.peer_id))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--peer", required=True, help="tet-core multiaddr ending in /p2p/<peer id>")
    ap.add_argument("--seconds", type=int, default=60)
    ap.add_argument("--key", choices=["ed25519", "rsa"], default="ed25519")
    ap.add_argument("--muxer", choices=["yamux", "mplex"], default="yamux")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--verbose", action="store_true")
    ap.add_argument("--debug", action="store_true", help="py-libp2p debug logs on stderr")
    args = ap.parse_args()
    logging.basicConfig(level=logging.DEBUG if args.debug else logging.WARNING, stream=sys.stderr)
    out = trio.run(run, args)
    if args.json:
        print(json.dumps(out))
        return
    for k, v in out["stages"].items():
        print(f"{k}: {v}")
    print(f"messages per topic: {out['messages']}")
    hs = [b["height"] for b in out["blocks"]]
    print(f"blocks received: {len(hs)}" + (f" (heights {hs[0]}..{hs[-1]})" if hs else ""))
    print(f"parse errors: {out['parse_errors']}")


if __name__ == "__main__":
    main()
