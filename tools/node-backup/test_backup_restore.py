#!/usr/bin/env python3
"""Guard for scripts/backup-node-data.sh: a node comes back up from the tarball it makes.

    python3 tools/node-backup/test_backup_restore.py   (TET_CORE_BIN=path/to/TET-Core, else target/release/TET-Core)

1. A local node (loopback only, no P2P, its own dev chain) mines a few blocks.
2. While it is still running, backup-node-data.sh copies its data directory: it prints the tarball's
   path and "sha256 <hex>", and that hash is the file's.
3. The node is stopped; a second node starts from the unpacked tarball, in a new directory, and
   reports at least the height and the same tip the first had at backup time.
Negative control (built in): the same restore from a tarball with the database's files removed
comes up at height 0, so check 3 would fail on it; a restore check that passed either way would
be no check.

The node binary is required: without it this fails, it does not skip. Nothing leaves the machine.
"""

import hashlib
import json
import os
import shutil
import socket
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
BIN = os.environ.get("TET_CORE_BIN") or os.path.join(ROOT, "target", "release", "TET-Core")
SCRIPT = os.path.join(ROOT, "scripts", "backup-node-data.sh")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=5) as r:
        return json.load(r)


def status(port):
    return get(port, "/status/live")


def height(port):
    return int(status(port).get("height") or 0)


def block(port, h):
    return get(port, f"/explorer/block/{h}")


class Node:
    def __init__(self, data_dir, mine):
        self.port = free_port()
        self.data_dir = data_dir
        env = {
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "HOME": data_dir,
            "TET_DB_DIR": os.path.join(data_dir, "tet.db"),
            "TET_REST_BIND": f"127.0.0.1:{self.port}",
            "TET_PORT": str(self.port),
            "TET_ENABLE_P2P": "0",
            "TET_AUTO_MINE": "1" if mine else "0",
            "TET_BLOCK_TIME_SEC": "1",
            "TET_TREASURY_ADDRESS": "fedcba0987654321fedcba0987654321fedcba0987654321fedcba0987654321",
            "TET_DB_ENCRYPT": "off",
            "RISC0_SKIP_BUILD": "1",
            "RUST_LOG": "warn",
        }
        self.log = open(os.path.join(data_dir, "..", os.path.basename(data_dir) + ".log"), "wb")
        self.p = subprocess.Popen([BIN], cwd=data_dir, env=env, stdout=self.log, stderr=subprocess.STDOUT)
        deadline = time.time() + 90
        while time.time() < deadline:
            if self.p.poll() is not None:
                raise RuntimeError(f"node exited {self.p.returncode}; see {self.log.name}")
            try:
                status(self.port)
                return
            except OSError:
                time.sleep(0.5)
        raise RuntimeError(f"node did not answer on {self.port}; see {self.log.name}")

    def stop(self):
        self.p.terminate()
        try:
            self.p.wait(timeout=30)
        except subprocess.TimeoutExpired:
            self.p.kill()
            self.p.wait()
        self.log.close()


def backup(data_dir, out_dir):
    r = subprocess.run(["bash", SCRIPT], env={**os.environ, "TET_DATA_DIR": data_dir, "TET_BACKUP_DIR": out_dir}, capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    lines = r.stdout.strip().splitlines()
    assert len(lines) == 2 and lines[1].startswith("sha256 "), r.stdout
    return lines[0], lines[1].split()[1]


def restore(tarball, into, drop_db=False):
    os.makedirs(into)
    with tarfile.open(tarball) as t:
        t.extractall(into, filter="data")
    if drop_db:
        shutil.rmtree(os.path.join(into, "tet.db"))
        os.makedirs(os.path.join(into, "tet.db"))
    return into


class BackupRestore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not os.access(BIN, os.X_OK):
            raise RuntimeError(f"TET-Core not found at {BIN}: cargo build --release -p tet-core --bin TET-Core, or set TET_CORE_BIN")
        cls.tmp = tempfile.mkdtemp()
        cls.data = os.path.join(cls.tmp, "live")
        os.makedirs(cls.data)
        node = Node(cls.data, mine=True)
        try:
            deadline = time.time() + 60
            while height(node.port) < 3 and time.time() < deadline:
                time.sleep(0.5)
            # The backup runs while the node is still up and mining: it stops nothing. The block
            # recorded is one at or below the height at the start, so it is in the copy.
            cls.h = height(node.port)
            cls.block = block(node.port, cls.h)
            cls.tarball, cls.sum = backup(cls.data, os.path.join(cls.tmp, "backups"))
            cls.still_running = node.p.poll() is None
        finally:
            node.stop()

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_backup_stops_nothing_and_prints_the_tarballs_sha256(self):
        self.assertTrue(self.still_running, "the node stopped during the backup")
        self.assertGreaterEqual(self.h, 3)
        self.assertRegex(os.path.basename(self.tarball), r"^tet-node-data-\d{4}-\d\d-\d\dT\d{6}Z\.tar\.gz$")
        with open(self.tarball, "rb") as f:
            self.assertEqual(hashlib.sha256(f.read()).hexdigest(), self.sum)
        with open(self.tarball + ".sha256") as f:
            self.assertEqual(f.read().split()[0], self.sum)

    def test_a_node_comes_back_up_from_the_tarball(self):
        d = restore(self.tarball, os.path.join(self.tmp, "restored"))
        node = Node(d, mine=False)
        try:
            h = height(node.port)
            b = block(node.port, self.h)
        finally:
            node.stop()
        self.assertGreaterEqual(h, self.h, "the restored node is behind the backup")
        self.assertEqual(b, self.block, "the restored node has a different block at the backup height")

    def test_control_a_tarball_without_the_database_comes_up_empty(self):
        d = restore(self.tarball, os.path.join(self.tmp, "no-db"), drop_db=True)
        node = Node(d, mine=False)
        try:
            h = height(node.port)
        finally:
            node.stop()
        self.assertLess(h, self.h, "without the database the restore check must fail")

    def test_backup_refuses_an_empty_or_missing_directory(self):
        empty = tempfile.mkdtemp(dir=self.tmp)
        for d in (empty, os.path.join(self.tmp, "nope")):
            r = subprocess.run(["bash", SCRIPT], env={**os.environ, "TET_DATA_DIR": d, "TET_BACKUP_DIR": os.path.join(self.tmp, "b2")}, capture_output=True, text=True)
            self.assertNotEqual(r.returncode, 0, d)


if __name__ == "__main__":
    sys.dont_write_bytecode = True
    unittest.main(verbosity=2)
