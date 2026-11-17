#!/bin/sh
# Install scripts/hooks/pre-push into this repository's shared hooks directory, so every worktree
# uses it. It copies the file (a link would break if the worktree it points into is removed), and it
# refuses to replace a different pre-push hook that is already there.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
if [ -n "$(git config --get core.hooksPath || true)" ]; then
  echo "install: core.hooksPath is set ($(git config --get core.hooksPath)); install the hook there by hand" >&2
  exit 2
fi
dest="$(git rev-parse --path-format=absolute --git-common-dir)/hooks/pre-push"
if [ -e "$dest" ] && ! cmp -s "$here/pre-push" "$dest"; then
  echo "install: $dest exists and differs; not replacing it" >&2
  exit 2
fi
cp "$here/pre-push" "$dest"
chmod 755 "$dest"
echo "installed: $dest"
