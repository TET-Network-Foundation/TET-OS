"""The runbook check (check_runbook.py) passes on the repository as it is, and fails, naming the item,
when one thing part 2 of docs/ops/TESTNET2_REHEARSAL.md relies on no longer exists.

    python3 tools/testnet2-rehearsal/test_runbook_commands.py

Each failing case changes exactly one item, either in a copy of the runbook or in a copy of the node's
source, so that only that item can be the reason. Nothing is started and nothing is fetched.
Exit 0 only if every case behaved as named.
"""

import os
import shutil
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CHECK = os.path.join(HERE, "check_runbook.py")
DOC = os.path.join(ROOT, "docs", "ops", "TESTNET2_REHEARSAL.md")

failures = []


def run(doc, root):
    r = subprocess.run([sys.executable, "-I", CHECK, "--doc", doc, "--root", root], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


def case(name, ok, out):
    print(f"{'ok  ' if ok else 'FAIL'} {name}")
    if not ok:
        failures.append(name)
        print("     " + out.strip().replace("\n", "\n     "))


def main():
    with open(DOC, encoding="utf-8") as fh:
        doc = fh.read()
    work = tempfile.mkdtemp(prefix="runbook-check-")
    try:
        code, out = run(DOC, ROOT)
        case("the runbook as committed passes", code == 0 and out.strip().endswith("ok"), out)

        def doc_case(name, old, new, want):
            i = doc.find("\n## Part 2")
            if i < 0 or doc.count(old, i) < 1:
                case(name, False, f"the runbook's part 2 no longer contains {old!r}: update this case")
                return
            path = os.path.join(work, "doc-" + str(len(os.listdir(work))) + ".md")
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(doc[:i] + doc[i:].replace(old, new))
            code, out = run(path, ROOT)
            case(name, code == 1 and want in out, out)

        doc_case("a setting the node does not read is refused",
                 "TET_PRODUCER_PEERS=local-wallet", "TET_PRODUCER_PIN=local-wallet",
                 "MISSING setting TET_PRODUCER_PIN")
        doc_case("a file that is not in the repository is refused",
                 "tools/testnet2-rehearsal/no-mdns.sb", "tools/testnet2-rehearsal/no-mdns-v2.sb",
                 "MISSING file tools/testnet2-rehearsal/no-mdns-v2.sb")
        doc_case("a binary that no workspace member builds is refused",
                 "$REPO/target/release/TET-Core ", "$REPO/target/release/TET-Core-Node ",
                 "MISSING file target/release/TET-Core-Node")
        doc_case("a log line the node does not print is refused",
                 "'libp2p PeerId: [A-Za-z0-9]*' \"$W/n2/node.log\"", "'libp2p PeerID: [A-Za-z0-9]*' \"$W/n2/node.log\"",
                 "MISSING log line 'libp2p PeerID: '")
        doc_case("a REST path that is not a route is refused",
                 "127.0.0.1:18102/explorer/block/", "127.0.0.1:18102/explorer/blocks/",
                 "MISSING route /explorer/blocks/")
        if sys.platform == "darwin":
            doc_case("a command that is not on PATH is refused",
                     "nohup sandbox-exec", "nohup sandbox-run",
                     "MISSING command sandbox-run")
        else:
            print("skip a command that is not on PATH is refused (not macOS: the check skips commands)")
        doc_case("a runbook whose part 2 cannot be read is refused",
                 "```bash\n", "```sh\n",
                 "none found in the Part 2 blocks")

        # the other side: the runbook is unchanged and the repository changes. Each copy holds only
        # what the check reads (no target/), as a clean checkout does, whether or not ROOT has a build.
        def copy_root(name):
            r = os.path.join(work, name)
            shutil.copytree(os.path.join(ROOT, "tet-core", "src"), os.path.join(r, "tet-core", "src"))
            shutil.copytree(HERE, os.path.join(r, "tools", "testnet2-rehearsal"),
                            ignore=shutil.ignore_patterns("__pycache__"))
            shutil.copy(os.path.join(ROOT, "Cargo.toml"), os.path.join(r, "Cargo.toml"))
            for d in os.listdir(ROOT):
                for sub in ("", "methods", "host"):
                    m = os.path.join(d, sub, "Cargo.toml")
                    if os.path.isfile(os.path.join(ROOT, m)) and not os.path.exists(os.path.join(r, m)):
                        os.makedirs(os.path.dirname(os.path.join(r, m)), exist_ok=True)
                        shutil.copy(os.path.join(ROOT, m), os.path.join(r, m))
            return r

        clean = copy_root("clean")
        code, out = run(DOC, clean)
        case("the runbook passes in a tree with no build (no target/ directory)",
             not os.path.exists(os.path.join(clean, "target")) and code == 0 and out.strip().endswith("ok"), out)

        nobin = copy_root("nobin")
        cargo = os.path.join(nobin, "tet-core", "Cargo.toml")
        with open(cargo, encoding="utf-8") as fh:
            s = fh.read()
        with open(cargo, "w", encoding="utf-8") as fh:
            fh.write(s.replace('name = "TET-Core"\n', 'name = "TET-Node"\n'))
        code, out = run(DOC, nobin)
        case("the node binary no longer declared in Cargo.toml is refused",
             s.count('name = "TET-Core"\n') == 1 and code == 1 and "MISSING file target/release/TET-Core:" in out, out)

        nosrc = copy_root("nosrc")
        os.remove(os.path.join(nosrc, "tet-core", "src", "main.rs"))
        code, out = run(DOC, nosrc)
        case("the node binary declared but its source gone is refused",
             code == 1 and "MISSING file target/release/TET-Core:" in out and "src/main.rs" in out, out)

        root2 = copy_root("root")
        renamed = 0
        for d, _, files in os.walk(os.path.join(root2, "tet-core", "src")):
            for f in files:
                p = os.path.join(d, f)
                with open(p, encoding="utf-8", errors="replace") as fh:
                    s = fh.read()
                if '"TET_BOOTNODES"' in s:
                    renamed += s.count('"TET_BOOTNODES"')
                    with open(p, "w", encoding="utf-8") as fh:
                        fh.write(s.replace('"TET_BOOTNODES"', '"TET_BOOT_PEERS"'))
        code, out = run(DOC, root2)
        case(f"the node no longer reading TET_BOOTNODES is refused ({renamed} places renamed)",
             renamed > 0 and code == 1 and "MISSING setting TET_BOOTNODES" in out, out)
    finally:
        shutil.rmtree(work)

    print(f"\n{'all passed' if not failures else str(len(failures)) + ' failed'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
