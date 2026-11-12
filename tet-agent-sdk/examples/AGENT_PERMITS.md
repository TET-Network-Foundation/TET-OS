# An agent action allowed once

`agent_permit_once.mjs` lets an agent take one action exactly once, using the machine notebook's
one-time permits (`tools/machine-notebook`, "One-time permits"). Every signature and check is
`tet-cli agent sign` / `agent verify`, run by `notebook.py`. Nothing new is signed and no new
cryptography is added.

```sh
cargo build -p tet-cli --release
node tet-agent-sdk/examples/agent_permit_once.mjs      # or TET_CLI=path/to/tet-cli
```

It runs locally, in a temporary directory, bound to an example chain id that no node runs. It prints
each step and exits non-zero if any step behaves differently:

1. the agent gets its own key (a notebook device key, never the owner's);
2. a permit for one action (`send-weekly-report`, valid up to record 5);
3. **first use:** the agent claims the permit (a signed record citing it), then acts;
4. **second use:** the claim is refused, so the agent does not act;
5. `verify` reads the log as VALID: one action, under one permit;
6. a log forged to use the permit twice (a record signed with the same key, written past the
   agent's own refusal) reads INVALID for exactly that reason.

The order matters: **claim, then act.** An agent that acted first and recorded afterwards could do
the action and then fail to record it.

## What it shows

- which key claimed the permit, and in which record;
- that a permit limits how often **this key's log** accepts the action: once, and not after it
  expires;
- that a log using a permit twice, or past its expiry, or with a permit another key signed, is
  refused by `verify`.

## What it does not show

- that a copied key did not write a **second log**: anyone holding the agent's key can start another
  notebook and use the same permit there; nothing in this log can see that;
- that the action actually happened, or happened only once in the world: the log records the
  agent's claim, not the action;
- who runs the agent, or that its clock was right;
- that the action was a good idea.
