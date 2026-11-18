"""Local rehearsal of the testnet-2 rebuild (docs/ops/TESTNET2_REHEARSAL.md).

    python3 -I tools/testnet2-rehearsal/rehearse.py   (TET_CORE_BIN=path/to/TET-Core, else target/release/TET-Core)

What it does, all on this machine:
1. Refusals: with TET_ENV=testnet, the node is started once per missing or wrong setting and must
   exit 2 with the one [FATAL] message that setting is named for, before it creates its database.
   A node that is still running after the timeout booted when it should not have: that case fails.
   Every node this script starts has P2P off (TET_ENABLE_P2P=0), so the P2P sync-trust refusals
   are not run here; the unit test a_public_node_never_trusts_every_peer_for_sync covers them.
2. Boot: with every setting right, a producer starts, mines, and every socket it has is bound to
   127.0.0.1 (checked with lsof).
3. Backup and restore: scripts/backup-node-data.sh copies the running node's data; the tarball is
   copied to a second directory (the stand-in for "off the host"), its SHA-256 is checked there,
   and a new node with the same testnet settings, NOT mining, starts from it and serves the
   backed-up height and block. It does not mine, so it can only get there from the backup (empty
   blocks of one genesis are identical, so a mining node would rebuild them). Control: the same
   restore, also not mining, with the database removed, must come up below that height.

Every key-shaped value is a throwaway made from os.urandom on each run and printed as a field name
and a length only. Nothing leaves the machine. Exit 0 only if every check passed.
"""

import json
import os
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BIN = os.environ.get("TET_CORE_BIN") or os.path.join(ROOT, "target", "release", "TET-Core")
BACKUP = os.path.join(ROOT, "scripts", "backup-node-data.sh")

CHAIN = "tet-testnet-2-rehearsal"
DEV_FOUNDER = "57e0b29d"  # prefix only, checked against the source below
DEV_TREASURY = "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321"

results = []


class Fail(Exception):
    pass


def need(cond, msg):
    """Like assert, but not removed by python -O."""
    if not cond:
        raise Fail(msg)


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"{'ok  ' if ok else 'FAIL'} {name}{(': ' + detail) if detail else ''}", flush=True)
    return ok


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return json.load(r)


def height(port):
    return int(get(port, "/status/live").get("height") or 0)


def dev_founder_full():
    src = open(os.path.join(ROOT, "tet-core", "src", "genesis.rs")).read()
    i = src.index("GENESIS_FOUNDER_DEV_PUBLIC_HEX")
    q = src.index('"', i)
    v = src[q + 1 : src.index('"', q + 1)]
    need(v.startswith(DEV_FOUNDER) and len(v) == 64, "dev founder constant moved")
    return v


def base_env(data_dir, port):
    """Loopback only, P2P off, no inherited TET_* settings."""
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "HOME": data_dir,
        "TET_DB_DIR": os.path.join(data_dir, "tet.db"),
        "TET_REST_BIND": f"127.0.0.1:{port}",
        "TET_PORT": str(port),
        "TET_ENABLE_P2P": "0",  # never on: see the docstring
        "TET_P2P_LISTEN": "/ip4/127.0.0.1/tcp/0",
        "TET_NEXUS_P2P_LISTEN": "/ip4/127.0.0.1/tcp/0",
        "TET_LEDGER_P2P_LISTEN": "/ip4/127.0.0.1/tcp/0",
        "TET_DB_ENCRYPT": "off",
        "TET_BLOCK_TIME_SEC": "1",
        "RISC0_SKIP_BUILD": "1",
        "RUST_LOG": "warn",
    }


