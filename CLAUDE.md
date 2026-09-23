# Project rules

## Regression guards must be verified non-vacuous

Every regression guard must be verified non-vacuous before commit: restore the bug (or invert the
key assertion), run the test, and confirm it **FAILS**. Record the negative-control result in the
commit body. A guard that passes with the bug present is decorative and must not be merged.

This is not hypothetical. Two guards in this repository passed with their bug fully present before
the control caught them — one drove a public entry point that rejected the test input on an
unrelated earlier check, so the assertion was true for the wrong reason; another guarded a wire
path that worked regardless of the fix it claimed to protect.

## A signable `TxV1` variant is not an appliable one

Before routing any REST write through the mempool, confirm `apply_consensus_block_batch` has an
arm for that `TxV1` variant. A signable variant is not an appliable one.

Its catch-all returns `Err("unsupported tx in consensus block")` rather than ignoring the tx, so
enqueueing a variant it does not handle does not silently drop the write — it makes **every node
reject the whole block**. `TxV1::GenesisBridge` is exactly this case: present in the enum, signed
and verified by its handler, and absent from the apply match.
