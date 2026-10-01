#!/bin/bash
# Rehearses deploy/deploy.sh on a developer PC. Nothing real is installed, built or restarted.
#
#   bash deploy/rehearse.sh
#
# It makes a throwaway "GitHub" repository and a throwaway "server" copy, and puts stand-ins for
# pm2, npm and curl on the PATH that only write down what they were asked to do. Each case pushes
# a change, runs the deploy script, and checks which steps it took.
set -uo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)/deploy.sh"
T=$(mktemp -d)
ORIGIN="$T/origin.git"; WORK="$T/work"; SERVER="$T/server"; BIN="$T/bin"; LOG="$T/calls.log"
mkdir -p "$BIN"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); echo "  ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "  FAIL $1"; }
has()  { if grep -qF -- "$1" "$LOG"; then ok "$2"; else bad "$2 (missing: $1)"; fi; }
hasnt(){ if grep -qF -- "$1" "$LOG"; then bad "$2 (unexpected: $1)"; else ok "$2"; fi; }

cat > "$BIN/pm2" <<'EOF'
#!/bin/bash
echo "pm2 $*" >> "$CALLS_LOG"
if [ "$1" = "describe" ]; then [ -f "$PM2_STATE" ] && exit 0 || exit 1; fi
if [ "$1" = "start" ]; then touch "$PM2_STATE"; fi
if [ "$1" = "delete" ]; then rm -f "$PM2_STATE"; fi
exit 0
EOF
cat > "$BIN/npm" <<'EOF'
#!/bin/bash
echo "npm $* [in $(basename "$(pwd)")]" >> "$CALLS_LOG"
if [ "$1" = "ci" ]; then mkdir -p node_modules; fi
if [ "$1" = "run" ] && [ "$2" = "build" ]; then
  [ -n "${BUILD_FAILS:-}" ] && exit 1
  mkdir -p dist.next && echo "built $(git rev-parse --short HEAD)" > dist.next/index.html
