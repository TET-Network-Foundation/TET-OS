#!/usr/bin/env python3
"""TLS stays rustls: no OpenSSL or native-tls in what the workspace ships, and both root stores stay on.

Run from the repository root: python3 tools/deps/test_no_openssl.py

For each release target it lists the workspace's normal and build dependencies with
`cargo tree --locked` and checks:

  1. none of openssl-sys, openssl or native-tls is in the tree. One dependency that declares reqwest
     without `default-features = false` turns reqwest's default-tls back on, and that brings
     native-tls and, on Linux, OpenSSL with it. That is how hf-hub did it before it was removed.
  2. rustls-native-certs is in the tree, so reqwest still loads the operating system's root store
     next to the bundled Mozilla roots (`rustls-tls-native-roots` in tet-core/Cargo.toml).

A listing that does not run, or that does not contain reqwest and rustls, fails the test rather than
passing it: an empty tree has no OpenSSL in it either.

Known limits: dev-dependencies are not checked (tests may link what the binaries do not), and the
target list is the release targets plus nothing else. Cargo has to be able to read every crate in
Cargo.lock; offline that needs them in the local cache (set CARGO_NET_OFFLINE=true to be sure
nothing is fetched).
"""
import subprocess
import sys

TARGETS = [
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "aarch64-apple-darwin",
]
FORBIDDEN = {"openssl-sys", "openssl", "native-tls"}
REQUIRED = {"reqwest", "rustls", "rustls-native-certs"}


def packages(target):
    cmd = [
        "cargo", "tree", "--workspace", "--locked",
        "-e", "normal,build",
        "--target", target,
        "--prefix", "none",
        "--format", "{p}",
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {target}: cargo tree exited {r.returncode}", file=sys.stderr)
        print(r.stderr[-2000:], file=sys.stderr)
        sys.exit(1)
    names = set()
    for line in r.stdout.splitlines():
        line = line.strip()
        if line:
            names.add(line.split(" ", 1)[0])
    return names


def main():
    failed = False
    for target in TARGETS:
        names = packages(target)
        missing = sorted(REQUIRED - names)
        found = sorted(FORBIDDEN & names)
        if missing:
            failed = True
            print(f"FAIL {target}: not in the tree: {', '.join(missing)}")
        if found:
            failed = True
            print(f"FAIL {target}: in the tree: {', '.join(found)}")
        if not missing and not found:
            print(f"ok   {target}: {len(names)} packages, no OpenSSL or native-tls, native roots on")
    if failed:
        sys.exit(1)
    print("OK   TLS is rustls with both root stores on every release target")


if __name__ == "__main__":
    main()
