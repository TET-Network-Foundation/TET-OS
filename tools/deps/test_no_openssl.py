#!/usr/bin/env python3
"""TLS stays rustls: no OpenSSL or native-tls in what the workspace ships, and both root stores stay on.

Run from the repository root: python3 tools/deps/test_no_openssl.py

It checks each shipped build on its own, because cargo resolves features per build:
  - tet-cli (the release archives),
  - tet-core with its default features (TET-Core, TET-Worker-App and the other tet-core binaries),
  - tet-core with --features zk-prove (the node image: Dockerfile, docker-compose.yml, zk-image.yml),
and the whole workspace once more. For each, on every release target, it lists the normal and build
dependencies with `cargo tree --locked` and checks:

  1. none of openssl-sys, openssl or native-tls is in the tree, and no package in it declares
     `links = "ssl"`, `"openssl"` or `"crypto"` (a C binding to libssl under another name). One
     dependency that declares reqwest without `default-features = false` turns reqwest's default-tls
     back on, and that brings native-tls and, on Linux, OpenSSL with it. That is how hf-hub did it.
  2. (per build, not the workspace) reqwest itself has both root-store features on:
     rustls-tls-webpki-roots-no-provider (the bundled Mozilla roots) and
     rustls-tls-native-roots-no-provider (the operating system's store). Only reqwest's own feature
     makes it load the OS store; rustls-native-certs being somewhere in the tree is not enough.

A listing that does not run, or that does not contain reqwest and rustls, fails the test rather than
passing it: an empty tree has no OpenSSL in it either.

Known limits: dev-dependencies are not checked (tests may link what the binaries do not); only the
three release targets; names and `links` only, so a crate that links libssl through RUSTFLAGS,
a .cargo/config override or a build script without `links` is not seen; crates outside the
workspace (archive/, the zk guests) are not checked. Cargo has to be able to read every crate in
Cargo.lock; offline that needs them in the local cache (set CARGO_NET_OFFLINE=true to be sure nothing
is fetched).
"""
import json
import subprocess
import sys

TARGETS = [
    "x86_64-unknown-linux-gnu",
    "aarch64-unknown-linux-gnu",
    "aarch64-apple-darwin",
]
# (label, cargo tree arguments, whether reqwest's own features are checked)
BUILDS = [
    ("tet-cli", ["-p", "tet-cli"], True),
    ("tet-core", ["-p", "tet-core"], True),
    ("tet-core zk-prove", ["-p", "tet-core", "--features", "zk-prove"], True),
    ("workspace", ["--workspace"], False),
]
FORBIDDEN = {"openssl-sys", "openssl", "native-tls"}
FORBIDDEN_LINKS = {"ssl", "openssl", "crypto"}
REQUIRED = {"reqwest", "rustls"}
REQWEST_FEATURES = {
    "rustls-tls-webpki-roots-no-provider",
    "rustls-tls-native-roots-no-provider",
}


def cargo(args, what):
    r = subprocess.run(["cargo"] + args, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"FAIL {what}: cargo exited {r.returncode}", file=sys.stderr)
        print(r.stderr[-2000:], file=sys.stderr)
        sys.exit(1)
    return r.stdout


def links_by_name():
    meta = json.loads(cargo(["metadata", "--locked", "--format-version", "1"], "cargo metadata"))
    out = {}
    for p in meta["packages"]:
        if p.get("links"):
            out.setdefault(p["name"], set()).add(p["links"])
    return out


def packages(build_args, target, what):
    out = cargo(["tree", "--locked", "-e", "normal,build", "--target", target,
                 "--prefix", "none", "--format", "{p}"] + build_args, what)
    return {line.split(" ", 1)[0] for line in out.splitlines() if line.strip()}


def reqwest_features(build_args, target, what):
    out = cargo(["tree", "--locked", "-e", "features,normal,build", "-i", "reqwest", "--target", target,
                 "--prefix", "none"] + build_args, what)
    feats = set()
    for line in out.splitlines():
        if line.startswith('reqwest feature "'):
            feats.add(line.split('"')[1])
    return feats


def main():
    links = links_by_name()
    failed = False
    for label, args, check_features in BUILDS:
        for target in TARGETS:
            what = f"{label} on {target}"
            names = packages(args, target, what)
            problems = []
            missing = sorted(REQUIRED - names)
            if missing:
                problems.append("not in the tree: " + ", ".join(missing))
            found = sorted(FORBIDDEN & names)
            if found:
                problems.append("in the tree: " + ", ".join(found))
            linking = sorted(f"{n} (links {l})" for n in names for l in links.get(n, ()) if l in FORBIDDEN_LINKS)
            if linking:
                problems.append("links a TLS C library: " + ", ".join(linking))
            if check_features:
                off = sorted(REQWEST_FEATURES - reqwest_features(args, target, what))
                if off:
                    problems.append("reqwest feature off: " + ", ".join(off))
            if problems:
                failed = True
                print(f"FAIL {what}: " + "; ".join(problems))
            else:
                print(f"ok   {what}: {len(names)} packages, no OpenSSL or native-tls"
                      + (", both root stores on" if check_features else ""))
    if failed:
        sys.exit(1)
    print("OK   TLS is rustls, with both root stores on, in every shipped build on every release target")


if __name__ == "__main__":
    main()
