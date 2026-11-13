#!/usr/bin/env bash
# backup-node-data.sh — snapshot a node's database into a dated tarball and print its SHA-256.
#
#   sudo bash scripts/backup-node-data.sh                       # the compose volume, into /var/backups/tet
#   TET_DATA_DIR=/path/to/data TET_BACKUP_DIR=/tmp/b bash scripts/backup-node-data.sh
#
# It stops nothing: the node keeps running and serving while the copy is taken. Then pull the
# tarball to a machine OUTSIDE the host, every week (docs/OPS_CHECKLIST.md):
#
#   scp -P 8443 root@<host>:/var/backups/tet/tet-node-data-<stamp>.tar.gz .   # then compare the SHA-256
#
# What a hot copy is: sled (the node's database) is written to while the files are read, so the
# tarball is like the state a power cut would leave, which sled is built to recover from. The
# restore test (tools/node-backup/test_backup_restore.py) brings a node up from such a tarball. If a
# restore ever fails anyway, use the week before and let the node catch up from its peers.
#
# Where the data is: TET_DATA_DIR if set (a directory: the node's TET_DB_DIR and everything beside
# it), else the Docker volume TET_DATA_VOLUME (default tet-os_tet_core_data, the volume
# docker-compose.yml names for /data). The tarball holds that directory's contents, nothing else.
# It prints exactly two lines on success: the tarball's path, then "sha256 <hex>".
set -euo pipefail

BACKUP_DIR="${TET_BACKUP_DIR:-/var/backups/tet}"
KEEP="${TET_BACKUP_KEEP:-8}"   # tarballs kept on the host; older ones are removed (the pulled copies are the real backup)

die() { echo "backup-node-data: $*" >&2; exit 1; }

if [ -n "${TET_DATA_DIR:-}" ]; then
  src="$TET_DATA_DIR"
else
  vol="${TET_DATA_VOLUME:-tet-os_tet_core_data}"
  command -v docker >/dev/null || die "no TET_DATA_DIR and no docker to find volume $vol"
  src=$(docker volume inspect -f '{{.Mountpoint}}' "$vol" 2>/dev/null) || die "no Docker volume $vol (set TET_DATA_VOLUME or TET_DATA_DIR)"
fi
[ -d "$src" ] || die "$src is not a directory"
[ -n "$(ls -A "$src")" ] || die "$src is empty: nothing to back up"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
out="$BACKUP_DIR/tet-node-data-$stamp.tar.gz"
tmp="$out.partial"
trap 'rm -f "$tmp"' EXIT

# The database is live, so a file growing while it is read is expected. GNU tar (the host's) exits 1
# for "file changed as we read it": that is a hot copy, not a failure. Any other exit is.
umask 077
if tar --version 2>/dev/null | grep -q GNU; then
  rc=0
  tar --warning=no-file-changed -C "$src" -czf "$tmp" . || rc=$?
  [ "$rc" -le 1 ] || die "tar failed (exit $rc)"
else
  tar -C "$src" -czf "$tmp" . || die "tar failed"
fi
gzip -t "$tmp" || die "the tarball does not read back"
mv "$tmp" "$out"
trap - EXIT

if command -v sha256sum >/dev/null; then sum=$(sha256sum "$out" | awk '{print $1}'); else sum=$(shasum -a 256 "$out" | awk '{print $1}'); fi
printf '%s  %s\n' "$sum" "$(basename "$out")" > "$out.sha256"

# Keep the newest $KEEP on the host.
# shellcheck disable=SC2012  # names are ours and fixed-format
ls -1t "$BACKUP_DIR"/tet-node-data-*.tar.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old" "$old.sha256"; done

echo "$out"
echo "sha256 $sum"
