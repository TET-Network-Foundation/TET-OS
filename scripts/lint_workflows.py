#!/usr/bin/env python3
"""Reject workflow files GitHub would reject, before pushing them.

Specifically DUPLICATE KEYS. PyYAML's default loader accepts them last-wins, so a file with two
`if:` keys on one step parses cleanly in a local check and is then refused outright by GitHub — the
run appears with a `failure` conclusion and **zero jobs**, which looks nothing like a test failure
and sends you looking in the wrong place.

That happened on 2026-10-01 (run 36845749022) while replacing the two-workflow CI design: a step that
already carried `if: always()` was given a second `if:` for the new gate. The local validator said
the file was fine. A validator that accepts what the server rejects is not validating.

Also checks the things that broke CI in this repository before:
  * no concurrency group built from `github.workflow` — two workflows sharing a name then share the
    group and cancel each other (that is how a no-op mirror killed the real run and reported its
    check names green)
  * no two workflow files sharing a `name:`, for the same reason

Usage: scripts/lint_workflows.py [.github/workflows]
"""
from __future__ import annotations

import pathlib
import sys

import yaml


class StrictLoader(yaml.SafeLoader):
    pass


def _no_duplicate_keys(loader: yaml.Loader, node: yaml.MappingNode, deep: bool = False):
    seen: dict[object, int] = {}
    for key_node, _ in node.value:
        key = loader.construct_object(key_node, deep=deep)
        line = key_node.start_mark.line + 1
        if key in seen:
            raise yaml.YAMLError(
                f"duplicate key {key!r} on line {line} (first seen on line {seen[key]}) — "
                "GitHub refuses the whole file for this"
            )
        seen[key] = line
    return yaml.SafeLoader.construct_mapping(loader, node, deep)


StrictLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _no_duplicate_keys
)


def main(argv: list[str]) -> int:
    root = pathlib.Path(argv[1] if len(argv) > 1 else ".github/workflows")
    files = sorted(p for p in root.glob("*.yml")) + sorted(p for p in root.glob("*.yaml"))
    if not files:
        print(f"no workflow files under {root} — refusing to pass vacuously", file=sys.stderr)
        return 2

    failures = 0
    names: dict[str, pathlib.Path] = {}
    for path in files:
        try:
            doc = yaml.load(path.read_text(encoding="utf-8"), Loader=StrictLoader)
        except yaml.YAMLError as exc:
            print(f"FAIL {path}: {exc}", file=sys.stderr)
            failures += 1
            continue

        name = doc.get("name")
        if name in names:
            print(
                f"FAIL {path}: workflow name {name!r} is already used by {names[name]}. "
                "Two workflows sharing a name share any concurrency group built from "
                "github.workflow, and their check runs are indistinguishable by name.",
                file=sys.stderr,
            )
            failures += 1
        elif isinstance(name, str):
            names[name] = path

        group = (doc.get("concurrency") or {})
        group = group.get("group") if isinstance(group, dict) else None
        if isinstance(group, str) and "github.workflow" in group:
            print(
                f"FAIL {path}: concurrency group {group!r} is built from github.workflow. "
                "Use a literal: a second workflow with the same name would cancel this one.",
                file=sys.stderr,
            )
            failures += 1

        jobs = doc.get("jobs") or {}
        print(f"ok   {path}  name={name!r} jobs={list(jobs)}")

    if failures:
        print(f"{failures} problem(s) in {len(files)} workflow file(s)", file=sys.stderr)
        return 1
    print(f"{len(files)} workflow file(s) clean")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
