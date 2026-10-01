# Memory

The running record of this project. **Read this first in every new session**, then `Phases.md`.
Update it after every piece of finished work. Newest entries go at the top of the log.

---

## Where we are right now

| Item | State |
|---|---|
| **Current phase** | **Phase 4 — switch the server to this repository**, in progress (owner said "go" on 1 Oct 2026). Step 1 of 4 done: the deploy files are written and rehearsed. Step 2 (the switch on the server) is waiting: the server could not be reached from the developer's PC. The steps are listed in `Phases.md`. |
| **This repository** | Holds the whole chat system, in the folder structure from `Architecture.md`. All tests pass from here. |
| **Live site (chat2)** | Still running from the old place: the `chat-server/` and `chat-ui/` folders inside the CRM repository on the server. It has the same features as this repository, in the old file layout. |

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
| `rehearse.sh` | Tests `deploy.sh` on a developer PC with stand-ins for pm2, npm and curl. |

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
cd server && npm test                    # 353 tests
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
bash deploy/rehearse.sh                  # 43 checks

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
- **On the server the settings file is shared with the CRM** (`/opt/chat/.env` is a link to `/opt/crm/.env`), because chat uses the CRM's sign-in and database. See `deploy/SERVER.md`.
- **A web-only deploy does not restart the chat**, so calls are not cut. A server-code deploy restarts it (a few seconds).
- **The CRM's `deploy.sh --all` restarts every pm2 process, chat included.**
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
