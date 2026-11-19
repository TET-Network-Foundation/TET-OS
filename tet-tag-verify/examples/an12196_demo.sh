#!/usr/bin/env bash
# Shows tet-tag-verify's output without a tag: the AN12196 page 12 example (encrypted PICCData,
# all-zero key; the same vector as tests/sun_vectors.rs), once as text and once as JSON.
# Run from the repo root. Builds the crate locally; downloads nothing beyond what cargo already has.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
KEY=00000000000000000000000000000000
URL='https://ntag.nxp.com/424?e=EF963FF7828658A599F3041510671E88&c=94EED9EE65337086'
cargo build -q --offline -p tet-tag-verify
BIN="$(cargo metadata --format-version 1 --no-deps --offline | sed -n 's/.*"target_directory":"\([^"]*\)".*/\1/p')/debug/tet-tag-verify"
echo "\$ tet-tag-verify verify --key $KEY --url '$URL'"
"$BIN" verify --key "$KEY" --url "$URL"
echo
echo "\$ tet-tag-verify verify --key $KEY --url '$URL' --json"
"$BIN" verify --key "$KEY" --url "$URL" --json
