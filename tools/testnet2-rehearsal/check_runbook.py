"""Check that what part 2 of docs/ops/TESTNET2_REHEARSAL.md runs still exists.

    python3 -I tools/testnet2-rehearsal/check_runbook.py [--doc PATH] [--root PATH]

It reads the ```bash blocks of the section "## Part 2" and checks, against the repository at --root:
1. settings: every TET_* name the blocks set is read by the node (it appears as "NAME" in
   tet-core/src). TET_CORE_BIN is the runbook's own variable and is not checked.
2. files: every $REPO/<path> exists.
3. log lines: every grep 'pattern' on a node.log matches text the node prints. The literal part of
   the pattern (up to the first [ or \\ that is not an escaped ]) must appear in tet-core/src; a
   trailing "0x" is dropped, because the node prints the value with it.
4. REST routes: every 127.0.0.1:<port>/<path> is a route of the node ("/status/live", or
   "/explorer/block/:height" for a path ending in /).
5. commands on this machine (macOS only, where the runbook runs): the first word of each command
   that is not a shell builtin, a keyword or a function the blocks define is found on PATH.
   On other systems this part is reported as skipped, never as passed.

Each part must find at least one item, so a runbook that the parser cannot read fails rather than
passing with nothing checked. Exit 0 only if every item exists; exit 1 names each one that does not.
"""

import argparse
import os
import re
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OWN_VARS = {"TET_CORE_BIN"}
BUILTINS = {
    "cd", "echo", "test", "local", "shift", "return", "exit", "for", "do", "done", "if", "then",
    "else", "fi", "while", "kill", "read", "cat", "printf", "sleep", "set", "true", "false", "[", "{", "}",
}


def part2_blocks(doc_text):
    i = doc_text.find("\n## Part 2")
    if i < 0:
        return []
    section = doc_text[i + 1 :]
    j = section.find("\n## ", 1)
    if j >= 0:
        section = section[:j]
    return re.findall(r"```bash\n(.*?)```", section, re.S)


def source_text(root):
    parts = []
    for d, _, files in os.walk(os.path.join(root, "tet-core", "src")):
        for f in files:
            if f.endswith(".rs"):
                with open(os.path.join(d, f), encoding="utf-8", errors="replace") as fh:
                    parts.append(fh.read())
    return "\n".join(parts)


def literal_prefix(pattern):
    out, k = [], 0
    while k < len(pattern):
        c = pattern[k]
        if c == "\\" and k + 1 < len(pattern) and pattern[k + 1] == "]":
            out.append("]")
            k += 2
            continue
        if c in "[\\.*^$":
            break
        out.append(c)
        k += 1
    lit = "".join(out)
    return lit[:-2] if lit.endswith("0x") else lit


def command_words(code, functions):
    words = set()
    for line in code.replace("\\\n", " ").splitlines():
        line = re.sub(r"'[^']*'", "''", line.split(" #", 1)[0])
        line = re.sub(r'"(?:[^"$]|\$(?!\())*"', '""', line)  # quoted text without a $( ... )
        words.update(re.findall(r"\bnohup ([a-z][a-z0-9_.-]*)", line))
        for seg in re.split(r"&&|\|\||[;|(]|\$\(", line):
            toks = seg.split()
            while toks and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]):
                toks = toks[1:]
            if not toks:
                continue
            w = toks[0].strip(")")
            if re.match(r"^[a-z][a-z0-9_.-]*$", w) and w not in BUILTINS and w not in functions:
                words.add(w)
    return words


def check(doc, root):
    with open(doc, encoding="utf-8") as fh:
        blocks = part2_blocks(fh.read())
    code = "\n".join(blocks)
    src = source_text(root)
    missing, counts = [], {}

    envs = sorted(set(re.findall(r"\b(TET_[A-Z0-9_]+)=", code)) - OWN_VARS)
    counts["settings"] = len(envs)
    missing += [f'setting {e}: the node does not read it ("{e}" is not in tet-core/src)' for e in envs if f'"{e}"' not in src]

    paths = sorted(set(re.findall(r"\$REPO/([A-Za-z0-9_./-]+)", code)))
    counts["files"] = len(paths)
    missing += [f"file {p}: not in the repository" for p in paths if not os.path.exists(os.path.join(root, p))]

    greps = sorted({literal_prefix(p) for p in re.findall(r"grep (?:-[a-z0-9]+ )*'([^']+)' \"\$W/n[12]/node\.log\"", code)})
    counts["log lines"] = len(greps)
    missing += [f"log line {g!r}: the node no longer prints it" for g in greps if not g or g not in src]

    routes = sorted(set(re.findall(r"127\.0\.0\.1:[0-9]+(/[a-z/]+)", code)))
    counts["routes"] = len(routes)
    for r in routes:
        want = f'"{r}:' if r.endswith("/") else f'"{r}"'
        if want not in src:
            missing.append(f"route {r}: not a route of the node")

    functions = set(re.findall(r"^([a-z_]+)\(\)", code, re.M))
    words = sorted(command_words(code, functions))
    counts["commands"] = len(words)
    if sys.platform == "darwin":
        missing += [f"command {w}: not found on PATH" for w in words if shutil.which(w) is None]
        cmd_note = "checked on PATH"
    else:
        cmd_note = "SKIPPED (not macOS)"

    for k, n in counts.items():
        if n == 0:
            missing.append(f"{k}: none found in the Part 2 blocks (the parser read nothing)")
    print(f"{len(blocks)} blocks; " + ", ".join(f"{k} {n}" for k, n in counts.items()) + f"; commands {cmd_note}")
    for m in missing:
        print("MISSING " + m)
    print("ok" if not missing else f"{len(missing)} missing")
    return 1 if missing else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--doc", default=os.path.join(ROOT, "docs", "ops", "TESTNET2_REHEARSAL.md"))
    ap.add_argument("--root", default=ROOT)
    a = ap.parse_args()
    sys.exit(check(a.doc, a.root))
