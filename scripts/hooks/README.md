# Git hooks

## pre-push: one ref per push

`pre-push` refuses any push that would update more than one ref on the remote. It was added
2026-11-17, with the owner's approval, after a push loop's variables came out empty and
`git push origin $2:$3` ran as `git push origin :`. That form pushes every branch whose name matches
on both sides, and one branch that wasn't ours moved on GitHub (it was put back the same night).

It pairs with `git config push.default nothing`, which makes a bare `git push` fail. That setting
does not cover `:`, because `:` is an explicit refspec. The hook covers both, because it looks at what
the push would update, not at the command line.

**Install** (once per clone; every worktree shares the hook):

    sh scripts/hooks/install.sh
    git config push.default nothing

`install.sh` copies the hook into the repository's shared hooks directory (`git rev-parse
--git-common-dir`/hooks). It refuses to replace a different `pre-push` that is already there, and it
stops if `core.hooksPath` is set. After changing `scripts/hooks/pre-push`, run it again: the
installed copy does not follow the file.

**Push one branch per command, with an explicit refspec:**

    git push origin refs/heads/<branch>:refs/heads/<branch>

**Test** (offline: a throwaway repo pushes to a throwaway bare repo on disk):

    sh scripts/hooks/test_pre_push.sh                 # all cases pass
    sh scripts/hooks/test_pre_push.sh /usr/bin/true   # negative control: (c) and (d) FAIL

**Limits:**
- A `:` push that happens to match exactly one changed branch passes. The hook sees only what the push
  would update, not the refspec that was typed.
- `git push --no-verify` skips the hook. It is a safety net for mistakes, not access control.
