#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
for key in HUB_URL HUB_WORKER_TOKEN NTFY_TOPIC HUB_TIME_ZONE; do
  if [ -z "${!key:-}" ]; then
    echo "worker setup: $key is not set in the routine's environment" >&2
    exit 1
  fi
done
# bin/hub runs TypeScript through Node's own type stripping, so it needs no npm install but does need Node 22.18 or newer.
if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 22 || (major === 22 && minor >= 18) ? 0 : 1)'; then
  echo "worker setup: bin/hub needs Node 22.18 or newer, found $(node --version)" >&2
  exit 1
fi
# Each later command is a new shell, so the projects file goes where bin/hub looks by default instead of into an export.
if [ -z "${HUB_PROJECTS_FILE:-}" ]; then
  mkdir -p "$HOME/.config/hub"
  cp hub/worker/projects.json "$HOME/.config/hub/projects.json"
fi
bin/hub setup