fi
exit 0
EOF
cat > "$BIN/curl" <<'EOF'
#!/bin/bash
echo "curl $*" >> "$CALLS_LOG"
[ -n "${HEALTH_FAILS:-}" ] && exit 7
exit 0
EOF
chmod +x "$BIN"/*
export PATH="$BIN:$PATH" CALLS_LOG="$LOG" PM2_STATE="$T/pm2-running"

git init -q --bare -b main "$ORIGIN"
git clone -q "$ORIGIN" "$WORK" 2>/dev/null
cd "$WORK" && git config user.email t@t && git config user.name t && git config core.autocrlf false
mkdir -p deploy server/src web/src
cp "$SRC" deploy/deploy.sh
echo "module.exports={apps:[]}" > deploy/ecosystem.config.cjs
echo '{}' > server/package.json; echo '{}' > server/package-lock.json; echo 'x' > server/src/a.js
echo '{}' > web/package.json; echo 'x' > web/src/a.ts
printf 'node_modules/\ndist/\ndist.next/\ndist.prev/\n.deployed-commit\n' > .gitignore
git add -A && git commit -q -m first && git push -q origin HEAD:main
git clone -q "$ORIGIN" "$SERVER"
run() { : > "$LOG"; (cd / && bash "$SERVER/deploy/deploy.sh" "$@") > "$T/out.txt" 2>&1; echo $?; }
push() { (cd "$WORK" && git add -A && git commit -q -m "$1" && git push -q origin HEAD:main); }

echo "1. first install (no record yet: installs everything by itself)"
rc=$(run)
[ "$rc" = 0 ] && ok "exit 0" || bad "exit $rc"
has "npm ci --omit=dev --no-audit --no-fund [in server]" "server libraries installed without dev tools"
has "npm ci --no-audit --no-fund [in web]" "web libraries installed"
has "npm run build -- --outDir dist.next [in web]" "web built beside the live folder"
has "pm2 start deploy/ecosystem.config.cjs --only chat-server" "process started from the ecosystem file"
has "pm2 save" "pm2 list saved"
[ -f "$SERVER/web/dist/index.html" ] && ok "dist in place" || bad "dist missing"

echo "2. nothing new"
rc=$(run)
[ "$rc" = 0 ] && ok "exit 0" || bad "exit $rc"
grep -q "Already up to date" "$T/out.txt" && ok "says up to date" || bad "no up-to-date message"
hasnt "pm2 restart" "no restart"

echo "3. web-only change"
echo y > "$WORK/web/src/a.ts"; push web
rc=$(run)
[ "$rc" = 0 ] && ok "exit 0" || bad "exit $rc"
has "npm run build" "web rebuilt"
hasnt "npm ci" "no library install"
hasnt "pm2 restart" "no restart (calls keep running)"
hasnt "pm2 start" "no re-create"
[ -d "$SERVER/web/dist.prev" ] && ok "previous build kept" || bad "no dist.prev"

echo "4. server-only change"
echo y > "$WORK/server/src/a.js"; push server
rc=$(run)
has "pm2 restart chat-server" "restarted"
hasnt "npm run build" "web not rebuilt"
hasnt "npm ci" "no library install"

echo "5. server package change"
echo '{"a":1}' > "$WORK/server/package.json"; push pkg
rc=$(run)
has "npm ci --omit=dev --no-audit --no-fund [in server]" "server libraries reinstalled"
has "pm2 restart chat-server" "restarted"

echo "6. failed web build leaves the live site alone"
echo z > "$WORK/web/src/a.ts"; push web2
before=$(cat "$SERVER/web/dist/index.html")
rc=$(BUILD_FAILS=1 run)
[ "$rc" != 0 ] && ok "exit non-zero ($rc)" || bad "exit 0 on failed build"
[ "$(cat "$SERVER/web/dist/index.html")" = "$before" ] && ok "live build untouched" || bad "live build changed"
hasnt "pm2 restart" "no restart"

echo "7. plain re-run after the failed build picks the change up"
rc=$(run)
has "npm run build" "web rebuilt on the re-run"
[ "$rc" = 0 ] && ok "exit 0" || bad "exit $rc"
[ "$(cat "$SERVER/web/dist/index.html")" != "$before" ] && ok "new build live" || bad "build not replaced"

echo "8. deploy script itself changed: the new one takes over"
(cd "$WORK" && sed -i 's/^APP=chat-server$/APP=chat-server\necho "NEW SCRIPT RUNNING"/' deploy/deploy.sh && echo w > server/src/a.js); push script
rc=$(run)
[ "$rc" = 0 ] && ok "exit 0" || bad "exit $rc"
grep -q "NEW SCRIPT RUNNING" "$T/out.txt" && ok "new script ran" || bad "old script kept running"
has "pm2 restart chat-server" "restart still happened"
[ "$(grep -c '=== pull ===' "$T/out.txt")" = 1 ] && ok "pulled once" || bad "pulled more than once"

echo "9. ecosystem file changed: process re-created"
echo "module.exports={apps:[1]}" > "$WORK/deploy/ecosystem.config.cjs"; push eco
rc=$(run)
has "pm2 delete chat-server" "old process removed"
has "pm2 start deploy/ecosystem.config.cjs --only chat-server" "started from the new file"
has "pm2 save" "saved"

echo "10. uncommitted change on the server stops the deploy"
echo hack >> "$SERVER/server/src/a.js"
rc=$(run)
[ "$rc" = 1 ] && ok "exit 1" || bad "exit $rc"
hasnt "pm2" "nothing touched"
(cd "$SERVER" && git checkout -q -- .)

echo "11. unhealthy after restart"
echo v > "$WORK/server/src/a.js"; push server3
sed -i 's/^HEALTH_WAIT_SECS=30$/HEALTH_WAIT_SECS=2/' "$SERVER/deploy/deploy.sh"
(cd "$SERVER" && git update-index --assume-unchanged deploy/deploy.sh)
rc=$(HEALTH_FAILS=1 run)
[ "$rc" = 1 ] && ok "exit 1" || bad "exit $rc"
has "pm2 logs chat-server --lines 30 --nostream" "shows the log"

echo "12. unhealthy deploy is retried by the next run"
rc=$(run)
[ "$rc" = 0 ] && ok "exit 0" || bad "exit $rc"
has "pm2 restart chat-server" "restart retried"

echo "13. --force with nothing new"
rc=$(run --force)
has "npm ci --omit=dev --no-audit --no-fund [in server]" "server libraries"
has "npm run build" "web rebuilt"
has "pm2 start deploy/ecosystem.config.cjs --only chat-server" "process re-created"

echo "14. make-env.sh: the chat's own settings file"
ENVT="$T/envtest"; mkdir -p "$ENVT/deploy"
cp "$(dirname "$SRC")/make-env.sh" "$(dirname "$SRC")/env.example" "$ENVT/deploy/"
printf 'DB_HOST=h
DB_NAME=n
DB_USER=u
DB_PASSWORD=p=1#x
SESSION_JWT_SECRET=s
CHAT_PORT=5020
CHAT_NEW_THING=1
TWILIO_AUTH_TOKEN=never
MY_DB_PASSWORD=never
' > "$T/crm.env"
bash "$ENVT/deploy/make-env.sh" "$T/crm.env" > "$T/out.txt" 2>&1 && ok "created" || bad "create failed"
grep -q '^DB_PASSWORD=p=1#x$' "$ENVT/.env" && ok "values copied exactly" || bad "value changed"
grep -q '^CHAT_NEW_THING=1$' "$ENVT/.env" && ok "any CHAT_ setting is copied" || bad "CHAT_ setting missing"
grep -q 'never' "$ENVT/.env" && bad "copied a setting the chat does not use" || ok "other settings are left behind"
grep -q 'p=1#x' "$T/out.txt" && bad "printed a value" || ok "no value shown on screen"
bash "$ENVT/deploy/make-env.sh" "$T/crm.env" > /dev/null 2>&1 && bad "overwrote without --force" || ok "refuses to overwrite"
bash "$ENVT/deploy/make-env.sh" "$T/crm.env" --force > /dev/null 2>&1 && ls -a "$ENVT" | grep -q 'env.before-' && ok "--force keeps a dated copy" || bad "--force"
grep -v DB_PASSWORD "$T/crm.env" > "$T/crm2.env"
bash "$ENVT/deploy/make-env.sh" "$T/crm2.env" --force > /dev/null 2>&1 && bad "accepted a file with no database password" || ok "stops when a required setting is missing"

echo; echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ] || { echo "--- last output ---"; cat "$T/out.txt"; echo "--- last calls ---"; cat "$LOG"; }
rm -rf "$T"
exit $FAIL
