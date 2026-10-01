#!/bin/bash
# Creates the chat's own settings file on the server by copying the settings the chat needs
# from the CRM's settings file. Values are copied file to file and never shown on screen.
#
#   deploy/make-env.sh                      /opt/crm/.env  ->  <this repository>/.env
#   deploy/make-env.sh /path/to/crm.env     use another source file
#   deploy/make-env.sh --force              replace an existing chat settings file (a dated copy is kept)
#
# Which settings are copied: every name listed in deploy/env.example, plus anything starting with CHAT_.
set -euo pipefail

here="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
target="$here/../.env"
source_file=/opt/crm/.env
force=false
for arg in "$@"; do
  case "$arg" in
    --force) force=true ;;
    *) source_file="$arg" ;;
  esac
done

[ -f "$source_file" ] || { echo "Source settings file not found: $source_file"; exit 1; }
if [ -e "$target" ] || [ -L "$target" ]; then
  $force || { echo "$target already exists. Nothing changed. Use --force to replace it."; exit 1; }
  cp -P "$target" "$target.before-$(date +%Y%m%d-%H%M%S)"
  rm -f "$target"
fi

# The names the chat reads: the ones in env.example, plus any CHAT_ name.
names=$(grep -oE '^[A-Z][A-Z0-9_]*=' "$here/env.example" | tr -d '=' | sort -u)
pattern="^($(echo "$names" | paste -sd'|' -)|CHAT_[A-Z0-9_]*)="

umask 077
{
  echo "# The chat's settings. Created by deploy/make-env.sh on $(date '+%Y-%m-%d %H:%M') from $source_file."
  echo "# The database settings and SESSION_JWT_SECRET must stay the same as the CRM's."
  grep -E "$pattern" "$source_file" || true
} > "$target"
chmod 600 "$target"

copied=$(grep -cE "$pattern" "$target" || true)
echo "Created $target with $copied settings (only the owner can read it)."
missing=""
for name in SESSION_JWT_SECRET DB_HOST DB_NAME DB_USER DB_PASSWORD; do
  grep -qE "^${name}=." "$target" || missing="$missing $name"
done
if [ -n "$missing" ]; then
  echo "WARNING: these required settings were not found in $source_file:$missing"
  exit 1
fi
echo "Names copied: $(grep -oE '^[A-Z][A-Z0-9_]*' "$target" | sort | paste -sd' ' -)"
