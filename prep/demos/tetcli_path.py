"""The path to tet-cli for every demo under prep/demos, always absolute.

TET_CLI if it is set, else <repo>/target/release/tet-cli. A relative TET_CLI is taken against the
directory the process was started in (CI hands `target/debug/tet-cli`, relative to the repository
root), so the path stays right when a demo starts a subprocess in another folder.

    tet_cli()        the absolute path
    tool_env(env)    a copy of env (else os.environ) whose TET_CLI is that absolute path; give it to every
                     subprocess that may run tet-cli, so none is handed a relative path
"""

import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Read once, when the first demo module imports this, before any demo changes directory.
START_DIR = os.getcwd()


def tet_cli():
    path = os.environ.get("TET_CLI") or os.path.join(ROOT, "target", "release", "tet-cli")
    return os.path.normpath(os.path.join(START_DIR, path))  # control:abspath


def tool_env(env=None):
    out = dict(os.environ if env is None else env)
    out["TET_CLI"] = tet_cli()
    return out
