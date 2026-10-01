# Memory

The running record of this project. **Read this first in every new session**, then `Phases.md`.
Update it after every piece of finished work. Newest entries go at the top of the log.

---

## Where we are right now

| Item | State |
|---|---|
| **Current phase** | Phase 2 finished. Waiting for the owner's "go" for **Phase 3 — reshape the code**. |
| **This repository** | Holds the whole chat system. All tests pass from here. |
| **Live site (chat2)** | Still running from the old place: the `chat-server/` and `chat-ui/` folders inside the CRM repository on the server. Nothing has changed for staff. |
| **Not yet live** | The three call fixes and the colour theme. They are in this code but the server has not been updated since (see "Blockers"). |

## What is in this repository

| Folder | What it is |
|---|---|
| `server/` | The chat server (was `chat-server/` in the CRM repository). |
| `server/migrations/` | The three database files for the `chat` schema. |
| `server/test/` | Automated server tests. |
| `server/dev/local.mjs` | The local test server: the real server with an in-memory database and test people. |
| `server/dev/e2e/` | End-to-end checks: one that talks to the server directly, four that drive real browsers. |
| `web/` | The web app (was `chat-ui/`). |
| `web/test/` | Automated web tests. |

The code is **not yet in the folder structure from `Architecture.md`**. It was moved unchanged on purpose. Reshaping is Phase 3.

## How to run and test (on the developer's PC)

```
# one-time setup
cd server && npm ci
cd ../web && npm ci && npm run build

# automated tests
cd server && npm test                 # 353 tests
cd web && npm test && npx tsc --noEmit   # 107 tests + type check

# local chat in a browser
node server/dev/local.mjs             # http://localhost:5021
# sign in as m@x (Management), a@x, b@x, c@x, dee@x, eli@x or fay@x — password: local

# end-to-end checks (start the local chat first; restart it between scripts for a clean database)
node server/dev/e2e/api-smoke.mjs        # 13 checks
node server/dev/e2e/browser-notify.cjs   # 10 checks
node server/dev/e2e/browser-calls.cjs    # 14 checks
node server/dev/e2e/browser-polish.cjs   # 5 checks
node server/dev/e2e/browser-admin.cjs    # 7 checks
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

- **The developer's PC cannot reach the server on the office network** (since 1 Oct, morning). The public sites work. Until this is back, nothing can be deployed from this PC. Phase 4 needs it.
- **Router port forwarding** for calls from outside the office is with the server team (ports 3478 UDP+TCP and 49160–49200 UDP to 192.168.1.58).

## Things to know before changing code

- **Sign-in depends on the CRM.** The server forwards the email and password to the CRM and trusts its token. The shared secret and database settings come from an environment file, never from this repository.
- **`users.role` is a special database type.** Compare it with text only after casting (`u.role::text`). Forgetting this breaks every request on the real database. The tests use the same type, so they catch it.
- **The permission "Team chat (beta)"** is defined in the CRM's own database files, not here. Chat only reads it.
- **Calls are held in the server's memory** as well as the database. Run only one server process.
- **A call belongs to one browser tab per person.** Requests carry that tab's connection id.
- **Dependencies added, with reasons:**
  - `playwright-core` (server, development only) — drives the real-browser checks using the installed Edge. No browser download.

## Known small issues (also listed in `Phases.md`)

- Accepting the same call in two tabs at once can make both drop out.
- Any change in a call redraws the whole message list.
- Signing out during a call is tidied up by the server after 10 seconds, not at once.
- A new restriction does not remove two people from a private channel they already share.
- The search button is reported not working on the live site (Phase 5).

---

## Log

### 1 Oct 2026 — Phase 2: code moved here ✅
- Copied from the CRM repository (`CRM-Finalised`, main at `aad009b9`): `chat-server/` → `server/`, `chat-ui/` → `web/`, and the three `chat_00x` database files → `server/migrations/`.
- Only file paths were changed, so the code finds the renamed folders. No behaviour changed.
- Added `.gitignore` and the `playwright-core` development dependency.
- **Verified from this repository:** server tests 353/353, web tests 107/107, type check clean, build succeeds, end-to-end 13/13, browser checks 10/10, 14/14, 5/5 and 7/7 with no browser errors.
- The history of earlier commits stays in the CRM repository; it was not copied.

### 1 Oct 2026 — Phase 1: project documents ✅
- Wrote `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`. Approved by the owner.

### 28 Sep – 1 Oct 2026 — built inside the CRM repository
- Text chat, rich messaging, access switch and restrictions, presence and notifications, voice calls and screen sharing, admin panel, interface improvements, three call fixes and the colour theme. Details in `Phases.md` under "Already done".
