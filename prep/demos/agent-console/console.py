#!/usr/bin/env python3
"""Agent console: a demo page for agent keys and their checks. Local only (127.0.0.1).

One screen, four parts:
  1. My agents: one row per agent key (name, short key id, what it may do, uses left, state).
  2. Give a permit: pick an agent, an action and how many times; the agent's own key signs one
     one-time permit per use, and the page shows the signed permit.
  3. Check from outside: a log and a key id; the log is copied into a second folder that holds no key,
     and `notebook.py verify` runs there against that key id's pin, as another project would (no node).
     Three "try to cheat" rows change the outside copy, and each is refused for its own reason.
  4. What this shows and what it does not.

Every agent is a machine notebook (tools/machine-notebook/notebook.py) with a new test key made for
this demo. Every signature and every log check goes through notebook.py and `tet-cli agent sign|verify`;
pause, revoke and the uses-left count are this console's own. It signs for a demo chain (tet-agent-console-demo), not for a
network, and contacts nothing.

    python3 console.py --work <empty folder>   (tet-cli: TET_CLI, else <repo>/target/release/tet-cli)

Pause and revoke are this console's own: a paused agent's uses are refused here, and revoking destroys
the agent's key file on this computer. The outside check cannot see either; that is on the page.
"""

import argparse
import hashlib
import http.server
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
NOTEBOOK_DIR = os.path.join(ROOT, "tools", "machine-notebook")
NOTEBOOK = os.path.join(NOTEBOOK_DIR, "notebook.py")
sys.path.insert(0, NOTEBOOK_DIR)
sys.dont_write_bytecode = True
import notebook  # noqa: E402  (canonical(), sign(), chain_lines(), cited_permits(): the real tools)

CHAIN = {"TET_CHAIN_ID": "tet-agent-console-demo", "TET_GENESIS_HASH": hashlib.sha256(b"agent-console demo chain").hexdigest()}
ACTIONS = ["read-sensor", "open-gate", "send-report"]
AGENTS = [("rover", "Rover"), ("arm", "Arm"), ("reporter", "Reporter")]
MAX_PER_GRANT = 5        # the bound on "how many times" in one grant; the page shows it
PERMIT_WINDOW = 100      # a permit may be used by the next PERMIT_WINDOW records of that log
MAX_RECORDS = 200        # the bound on one agent's log in this demo; the page shows it
UNIT = "action"

NOT_SHOWN = [
    "When each record was written: the check judges the order of records in the log it is given; it does not judge when each record was written.",
    "That a reading or action really happened, or that the machine's clock was right.",
    "Which machine signed: the check judges which key signed each record; it does not judge which machine held that key.",
    "Use of a permit in another log: the permit check judges reuse of a permit within one log; it does not judge use of that permit in another log.",
    "Pause and revoke here are this console's own. The outside check cannot see them.",
    "That the log is complete at its end: not judged. A log produced by the key's holder: not judged; the check judges the log it is given against the pinned key.",
    "Who signs: today the agent's own key signs its permits. A permit signed by the owner is planned.",
    "Nothing here runs on a robot: the agents are folders on this computer.",
    "That the signature format is final: not judged.",
]


def tet_cli():
    return os.environ.get("TET_CLI") or os.path.join(ROOT, "target", "release", "tet-cli")


def run_notebook(args, stdin=None, cwd=None):
    env = dict(os.environ)
    env.pop("TET_MNEMONIC", None)
    env.update(CHAIN)
    env["TET_CLI"] = tet_cli()
    p = subprocess.run([sys.executable, NOTEBOOK] + args, input=stdin, capture_output=True, text=True,
                       env=env, cwd=cwd, timeout=300)
    return p.returncode, p.stdout, p.stderr


class Refused(ValueError):
    """A request the console refuses; the page shows the message."""


def read_json(path):
    with open(path, "rb") as f:
        return json.loads(f.read())


def write_bytes(path, body):
    with open(path, "wb") as f:
        f.write(body)