def run_once(env, cwd, timeout=20):
    """Start the node; return (exit code or None if it was still running, output)."""
    p = subprocess.Popen([BIN], cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        out, _ = p.communicate(timeout=timeout)
        return p.returncode, out.decode(errors="replace")
    except subprocess.TimeoutExpired:
        p.kill()
        out, _ = p.communicate()
        return None, out.decode(errors="replace")


class Node:
    def __init__(self, env, cwd, log):
        self.port = int(env["TET_PORT"])
        self.log = open(log, "wb")
        self.p = subprocess.Popen([BIN], cwd=cwd, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.time() + 90
        while time.time() < deadline:
            if self.p.poll() is not None:
                raise RuntimeError(f"node exited {self.p.returncode}; see {log}")
            try:
                height(self.port)
                return
            except OSError:
                time.sleep(0.5)
        raise RuntimeError(f"node did not answer on {self.port}; see {log}")

    def wait_height(self, h, secs=60):
        deadline = time.time() + secs
        while time.time() < deadline:
            if height(self.port) >= h:
                return True
            time.sleep(0.5)
        return False

    def local_addrs(self):
        """The local address of every internet socket of the node process (lsof -F n)."""
        r = subprocess.run(["lsof", "-nP", "-a", "-p", str(self.p.pid), "-i", "-F", "n"], capture_output=True, text=True)
        return [l[1:].split("->")[0] for l in r.stdout.splitlines() if l.startswith("n")]

    def stop(self):
        self.p.terminate()
        try:
            self.p.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait()
        self.log.close()


def main():
    if not os.access(BIN, os.X_OK):
        print(f"FAIL no node binary at {BIN} (set TET_CORE_BIN)")
        return 1
    work = tempfile.mkdtemp(prefix="tn2-rehearsal-")
    print(f"work dir {work}")
    founder = os.urandom(32).hex()
    treasury = os.urandom(32).hex()
    print(f"throwaway TET_GENESIS_FOUNDER_WALLET_ID: {len(founder)} hex chars")
    print(f"throwaway TET_TREASURY_ADDRESS: {len(treasury)} hex chars")
    dev_founder = dev_founder_full()

    def genesis(path, chain=CHAIN, f=founder, t=treasury, h="0x" + "0" * 64):
        with open(path, "w") as fh:
            json.dump({"chain_id": chain, "founder_wallet_id": f, "treasury_address": t, "genesis_hash": h}, fh)
        return path

    def recomputed_hash(chain, f, t):
        """The node prints the right hash when the file's is wrong; take it from there."""
        d = tempfile.mkdtemp(dir=work)
        env = base_env(d, free_port()) | {
            "TET_ENV": "testnet", "TET_CHAIN_ID": chain, "TET_TREASURY_ADDRESS": t,
            "TET_GENESIS_FILE": genesis(os.path.join(d, "g.json"), chain, f, t),
        }
        code, out = run_once(env, d)
        i = out.find("(recomputed 0x")
        need(code == 2 and i >= 0, "no recomputed hash: " + out[-300:])
        return out[i + len("(recomputed ") : i + len("(recomputed ") + 66]

    good_hash = recomputed_hash(CHAIN, founder, treasury)
    need(len(good_hash) == 66 and good_hash.startswith("0x"), "bad recomputed hash")

    def good_env(d, port):
        return base_env(d, port) | {
            "TET_ENV": "testnet",
            "TET_CHAIN_ID": CHAIN,
            "TET_GENESIS_FILE": genesis(os.path.join(d, "genesis.json"), h=good_hash),
            "TET_GENESIS_FOUNDER_WALLET_ID": founder,
            "TET_TREASURY_ADDRESS": treasury,
            "TET_AUTO_MINE": "1",
            "TET_VALIDATOR_IDS": "local-wallet",
        }

    # ---- 1. refusals: one wrong thing per case, everything else right ----
    def other_hash():
        return recomputed_hash(CHAIN, founder, os.urandom(32).hex())

    cases = [
        ("no TET_CHAIN_ID", lambda e, d: e.pop("TET_CHAIN_ID"), "requires an explicit TET_CHAIN_ID"),
        ("dev chain id tet-dev-local", lambda e, d: e.update(TET_CHAIN_ID="tet-dev-local"), 'refuses the dev chain id "tet-dev-local"'),
        ("legacy dev chain id tet-local-dev", lambda e, d: e.update(TET_CHAIN_ID="tet-local-dev"), 'refuses the dev chain id "tet-local-dev"'),
        ("no TET_GENESIS_FILE", lambda e, d: e.pop("TET_GENESIS_FILE"), "requires TET_GENESIS_FILE"),
        ("genesis file for another chain", lambda e, d: genesis(e["TET_GENESIS_FILE"], chain="tet-testnet-x", h=good_hash), "TET_GENESIS_FILE is for chain"),
        ("genesis file with an unknown field", lambda e, d: open(e["TET_GENESIS_FILE"], "w").write(json.dumps({"chain_id": CHAIN, "founder_wallet_id": founder, "treasury_address": treasury, "genesis_hash": good_hash, "extra": 1})), "unknown field"),
        ("dev founder in the genesis file", lambda e, d: (genesis(e["TET_GENESIS_FILE"], f=dev_founder, h=good_hash), e.update(TET_GENESIS_FOUNDER_WALLET_ID=dev_founder)), "refuses the dev founder wallet"),
        ("dev treasury in the genesis file", lambda e, d: (genesis(e["TET_GENESIS_FILE"], t=DEV_TREASURY, h=good_hash), e.update(TET_TREASURY_ADDRESS=DEV_TREASURY)), "refuses the dev treasury"),
        ("wrong genesis hash", lambda e, d: genesis(e["TET_GENESIS_FILE"], h=other_hash()), "genesis_hash does not match"),
        ("no TET_GENESIS_FOUNDER_WALLET_ID", lambda e, d: e.pop("TET_GENESIS_FOUNDER_WALLET_ID"), "requires TET_GENESIS_FOUNDER_WALLET_ID"),
        ("founder in env differs from the file", lambda e, d: e.update(TET_GENESIS_FOUNDER_WALLET_ID=os.urandom(32).hex()), "founder wallet in the environment differs"),
        ("TET_FOUNDER_WALLET differs from the file", lambda e, d: e.update(TET_FOUNDER_WALLET=os.urandom(32).hex()), "founder wallet in the environment differs"),
        ("treasury in env differs from the file", lambda e, d: e.update(TET_TREASURY_ADDRESS=os.urandom(32).hex()), "TET_TREASURY_ADDRESS is unset or differs"),
        ("TET_GENESIS_HASH differs from the file", lambda e, d: e.update(TET_GENESIS_HASH=other_hash()), "TET_GENESIS_HASH differs"),
        ("TET_ENV=TESTNET in capitals is still testnet", lambda e, d: (e.update(TET_ENV="TESTNET"), e.pop("TET_CHAIN_ID")), "requires an explicit TET_CHAIN_ID"),
    ]
    for name, mutate, want in cases:
        d = tempfile.mkdtemp(dir=work)
        env = good_env(d, free_port())
        mutate(env, d)
        need(env["TET_ENABLE_P2P"] == "0", f"case {name} turned P2P on")
        code, out = run_once(env, d)
        fatal = [l for l in out.splitlines() if l.startswith("[FATAL]")]
        ok = code == 2 and len(fatal) == 1 and want in fatal[0] and not os.path.exists(env.get("TET_DB_DIR", "/nonexistent"))
        check(f"refused: {name}", ok, "" if ok else f"exit={code} fatal={fatal[:1]} db_created={os.path.exists(env.get('TET_DB_DIR',''))}")

    # ---- 2. boot with everything right; loopback only ----
    data1 = os.path.join(work, "host-data")
    os.makedirs(data1)
    port1 = free_port()
    env1 = good_env(data1, port1)
    n1 = Node(env1, data1, os.path.join(work, "node1.log"))
    try:
        check("producer mines to height 3", n1.wait_height(3))
        socks = n1.local_addrs()
        bad = [a for a in socks if not (a.startswith("127.0.0.1:") or a.startswith("[::1]:"))]
        check("every socket of the node is bound to loopback", bool(socks) and not bad, f"{len(socks)} sockets, not loopback: {bad}")

        # ---- 3. backup while it runs, copy "off the host", verify, restore ----
        host_backups = os.path.join(work, "host-backups")
        r = subprocess.run(["bash", BACKUP], env={**os.environ, "TET_DATA_DIR": data1, "TET_BACKUP_DIR": host_backups}, capture_output=True, text=True, timeout=120)
        lines = r.stdout.strip().splitlines()
        check("backup-node-data.sh: exit 0 and two lines", r.returncode == 0 and len(lines) == 2 and lines[1].startswith("sha256 "), r.stderr.strip()[:200])
        need(len(lines) == 2, "backup failed")
        tarball, digest = lines[0], lines[1].split()[1]
        # read after the backup, so this is an upper bound on what the tarball holds; the restore
        # is checked against one block less
        h_backup = height(port1)
        blk = get(port1, f"/explorer/block/{h_backup - 1}")
    finally:
        n1.stop()

    offhost = os.path.join(work, "offhost")
    os.makedirs(offhost)
    shutil.copy2(tarball, offhost)
    shutil.copy2(tarball + ".sha256", offhost)
    v = subprocess.run(["shasum", "-a", "256", "-c", os.path.basename(tarball) + ".sha256"], cwd=offhost, capture_output=True, text=True)
    check("off-host copy matches its .sha256", v.returncode == 0, v.stdout.strip())
    copied = os.path.join(offhost, os.path.basename(tarball))
    check("the printed sha256 is the off-host copy's", subprocess.run(["shasum", "-a", "256", copied], capture_output=True, text=True).stdout.split()[0] == digest)

    def restore(into, drop_db=False):
        os.makedirs(into)
        with tarfile.open(copied) as t:
            t.extractall(into, filter="data")
        if drop_db:
            shutil.rmtree(os.path.join(into, "tet.db"))
            os.makedirs(os.path.join(into, "tet.db"))
        return into

    def block_or_none(port, h):
        try:
            return get(port, f"/explorer/block/{h}")
        except Exception:
            return None

    def restored_node(name, drop_db):
        d = restore(os.path.join(work, name), drop_db=drop_db)
        n = Node(good_env(d, free_port()) | {"TET_AUTO_MINE": "0"}, d, os.path.join(work, name + ".log"))
        try:
            first = height(n.port)
            time.sleep(3)  # three block times
            return first, height(n.port), block_or_none(n.port, h_backup - 1)
        finally:
            n.stop()

    first2, h2, b2 = restored_node("restored", drop_db=False)
    check("restored node does not advance (it can only have the blocks from the backup)", h2 == first2, f"{first2} -> {h2}")
    check("restored node (not mining) is at the backed-up height", h2 >= h_backup - 1, f"backed up about {h_backup}, restored {h2}")
    check("restored node serves the backed-up block", b2 is not None and b2 == blk)

    # control: the same restore without the database must fail both checks
    first3, h3, b3 = restored_node("restored-nodb", drop_db=True)
    check("control node does not advance either", h3 == first3, f"{first3} -> {h3}")
    check("control: without the database the restore is below the backed-up height", h3 < h_backup - 1, f"restored {h3}")
    check("control: without the database the backed-up block is not served", b3 is None)

    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    if not failed:
        shutil.rmtree(work)
    return 1 if failed else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Fail as e:
        print(f"FAIL {e}")
        sys.exit(1)
