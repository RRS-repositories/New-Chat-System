# Memory

The running record of this project. **Read this first in every new session**, then `Phases.md`.
Update it after every piece of finished work. Newest entries go at the top of the log.

---

## Where we are right now

| Item | State |
|---|---|
| **Current phase** | **Phase 4 — switch the server to this repository**, in progress. Steps 1 and 2 of 4 are done: **chat2 now runs from this repository** (`/opt/chat`). Waiting for: the owner to check chat2; CRM clean-up part 1 (pull request #619) to merge and reach the server; then part 2. The steps are listed in `Phases.md`. |
| **This repository** | Holds the whole chat system, in the folder structure from `Architecture.md`. All tests pass from here. |
| **Live site (chat2)** | Runs from `/opt/chat` (this repository) since 1 Oct 2026. Deploy with `/opt/chat/deploy/deploy.sh`. The old `chat-server/` and `chat-ui/` folders are still in `/opt/crm` until the CRM clean-up is finished; nothing uses them. |

## Where things are

### Server (`server/`)

| Folder | What is in it |
|---|---|
| `main.js` | Starts the server. |
| `src/app.js`, `src/server.js` | Wire the pieces together (which routes exist, in what order). |
| `src/config/` | Reads the environment settings. The only place that does. |
| `src/routes/` | One file per area. Each line maps an address to a controller. No logic. |
| `src/controllers/` | One file per area. Reads the request, calls services or models, sends the reply. |
| `src/services/` | The rules: who may post, who may share a channel, access changes, calls, notifications, presence, digest, file storage, sign-in forwarding, session check. |
| `src/models/` | Every database query. One file per table or topic. **No query lives anywhere else.** |
| `src/middleware/` | Sign-in check, Management-only check, the one error handler, rate limits. |
| `src/sockets/` | Live events: presence, typing, read receipts, call signalling. |
| `src/utils/` | Small pure helpers: ids, file names, validators, mention parsing, message cleaning. |
| `migrations/` | The three database files for the `chat` schema, and `apply.mjs`, which applies them (dry run unless `--commit`). |
| `test/` | Automated tests. |
| `dev/local.mjs`, `dev/e2e/` | The local test server and the end-to-end and browser checks. |

### Deploy (`deploy/`)

| File | What it is |
|---|---|
| `deploy.sh` | The deploy script for the server. Pulls `main`, does only what the change needs, checks the chat answers. |
| `ecosystem.config.cjs` | The pm2 settings for the `chat-server` process. |
| `SERVER.md` | Where everything is on the server, how to deploy, how to apply database changes, how to install on a new server. |
| `rehearse.sh` | Tests `deploy.sh` and `make-env.sh` on a developer PC with stand-ins for pm2, npm and curl. |
| `env.example` | Every setting name the chat reads. No values. |
| `make-env.sh` | Builds the chat's own settings file on the server from the CRM's. |

### Web app (`web/src/`)

| Folder | What is in it |
|---|---|
| `main.tsx`, `App.tsx` | Start-up, sign-in gate, the list of pages. |
| `pages/` | Whole screens: sign-in, chat, admin people, one person's access, restrictions, direct-message redirect. |
| `components/` | Reusable pieces, grouped by area: `layout/`, `channel/`, `messages/`, `dialogs/`, `calls/`, `admin/`, `common/`. |
| `context/` | Shared state: chat (`ChatProvider`, `chatContext`, `chatReducer`), calls (`CallProvider`, `callContext`, `callState`), sign-out. |
| `hooks/` | Reusable screen logic. `hooks/actions/` holds the chat actions, grouped: channels, reading, writing, people. |
| `services/` | **Every call to the server**: `chatApi`, `callApi`, `authApi`, `apiClient`, `socket`, `push`, plus `callManager` (the browser-to-browser call engine), `media`, `session`. |
| `utils/` | Pure helpers: formatting, mentions, notification rules, presence, access, sound. |
| `types/` | Shared TypeScript types. |
| `config/` | Constants and the app's addresses (`routes.ts`). |
| `styles/` | CSS, one file per area. `tokens.css` holds every colour and size. `theme.css` is applied last. |

**Rule kept everywhere:** screens and hooks never call the server directly. They go through `services/`.

## How to run and test (on the developer's PC)

```
# one-time setup
cd server && npm ci
cd ../web && npm ci && npm run build

# automated tests
cd server && npm test                    # 368 tests
cd web && npm test && npx tsc --noEmit   # 107 tests + type check

# local chat in a browser
node server/dev/local.mjs                # http://localhost:5021
# sign in as m@x (Management), a@x, b@x, c@x, dee@x, eli@x or fay@x — password: local

# end-to-end checks (start the local chat first; restart it between scripts for a clean database)
node server/dev/e2e/api-smoke.mjs        # 13 checks
node server/dev/e2e/browser-notify.cjs   # 10 checks
node server/dev/e2e/browser-calls.cjs    # 14 checks
node server/dev/e2e/browser-polish.cjs   # 5 checks
node server/dev/e2e/browser-admin.cjs    # 7 checks

# the deploy script, rehearsed with stand-ins (nothing real is installed or restarted)
bash deploy/rehearse.sh                  # 51 checks

# formatting (settings in .prettierrc.json; run from the repository root)
npx prettier@3 --write "server/**/*.{js,mjs,cjs}" "web/src/**/*.{ts,tsx,css}" "web/test/**/*.ts"
```

The browser checks use the Microsoft Edge already installed on the PC.

## Decisions the owner has made

| Date | Decision |
|---|---|
| 30 Sep 2026 | Chat lives only on chat2. Not inside the CRM until the owner says it is finished. The CRM keeps Mattermost. |
| 30 Sep 2026 | No paid services. Self-hosted or free only. |
| 30 Sep 2026 | Test locally before anything goes to the server. |
| 30 Sep 2026 | Calls must be minimal, lightweight and decentralised. |
| 30 Sep 2026 | Keep the working process light; no long multi-agent pipelines. |
| 1 Oct 2026 | No camera video. |
| 1 Oct 2026 | CRM mount, Mattermost history import and phone install: later, on the owner's word. |
| 1 Oct 2026 | The chat gets its own repository (this one), run by `rules.txt`. |
| 1 Oct 2026 | Project documents approved. Phase order approved (reshape before the three new items). |
| 1 Oct 2026 | The GitHub repository stays public. |
| 1 Oct 2026 | The chat gets its own separate settings file on the server (not a link to the CRM's). |
| 1 Oct 2026 | Call host controls: a disconnected person can join back freely; a person the host removed sends a join request that the host accepts or refuses. |

## Blockers

- **Router port forwarding** for calls from outside the office is with the server team (ports 3478 UDP+TCP and 49160–49200 UDP to 192.168.1.58).

## Things to know before changing code

- **Sign-in depends on the CRM.** The server forwards the email and password to the CRM and trusts its token. The shared secret and database settings come from an environment file, never from this repository.
- **`users.role` is a special database type.** Compare it with text only after casting (`u.role::text`). Forgetting this breaks every request on the real database. The tests use the same type, so they catch it.
- **The permission "Team chat (beta)"** is defined in the CRM's own database files, not here. Chat only reads it.
- **Calls are held in the server's memory** as well as the database. Run only one server process.
- **A call belongs to one browser tab per person.** Requests carry that tab's connection id.
- **The GitHub repository is public.** Anyone can read the code and these documents. Nothing secret is in it, and it must stay that way.
- **The chat has its own settings file on the server** (`/opt/chat/.env`, made by `deploy/make-env.sh`). The database settings and `SESSION_JWT_SECRET` in it must stay the same as the CRM's. See `deploy/SERVER.md`.
- **The `Tasks/` folder is not in git** (the repository is public and the notes there can describe security gaps). It lives only on the developer's PC.
- **A web-only deploy does not restart the chat**, so calls are not cut. A server-code deploy restarts it (a few seconds).
- **The CRM's `deploy.sh --all` restarts every pm2 process, chat included.**
- **Sign-in for a request goes through `sessionUser`** (`services/session.service.js`), not `loadSessionUser` directly: it applies the IP restriction and removes the list before the person is passed on.
- **A new allowed upload type needs a content check** in `utils/fileSignature.js`; a test fails if the two lists differ.
- **Tests build small apps from the route files** (`createXRoutes({ db, emit, … })`). Keep that factory shape: routes take their dependencies as arguments.
- **Dependencies added, with reasons:**
  - `playwright-core` (server, development only) — drives the real-browser checks using the installed Edge. No browser download.
  - Prettier is run with `npx` and is not installed in the project.

## Files that are still long, and why

These were left whole on purpose. Splitting them would mean passing a lot of shared state around, which is harder to follow than one focused file.

| File | Lines | Why it stays in one piece |
|---|---|---|
| `web/src/services/callManager.ts` | ~725 | One class that runs the browser-to-browser connections. Covered by 21 unit tests and the browser call checks. |
| `server/src/services/calls/call.service.js` | ~495 | The call lifecycle on the server, built around one set of timers and locks. Covered by the call service tests. |
| `web/src/context/chatReducer.ts` | ~394 | One pure function: every way the chat state can change. |
| `web/src/context/CallProvider.tsx` | ~311 | Start, join and leave share the same handful of working values. |

## Known small issues (also listed in `Phases.md`)

- Accepting the same call in two tabs at once can make both drop out.
- Any change in a call redraws the whole message list.
- Signing out during a call is tidied up by the server after 10 seconds, not at once.
- A new restriction does not remove two people from a private channel they already share.
- The search button is reported not working on the live site (Phase 5).
- `addRestriction` in `models/restrictions.model.js` still checks its own input. Moving those checks into `services/access.service.js` would complete the split.

---

## Log

### 1 Oct 2026 — technical reference written ✅
- The owner asked for one file describing everything implemented, with the technical detail. It is `IMPLEMENTATION.md` at the top of the repository.
- It covers: what is live and what is waiting, how the pieces fit, libraries and versions, folder layout, sign-in and access, every database table, every address, every live event, each feature, the web app, security, limits, settings, running it, tests, known issues, history.
- Every figure in it was checked against the code and the server on the day it was written. Anything merged in pull request #9 but not yet deployed is marked.
- **Keep it up to date:** when a feature, address, table, limit or setting changes, change that file in the same pull request.
- It holds no secret and no server address beyond what `deploy/SERVER.md` already has (the repository is public).

### 1 Oct 2026 — security items from the checklist review ✅ (not deployed yet)
The owner gave a security checklist (kept in `Tasks/`, which is not in git). Checked against the chat, four gaps applied to it. All four are fixed in one pull request:
- **Per-person IP restriction.** A manager can limit a person to certain addresses in the CRM. The CRM now enforces that, and the chat does too: on every request, when a live connection starts, and at the once-a-minute re-check. Nobody has a restriction saved today, so nobody is affected until a manager sets one. Switch: `IP_RESTRICTION_ENFORCE=false` in the chat's settings file only logs what would be refused.
- **Uploads are checked by content.** A file must begin the way its type does (a real JPEG, PDF, Word file and so on). A program renamed to `photo.jpg` is refused with "the file's content does not match its type".
- **Security headers on every response**, including a content policy: only our own scripts, our own API and live connection; nothing may frame the chat; camera and location off; microphone and screen capture allowed for this site only (calls need them).
- **A general limit** of 600 requests a minute per person, on top of the tighter limits on sending messages and uploading.
- **Mail library** upgraded to version 10 (the old one had a known high-severity issue; it is only used by the optional digest email, which is off). `npm audit` now reports 0 issues.
- Where: `server/src/utils/ipRestriction.js`, `utils/fileSignature.js`, `middleware/securityHeaders.js`, `services/session.service.js` (`sessionUser`), `middleware/auth.js`, `sockets/index.js`, `services/files/upload.service.js`, `app.js`, `config/index.js`. Tests: `server/test/security.test.js` (15).
- Checked: server tests 368 of 368; web build; end-to-end 13 of 13; browser checks 10, 14, 5 and 7 (the content policy did not break calls, screen share, notifications or the admin panel).
- **Dependency changed, with reason:** `nodemailer` 6 → 10 (security fix).

### 1 Oct 2026 — Phase 4, step 2: the server now runs the chat from this repository ✅
- Put the repository in `/opt/chat`, created the chat's own settings file with `deploy/make-env.sh` (22 settings copied, none shown), installed the libraries and built the web app there at low priority. The live chat was not touched during this.
- Checked before switching: the new code loads, reads its settings and reaches the database; nobody was on a call.
- Switched at 11:48: the old process was stopped and the new one started. Healthy after 2 seconds. The pm2 list was saved, so a server restart brings back the new one.
- Checked after: health answers, the page and the notification worker are served, an unsigned request is refused, the public address serves the new build, the error log is clean, and the real `deploy.sh` ran once ("Already up to date").
- **Way back, if ever needed** (until the CRM clean-up part 2): `pm2 delete chat-server`, then `cd /opt/crm && pm2 start chat-server/main.js --name chat-server`, then `pm2 save`.
- CRM clean-up part 1 opened as pull request #619 in `CRM-Finalised`. Part 2 stays unmerged until part 1 is on the server and the owner has checked chat2.
- **Owner still to check:** sign in on chat2, send a message, open a file, make a call.

### 1 Oct 2026 — own settings file; security checklist checked
- **Own settings file (owner's decision):** added `deploy/env.example` (names only) and `deploy/make-env.sh`, which builds `/opt/chat/.env` on the server from the CRM's file, copying only what the chat needs and never showing values. `deploy/SERVER.md` updated. The rehearsal now has 51 checks.
- **Security checklist:** the owner gave `Tasks/FAC-Security-Implementation-Checklist (1).md` (about 300 items, written for the CRM). Checked against the CRM code and, where it applies, the chat. Result: `Tasks/FAC-Security-Checklist-RESULT.md`. Most items are not implemented in the CRM; the chat does well on the items that apply to it, apart from what it inherits from the CRM's sign-in (no MFA, short passwords, 7-day sessions). No code was changed for this.
- `Tasks/` added to `.gitignore`.

### 1 Oct 2026 — Phase 4, step 1: deploy files ✅ (switch on the server still to do)
- Added `deploy/deploy.sh`, `deploy/ecosystem.config.cjs`, `deploy/SERVER.md`, `deploy/rehearse.sh` and `server/migrations/apply.mjs`.
- The deploy script does only what a change needs: a web-only change is rebuilt without a restart; a failed web build never replaces the working one; a deploy that fails is picked up by the next run; a changed deploy script hands over to its new version.
- Rehearsed locally: 43 of 43 checks. The real web build into a side folder was also tried. Server tests 353 of 353.
- The default address in the mention-digest email now points at chat2 (it still pointed at the removed CRM page). The digest is off, so nothing visible changed.
- **Not done yet:** the switch itself. The server did not answer from the developer's PC (network), so nothing on the server was touched.
- **CRM repository clean-up is prepared but not merged.** Two branches are pushed to `CRM-Finalised`, with no pull request yet:
  - `chore/chat-moved-out-1-deploy-hook` — removes the chat step from the CRM's `deploy.sh` and the chat process from its `ecosystem.config.cjs`. Merge only **after** the switch works (until then the old process is the way back).
  - `chore/chat-moved-out-2-remove-folders` — built on the first; deletes `chat-server/`, `chat-ui/`, the three chat database files and the old apply script, and updates two CRM tests. Merge only after part 1 is on the server and the owner has checked chat2.
- The scripts for the switch are written: one prepares `/opt/chat` without touching the live chat; one swaps the process and goes back to the old one by itself if the new one does not answer within 30 seconds.

### 1 Oct 2026 — Phase 3: code reshaped to the rules ✅
- **Server:** every route file is now a short list of addresses. Request handling moved to `controllers/`, the rules to `services/`, and all database queries to `models/`. Sign-in checking is in `middleware/`. Shared helpers are in `utils/`.
- **Web app:** screens are in `pages/`; components are grouped by area; the large chat state file was split into server calls (`services/chatApi.ts`), read-tracking, live events and four small action files; the call state file was split the same way; sign-in goes through a service. No screen or hook calls the server directly any more.
- **Styles:** the single long CSS file became eleven files, one per area, with all colours and sizes in `tokens.css`.
- **Removed:** the leftover CRM-embedding setting (`basePath`), three unused variables, and the last direct server calls in screens.
- **Formatting:** all code formatted with Prettier (settings in `.prettierrc.json`); line endings fixed to LF (`.gitattributes`).
- **Behaviour did not change.** Verified after the reshaping: server tests 353/353, web tests 107/107, strict type check clean, build succeeds, end-to-end 13/13, browser checks 10/10, 14/14, 5/5 and 7/7 with no browser errors, and a before/after screenshot comparison.

### 1 Oct 2026 — call fixes and colour theme deployed ✅
- The connection from the developer's PC to the server came back. Deployed from the CRM repository (still the live source until Phase 4): the three call fixes and the colour theme are now live on chat2.
- Checked after deploy: chat service healthy, CRM up, new theme being served, relay running.
- That deploy also carried five unrelated CRM changes other people had merged, because chat still deploys through the CRM's script. Phase 4 ends that.

### 1 Oct 2026 — Phase 2: code moved here ✅
- Copied from the CRM repository (`CRM-Finalised`, main at `aad009b9`): `chat-server/` → `server/`, `chat-ui/` → `web/`, and the three `chat_00x` database files → `server/migrations/`.
- Only file paths were changed, so the code finds the renamed folders. No behaviour changed.
- Added `.gitignore` and the `playwright-core` development dependency.
- The history of earlier commits stays in the CRM repository; it was not copied.

### 1 Oct 2026 — Phase 1: project documents ✅
- Wrote `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`. Approved by the owner.

### 28 Sep – 1 Oct 2026 — built inside the CRM repository
- Text chat, rich messaging, access switch and restrictions, presence and notifications, voice calls and screen sharing, admin panel, interface improvements, three call fixes and the colour theme. Details in `Phases.md` under "Already done".