def parse_verify(out):
    """notebook.py verify prints VALID or INVALID, then one line per problem ('record N: why' or
    'log: why'), then 'Shows:'."""
    lines = re.sub(r"\x1b\[[0-9;]*m", "", out).splitlines()
    verdict = lines[0].strip() if lines else ""
    by_seq, log = {}, []
    for ln in lines[1:]:
        if ln.startswith("Shows:"):
            break
        m = re.fullmatch(r"  record ([0-9]+): (.*)", ln)
        if m:
            by_seq.setdefault(int(m.group(1)), []).append(m.group(2))
        elif ln.startswith("  log: "):
            log.append(ln[len("  log: "):])
    return {"verdict": verdict, "by_seq": by_seq, "log": log}


def verified_names(d):
    """The record files notebook.py verify reads in log folder d, in its order: (seq, name) for every
    name that is ASCII digits then .json, listed exactly as its check_chain lists them."""
    rec_dir = os.path.join(d, "records")
    return sorted(
        (int(m.group(1)), n) for n in os.listdir(rec_dir) if (m := re.fullmatch(r"([0-9]+)\.json", n))
    ) if os.path.isdir(rec_dir) else []


class Console:
    """The work folder:
      device/<agent>/   each agent's notebook: its key (device.key, mode 0600), records, permits
      pins/<agent>.pin  each agent's two key ids, copied out of its folder at init
      outside/<agent>/  the outside checker's copy of a log: no key, no pin
      console.json      names and pause/revoke states (this console's own, not signed)
    """

    def __init__(self, work):
        self.work = os.path.abspath(work)
        self.device = os.path.join(self.work, "device")
        self.pins = os.path.join(self.work, "pins")
        self.outside = os.path.join(self.work, "outside")
        self.lock = threading.Lock()
        self.agents = {}
        self.last_check = None
        self.events = []

    def event(self, s):
        self.events.append(time.strftime("%H:%M:%S ") + s)
        self.events = self.events[-12:]

    def dir(self, slug):
        if not isinstance(slug, str) or slug not in self.agents:
            raise Refused("no such agent")
        return os.path.join(self.device, slug)

    def save(self):
        with open(os.path.join(self.work, "console.json"), "w") as f:
            json.dump(self.agents, f, indent=1)

    def init(self, seed=True):
        if os.path.exists(self.work) and os.listdir(self.work):
            raise SystemExit(f"{self.work} is not empty; give an empty folder")
        for d in (self.device, self.pins, self.outside):
            os.makedirs(d, mode=0o700, exist_ok=True)
        for slug, name in AGENTS:
            d = os.path.join(self.device, slug)
            rc, out, err = run_notebook(["init", "--dir", d])
            if rc != 0:
                raise SystemExit(f"notebook init failed: {err.strip()}")
            shutil.copyfile(os.path.join(d, "device.pin"), os.path.join(self.pins, f"{slug}.pin"))
            self.agents[slug] = {"name": name, "state": "active"}
        self.save()
        if seed:
            # A start that has something to look at: Rover may open the gate twice and has done it once.
            self.grant("rover", "open-gate", 2)
            self.use("rover", "open-gate")
            self.grant("arm", "read-sensor", 1)
        self.event("three agents made, each with a new test key")

    # ── part 1: my agents ──────────────────────────────────────────────────────────────────────

    def open_permits(self, slug):
        """The agent's permits that its next record may still use, read from its own log the way
        notebook.py counts them: not cited by any record, and the next seq is within expires_seq."""
        d = self.dir(slug)
        n = len(notebook.chain_lines(d))
        # Walked back from the agent's own device.head, as notebook.py record does before it signs.
        cited = notebook.cited_permits(d, *notebook.read_head(d))
        out = []
        pdir = os.path.join(d, "permits")
        for name in sorted(os.listdir(pdir)) if os.path.isdir(pdir) else []:
            if not name.endswith(".json") or name.endswith(".sig.json"):
                continue
            p = read_json(os.path.join(pdir, name))
            if p["permit_id"] not in cited and n + 1 <= p["expires_seq"]:
                out.append(p)
        return out

    def row(self, slug):
        d = self.dir(slug)
        with open(os.path.join(self.pins, f"{slug}.pin")) as f:
            keyid = f.read().split()[0]
        left = {}
        for p in self.open_permits(slug):
            left[p["action"]] = left.get(p["action"], 0) + 1
        return {
            "slug": slug, "name": self.agents[slug]["name"], "state": self.agents[slug]["state"],
            "keyid": keyid, "keyid_short": keyid.split(":", 1)[1][:12],
            "may": [{"action": a, "left": left[a]} for a in sorted(left)],
            "records": len(notebook.chain_lines(d)),
        }

    # ── part 2: give a permit, and use one ─────────────────────────────────────────────────────

    def grant(self, slug, action, count):
        d = self.dir(slug)
        if action not in ACTIONS:
            raise Refused("pick one of the listed actions")
        if type(count) is not int or not 1 <= count <= MAX_PER_GRANT:
            raise Refused(f"how many times: 1 to {MAX_PER_GRANT}")
        state = self.agents[slug]["state"]
        if state != "active":
            raise Refused(f"{self.agents[slug]['name']} is {state}; it signs no permit")
        expires = len(notebook.chain_lines(d)) + PERMIT_WINDOW
        ids = []
        for _ in range(count):
            rc, out, err = run_notebook(["permit", "--dir", d, "--action", action, "--expires-seq", str(expires)])
            if rc != 0:
                raise Refused(err.strip() or "notebook permit failed")
            ids.append(out.strip().split()[-1])
        pid = ids[-1]
        with open(os.path.join(d, "permits", f"{pid}.json"), "rb") as f:
            body = f.read()
        env = read_json(os.path.join(d, "permits", f"{pid}.json.sig.json"))
        self.event(f"{self.agents[slug]['name']}: {count} one-time permit(s) for {action}, signed by its own key")
        return {"count": count, "permit": body.decode(), "envelope": envelope_summary(env), "ids": ids}

    def use(self, slug, action):
        """The agent does the action once: one record, citing one open permit, through notebook.py
        record (which refuses a used or expired permit before writing)."""
        d = self.dir(slug)
        state = self.agents[slug]["state"]
        if state != "active":
            raise Refused(f"{self.agents[slug]['name']} is {state}; this console refuses its use")
        if len(notebook.chain_lines(d)) >= MAX_RECORDS:
            raise Refused(f"this demo keeps at most {MAX_RECORDS} records per agent")
        mine = [p for p in self.open_permits(slug) if p["action"] == action]
        if not mine:
            raise Refused(f"{self.agents[slug]['name']} has no use of {action} left")
        pid = mine[0]["permit_id"]
        rc, out, err = run_notebook(["record", "--dir", d, "--source", "stdin-json", "--permit", pid],
                                    json.dumps({"value": action, "unit": UNIT}))
        if rc != 0:
            raise Refused(err.strip() or "notebook record failed")
        self.event(f"{self.agents[slug]['name']}: {action}, record {len(notebook.chain_lines(d))}")
        return out.strip()

    def pause(self, slug):
        self.dir(slug)
        a = self.agents[slug]
        if a["state"] == "revoked":
            raise Refused("a revoked agent stays revoked")
        a["state"] = "active" if a["state"] == "paused" else "paused"
        self.save()
        self.event(f"{a['name']}: {a['state']}")

    def revoke(self, slug):
        d = self.dir(slug)
        a = self.agents[slug]
        key = os.path.join(d, "device.key")
        if os.path.exists(key):
            os.remove(key)
        a["state"] = "revoked"
        self.save()
        self.event(f"{a['name']}: revoked; its key file on this computer is destroyed")

    # ── part 3: check from outside ─────────────────────────────────────────────────────────────

    def copy_out(self, slug):
        """Copy an agent's log into the outside folder: records, permits, chain. No key, no pin, no head."""
        src = self.dir(slug)
        dst = os.path.join(self.outside, slug)
        if os.path.exists(dst):
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("device.key", "device.pin", "device.head"))
        return dst

    def verify(self, slug, key_slug):
        """notebook.py verify on the outside copy against key_slug's pin; run from the outside folder,
        with no key and no node."""
        self.dir(key_slug)
        d = os.path.join(self.outside, slug)
        t = time.time()
        rc, out, err = run_notebook(["verify", "--dir", d, "--pin", os.path.join(self.pins, f"{key_slug}.pin")], cwd=self.outside)
        r = parse_verify(out)
        if r["verdict"] not in ("VALID", "INVALID"):
            r = {"verdict": "ERROR", "by_seq": {}, "log": [err.strip()[-300:]]}
        r["ms"] = int((time.time() - t) * 1000)
        r["log_of"], r["key_of"] = slug, key_slug
        # The page's "record(s) checked" is the number of record files verify read: names listed exactly
        # as notebook.py check_chain lists them, never a count of chain.txt's own lines.
        r["records"] = len(verified_names(d))
        # The page names the folder, not its full path (which would show the user's home folder).
        r["by_seq"] = {str(k): [w.replace(self.work + os.sep, "") for w in v] for k, v in r["by_seq"].items()}
        return r

    def check(self, slug, key_slug, cheat=None):
        self.copy_out(slug)
        cheat_note = None
        if cheat:
            cheat_note = {"overuse": self.cheat_overuse, "alter": self.cheat_alter, "swapkey": self.cheat_swapkey}[cheat](slug)
        r = self.verify(slug, key_slug)
        r["cheat"] = cheat_note
        self.last_check = r
        who = self.agents[slug]["name"]
        self.event(f"outside check of {who}'s log" + (f" ({cheat})" if cheat else "") + f": {r['verdict']}")
        return r

    def _last(self, d):
        n = len(notebook.chain_lines(d))
        if n < 1:
            raise Refused("this log has no records yet; use a permit first")
        return n

    def cheat_overuse(self, slug):
        """Use a permit one time too many: the agent writes one more record citing a permit a record
        already used. It is signed with the agent's own key and links to the record before it, so the
        signature, key, seq and prev checks all pass: only the one-time permit check can refuse it."""
        src, d = self.dir(slug), os.path.join(self.outside, slug)
        if not os.path.exists(os.path.join(src, "device.key")):
            raise Refused("this agent's key is destroyed, so it cannot sign the extra record")
        # The outside copy holds no device.head; the cheat walks back from the copy's own newest record.
        chain = notebook.chain_lines(d)
        cited = notebook.cited_permits(d, len(chain), chain[-1]) if chain else {}
        if not cited:
            raise Refused("no permit has been used in this log yet; use one first")
        pid, first = min(cited.items(), key=lambda kv: kv[1])
        seq = len(chain) + 1
        rec = {"v": 1, "kind": notebook.KIND, "seq": seq, "prev": chain[-1],
               "reading": {"source": "stdin-json", "value": "extra-use", "unit": UNIT},
               "clock_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        rec["permit"] = pid  # control:overuse
        body = notebook.canonical(rec)
        path = os.path.join(d, "records", f"{seq}.json")
        write_bytes(path, body)
        notebook.sign(tet_cli(), src, path, notebook.PAYLOAD_TYPE)
        with open(os.path.join(d, "chain.txt"), "a") as f:
            f.write(notebook.sha256_hex(body) + "\n")
        return {"seq": seq, "what": f"record {seq} added, citing the permit record {first} already used"}

    def cheat_alter(self, slug):
        """Alter a record: the newest record's logged value is edited after signing."""
        d = os.path.join(self.outside, slug)
        seq = self._last(d)
        path = os.path.join(d, "records", f"{seq}.json")
        rec = read_json(path)
        rec["reading"]["value"] = "something-else"
        write_bytes(path, notebook.canonical(rec))  # control:alter
        return {"seq": seq, "what": f"record {seq}: logged value edited"}

    def cheat_swapkey(self, slug):
        """Swap in another key: the newest record keeps its bytes but is signed again by another
        agent's key. That signature is valid, so only the key pin can refuse it."""
        d = os.path.join(self.outside, slug)
        seq = self._last(d)
        other = next((s for s in self.agents if s != slug and os.path.exists(os.path.join(self.device, s, "device.key"))), None)
        if other is None:
            raise Refused("no other agent holds a key to sign with")
        path = os.path.join(d, "records", f"{seq}.json")
        notebook.sign(tet_cli(), os.path.join(self.device, other), path, notebook.PAYLOAD_TYPE)  # control:swapkey
        return {"seq": seq, "what": f"record {seq}: signed again by {self.agents[other]['name']}'s key"}

    def state(self):
        return {
            "agents": [self.row(s) for s in self.agents], "actions": ACTIONS, "max_per_grant": MAX_PER_GRANT,
            "permit_window": PERMIT_WINDOW, "max_records": MAX_RECORDS, "check": self.last_check,
            "events": self.events, "shows": notebook.SHOWS, "not_shown": NOT_SHOWN,
        }


def envelope_summary(env):
    """What the page shows of a signed envelope: payload type, and per half the key id and the
    signature's length. The full envelope stays in the agent's folder."""
    halves = []
    for s in env.get("signatures", []):
        halves.append({k: (v if k in ("keyid", "alg") else f"{len(v)} characters")
                       for k, v in s.items() if isinstance(v, str)})
    return {"payloadType": env.get("payloadType"), "signatures": halves}


# ── the page server (127.0.0.1 only) ──────────────────────────────────────────────────────────


def make_handler(con, port):
    with open(os.path.join(HERE, "page.html"), "rb") as f:
        page = f.read()
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype="application/json"):
            b = body if isinstance(body, bytes) else json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(b)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'")
            self.end_headers()
            self.wfile.write(b)

        def do_GET(self):
            if self.headers.get("Host") not in allowed_hosts:
                return self.send(403, {"error": "host"})
            if self.path == "/":
                return self.send(200, page, "text/html; charset=utf-8")
            if self.path == "/state":
                with con.lock:
                    return self.send(200, con.state())
            self.send(404, {"error": "not found"})

        def do_POST(self):
            # A page on another site may not press the buttons: same Host and Origin, JSON only.
            origin = self.headers.get("Origin")
            if self.headers.get("Host") not in allowed_hosts or (origin and origin.split("//", 1)[-1] not in allowed_hosts):
                return self.send(403, {"error": "host"})
            if self.headers.get("Content-Type") != "application/json":
                return self.send(415, {"error": "JSON only"})
            n = int(self.headers.get("Content-Length") or 0)
            if n > 4096:
                return self.send(413, {"error": "too large"})
            try:
                q = json.loads(self.rfile.read(n) or b"{}")
                if not isinstance(q, dict):
                    raise ValueError
            except ValueError:
                return self.send(400, {"error": "bad JSON"})
            routes = {
                "/grant": lambda: con.grant(q.get("agent"), q.get("action"), q.get("count")),
                "/use": lambda: con.use(q.get("agent"), q.get("action")),
                "/pause": lambda: con.pause(q.get("agent")),
                "/revoke": lambda: con.revoke(q.get("agent")),
                "/check": lambda: con.check(q.get("log"), q.get("key"), q.get("cheat") or None),
            }
            fn = routes.get(self.path)
            if not fn:
                return self.send(404, {"error": "not found"})
            if self.path == "/check" and q.get("cheat") not in (None, "", "overuse", "alter", "swapkey"):
                return self.send(400, {"error": "unknown cheat"})
            with con.lock:
                try:
                    r = fn()
                except Refused as e:
                    return self.send(409, {"error": str(e)})
            self.send(200, {"ok": True, "result": r})

    return H


def main(argv=None):
    p = argparse.ArgumentParser(description="agent console demo, 127.0.0.1 only")
    p.add_argument("--work", required=True, help="an empty folder; the console makes device/, pins/ and outside/ in it")
    p.add_argument("--port", type=int, default=8766)
    a = p.parse_args(argv)
    if not os.path.exists(tet_cli()):
        raise SystemExit("tet-cli not found: set TET_CLI or build it (cargo build -p tet-cli --release)")
    con = Console(a.work)
    con.init()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", a.port), make_handler(con, a.port))
    print(f"open http://127.0.0.1:{a.port}/   (Ctrl-C to quit)", flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
