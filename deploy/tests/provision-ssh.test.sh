#!/usr/bin/env bash
# The SSH listeners provision-seed.sh and the demo cloud-config set up:
#   1. every port is listed on 0.0.0.0 (IPv4) and [::] (IPv6) — a [::]-only socket refused every
#      IPv4 connection on the demo host;
#   2. ssh.socket is enabled and restarted;
#   3. the listeners are checked per family (IPv4 missing = fatal);
#   4. no nftables/iptables rules are written by either file.
# Negative controls: each check run on a copy with the IPv4 line, the enable, or the IPv4 check
# removed (or a reject rule added) must FAIL.
set -euo pipefail
cd "$(dirname "$0")/../.."
fail=0

# The patterns are literal script text, so single quotes are intended.
# shellcheck disable=SC2016
check_script() { # $1: provision script text
  local s="$1" p=()
  grep -q 'echo "ListenStream=0.0.0.0:$p"' <<<"$s" || p+=("no IPv4 ListenStream")
  grep -q 'echo "ListenStream=\[::\]:$p"' <<<"$s" || p+=("no IPv6 ListenStream")
  grep -q 'systemctl enable ssh.socket' <<<"$s" || p+=("ssh.socket not enabled")
  grep -q 'systemctl restart ssh.socket' <<<"$s" || p+=("ssh.socket not restarted")
  grep -q 'ss -4ltnH "sport = :$p" | grep -q . || die' <<<"$s" || p+=("IPv4 listener not checked (fatal)")
  grep -qE '^\s*(nft|iptables|ip6tables) ' <<<"$s" && p+=("writes firewall rules")
  printf '%s\n' "${p[@]+"${p[@]}"}"
}
check_cloud() { # $1: cloud-config text
  local s="$1" p=()
  for port in 22 8443; do
    grep -q "ListenStream=0.0.0.0:$port" <<<"$s" || p+=("cloud-config: no IPv4 $port")
    grep -q "ListenStream=\[::\]:$port" <<<"$s" || p+=("cloud-config: no IPv6 $port")
  done
  grep -q 'systemctl enable ssh.socket' <<<"$s" || p+=("cloud-config: ssh.socket not enabled")
  grep -qiE 'nft|iptables|reject' <<<"$(grep -v '^#' <<<"$s")" && p+=("cloud-config: firewall rules")
  printf '%s\n' "${p[@]+"${p[@]}"}"
}
expect() { # name, problems, want_fail
  if { [ "$3" = 0 ] && [ -z "$2" ]; } || { [ "$3" = 1 ] && [ -n "$2" ]; }; then echo "ok   $1"; else echo "FAIL $1 ${2//$'\n'/; }"; fail=1; fi
}
S=$(cat deploy/provision-seed.sh)
C=$(cat deploy/demo/cloud-config.yaml)
expect "provision-seed.sh: SSH on IPv4 and IPv6, socket enabled, IPv4 checked" "$(check_script "$S")" 0
expect "cloud-config: SSH on IPv4 and IPv6, socket enabled, no firewall rules" "$(check_cloud "$C")" 0
expect "control: no IPv4 ListenStream FAILS" "$(check_script "$(grep -v 'ListenStream=0.0.0.0' <<<"$S")")" 1
expect "control: socket not enabled FAILS" "$(check_script "$(grep -v 'systemctl enable ssh.socket' <<<"$S")")" 1
expect "control: IPv4 not checked FAILS" "$(check_script "$(grep -v 'ss -4ltnH' <<<"$S")")" 1
expect "control: a reject rule in the script FAILS" "$(check_script "$S"$'\n''  nft add rule inet filter input tcp dport 22 reject')" 1
expect "control: cloud-config without IPv4 FAILS" "$(check_cloud "$(grep -v '0.0.0.0' <<<"$C")")" 1
expect "control: cloud-config with a reject rule FAILS" "$(check_cloud "$C"$'\n''  - nft add rule inet filter input reject')" 1
[ "$fail" = 0 ] && echo "provision ssh: all checks passed"
exit "$fail"
