#!/usr/bin/env bash
# Wrapper: resolves canonical setup-claude-identity.sh via OPS_DIR env or
# `.ops-anchor` walk-up. Canonical script lives in ~/ops/scripts/.
ops="${OPS_DIR:-}"
if [[ -z "$ops" ]]; then
  d="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
  while [[ "$d" != "/" ]]; do
    [[ -f "$d/ops/.ops-anchor" ]] && { ops="$d/ops"; break; }
    d="$(dirname "$d")"
  done
fi
[[ -n "$ops" && -f "$ops/.ops-anchor" ]] || { echo "error: ops anchor not found; set OPS_DIR or place ops/ above this script" >&2; exit 1; }
exec "$ops/scripts/setup-claude-identity.sh" "$@"
