#!/usr/bin/env bash
# Starts a private local Supabase for the Ideas Lab on ports +100, so it never collides with other worktrees' default stack.
# Run again after editing supabase/ to refresh the copy, then: supabase db reset --workdir "$WORKDIR" && supabase test db --workdir "$WORKDIR"
set -euo pipefail

[ "$(date +%H%M)" -ge 1745 ] && { echo "refusing to start a local stack after 17:45" >&2; exit 3; }

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WORKDIR="${TMPDIR:-/tmp}"
WORKDIR="${WORKDIR%/}/ideas-lab-supabase"

mkdir -p "$WORKDIR"
rm -rf "$WORKDIR/supabase"
cp -R "$REPO/supabase" "$WORKDIR/supabase"

CONFIG="$WORKDIR/supabase/config.toml"
perl -i -pe 's/^project_id = ".*"/project_id = "ideas-lab"/; s/^(\s*[a-z_]*port\s*=\s*)(\d+)/$1 . ($2 + 100)/e' "$CONFIG"

supabase start --workdir "$WORKDIR"
echo "workdir: $WORKDIR"
echo "status variables (values hidden):"
supabase status -o env --workdir "$WORKDIR" | cut -d= -f1
