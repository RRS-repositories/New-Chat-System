#!/bin/bash
# Deploys the chat on the server. Run it from anywhere:
#
#   /opt/chat/deploy/deploy.sh           pull main and apply what changed
#   /opt/chat/deploy/deploy.sh --force   install, build and restart everything (repair)
#
# The first run on a new server installs everything by itself.
#
# What it does, in order:
#   1. pulls the main branch
#   2. installs server libraries, only if the server's package files changed
#   3. rebuilds the web app, only if the web app changed (the old build stays live until the new one is ready)
#   4. restarts the chat process, only if server code changed (a web-only change needs no restart, so calls are not cut)
#   5. checks the chat answers; exits with an error if it does not
#
# If a step fails, fix the cause and run it again: it carries on from the last deploy that finished.
#
# It never touches the CRM. Database changes are not applied here: see deploy/SERVER.md.
set -euo pipefail

APP=chat-server
DEPLOYED_MARK=.deployed-commit # the commit of the last deploy that finished (not in git)
HEALTH_WAIT_SECS=30

# Everything lives in main() so the whole script is read before it runs: `git pull` may replace this file.
main() {
  local force=false resumed=false before after
  while [ $# -gt 0 ]; do
    case "$1" in
      --force) force=true ;;
      --resumed) resumed=true ;; # used by this script itself, after a pull that changed it
      *) echo "Unknown option: $1"; exit 2 ;;
    esac
    shift
  done

  cd "$(dirname "$(readlink -f "$0")")/.."

  if ! $resumed; then
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      echo "There are uncommitted changes in $(pwd). Deploy stopped; nothing was changed."
      exit 1
    fi
    echo "=== pull ==="
    before=$(git rev-parse HEAD)
    git pull --ff-only
    # A newer deploy script takes over from here, so the steps below always match the code just pulled.
    if git diff --name-only "$before" HEAD | grep -qx 'deploy/deploy.sh'; then
      echo "=== deploy script changed: continuing with the new one ==="
      if $force; then exec bash deploy/deploy.sh --resumed --force; fi
      exec bash deploy/deploy.sh --resumed
    fi
  fi

  # Compare against the last deploy that finished, not the last pull: if a deploy fails half way,
  # the next run picks up everything that is still waiting.
  after=$(git rev-parse HEAD)
  before=$(cat "$DEPLOYED_MARK" 2>/dev/null || true)
  if ! git cat-file -e "${before:-none}^{commit}" 2>/dev/null; then
    echo "No record of an earlier deploy here: installing everything."
    force=true
    before=$after
  fi

  changed() { git diff --name-only "$before" "$after" | grep -qE "$1"; }

  if [ "$before" = "$after" ] && ! $force; then
    echo "Already up to date. Nothing to do."
    exit 0
  fi

  echo "=== changed files ==="
  git diff --name-only "$before" "$after"

  if $force || [ ! -d server/node_modules ] || changed '^server/package(-lock)?\.json$'; then
    echo "=== server: install libraries ==="
    (cd server && npm ci --omit=dev --no-audit --no-fund)
  fi

  if $force || [ ! -d web/dist ] || changed '^web/'; then
    if $force || [ ! -d web/node_modules ] || changed '^web/package(-lock)?\.json$'; then
      echo "=== web: install libraries ==="
      (cd web && npm ci --no-audit --no-fund)
    fi
    echo "=== web: build ==="
    # Build beside the live folder, then swap, so a failed build leaves the live site as it was.
    (
      cd web
      rm -rf dist.next
      npm run build -- --outDir dist.next
      rm -rf dist.prev
      if [ -d dist ]; then mv dist dist.prev; fi
      mv dist.next dist
    )
  fi

  if $force || changed '^deploy/ecosystem\.config\.cjs$' || ! pm2 describe "$APP" >/dev/null 2>&1; then
    echo "=== start the chat process from deploy/ecosystem.config.cjs ==="
    pm2 delete "$APP" >/dev/null 2>&1 || true
    pm2 start deploy/ecosystem.config.cjs --only "$APP"
    pm2 save
  elif changed '^server/'; then
    echo "=== restart the chat process ==="
    pm2 restart "$APP"
  else
    echo "=== no server change: the chat process keeps running ==="
  fi

  echo "=== health check ==="
  local url="http://127.0.0.1:${CHAT_PORT:-5020}/health" waited=0
  until curl -fsS -m 3 "$url" >/dev/null 2>&1; do
    waited=$((waited + 1))
    if [ "$waited" -ge "$HEALTH_WAIT_SECS" ]; then
      echo "The chat did not answer on $url after ${HEALTH_WAIT_SECS}s. Last log lines:"
      pm2 logs "$APP" --lines 30 --nostream || true
      exit 1
    fi
    sleep 1
  done
  echo "$after" > "$DEPLOYED_MARK"
  echo "Chat is healthy. Deployed $(git rev-parse --short HEAD) at $(date)."
}

main "$@"
