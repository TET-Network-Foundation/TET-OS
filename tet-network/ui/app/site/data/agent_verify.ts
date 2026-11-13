/**
 * A real terminal capture, shown in the site's terminal block. Not edited: ANSI colour codes stripped,
 * nothing else changed. scripts/site_guard.mjs checks the block renders this text only.
 *
 * How it was made (2026-11-13): tet-cli built from commit 5dd6895 ("tet 0.1.0"), run in a copy of the
 * sample notebook folder (a temporary test key, the example chain tet-sample-notebook; no node runs
 * it), with TET_CHAIN_ID and TET_GENESIS_HASH taken from its chain.json. The second run checks a copy
 * of record 1 whose reading was changed from 21.5 to 29.5.
 */
export const AGENT_VERIFY = {
  tool: "tet-cli 0.1.0, built from commit 5dd6895",
  taken: "2026-11-13",
  text: `$ tet-cli agent verify --sig records/1.json.sig.json --payload records/1.json
chain      : tet-sample-notebook
payloadType: application/vnd.tet.machine-log+json
signer     : 0109615d0a67c285ce56d658879a11c3ad5bc3b6303963a77a95a690a0050892
payload    : records/1.json matches (210 bytes)
OK         : ed25519 + ML-DSA-44 both verify
$ tet-cli agent verify --sig records/1.json.sig.json --payload records/1-edited.json
chain      : tet-sample-notebook
payloadType: application/vnd.tet.machine-log+json
signer     : 0109615d0a67c285ce56d658879a11c3ad5bc3b6303963a77a95a690a0050892
FAIL       : records/1-edited.json is not the 210 bytes this envelope signed
`,
} as const;
