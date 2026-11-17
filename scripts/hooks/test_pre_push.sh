#!/bin/sh
# Offline test of the pre-push hook: a throwaway repo pushes to a throwaway bare repo on disk.
#
#   sh scripts/hooks/test_pre_push.sh [HOOK]     (default: scripts/hooks/pre-push)
#
# Cases:
#   (a) one named branch                      -> pushed
#   (b) a second named branch                 -> pushed
#   (c) `git push origin :` with 2 branches changed -> refused, and the remote is unchanged
#   (d) two named refspecs in one push         -> refused, and the remote is unchanged
#   (e) `git push origin :` when nothing changed -> passes (nothing to update)
#   (f) deleting one branch by name            -> pushed
# Negative control: run with HOOK=/usr/bin/true (a hook that allows everything): (c) and (d) FAIL.
# "push && check && ok || bad" is meant: bad when either the push or the check fails.
# shellcheck disable=SC2015
set -eu
hook=${1:-$(cd "$(dirname "$0")" && pwd)/pre-push}
t=$(mktemp -d)
trap 'rm -rf "$t"' EXIT
fail=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1"; fail=1; }

git init -q --bare "$t/remote.git"
git init -q "$t/work"
cd "$t/work"
git config user.email test@example.test
git config user.name test
git config push.default nothing
git remote add origin "$t/remote.git"
cp "$hook" .git/hooks/pre-push
chmod 755 .git/hooks/pre-push
git commit -q --allow-empty -m one
git branch -M a
git branch b

rsha() { git --git-dir="$t/remote.git" rev-parse -q --verify "refs/heads/$1" || echo none; }

git push -q origin refs/heads/a:refs/heads/a 2>/dev/null && [ "$(rsha a)" = "$(git rev-parse a)" ] && ok "(a) one named branch is pushed" || bad "(a) one named branch is pushed"
git push -q origin refs/heads/b:refs/heads/b 2>/dev/null && [ "$(rsha b)" = "$(git rev-parse b)" ] && ok "(b) a second named branch is pushed" || bad "(b) a second named branch is pushed"

git checkout -q a && git commit -q --allow-empty -m two
git checkout -q b && git commit -q --allow-empty -m three
before_a=$(rsha a) before_b=$(rsha b)

if git push -q origin : 2>"$t/err"; then bad "(c) 'git push origin :' updating 2 refs is refused"
elif ! grep -q "would update 2 refs" "$t/err"; then bad "(c) refused, but not by the hook: $(cat "$t/err")"
elif [ "$(rsha a)" != "$before_a" ] || [ "$(rsha b)" != "$before_b" ]; then bad "(c) refused, yet the remote changed"
else ok "(c) 'git push origin :' updating 2 refs is refused, remote unchanged"; fi

if git push -q origin refs/heads/a:refs/heads/a refs/heads/b:refs/heads/b 2>"$t/err"; then bad "(d) two named refspecs in one push are refused"
elif ! grep -q "would update 2 refs" "$t/err"; then bad "(d) refused, but not by the hook: $(cat "$t/err")"
elif [ "$(rsha a)" != "$before_a" ] || [ "$(rsha b)" != "$before_b" ]; then bad "(d) refused, yet the remote changed"
else ok "(d) two named refspecs in one push are refused, remote unchanged"; fi

git push -q origin refs/heads/a:refs/heads/a 2>/dev/null
git push -q origin refs/heads/b:refs/heads/b 2>/dev/null
git push -q origin : 2>/dev/null && ok "(e) ':' with nothing to update passes" || bad "(e) ':' with nothing to update passes"

git push -q origin :refs/heads/b 2>/dev/null && [ "$(rsha b)" = none ] && ok "(f) deleting one named branch is pushed" || bad "(f) deleting one named branch is pushed"

[ "$fail" = 0 ] && echo "pre-push hook: all cases pass" || echo "pre-push hook: FAILED"
exit "$fail"
