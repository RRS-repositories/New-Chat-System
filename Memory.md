# Memory

The running record of this project. **Read this first in every new session**, then `Phases.md`.
Update it after every piece of finished work. Newest entries go at the top of the log.

---

## Where we are right now

| Item | State |
|---|---|
| **Current phase** | **Phase 9 — the new design and call features from the owner's `Updates/` file**: all ten sections built, then **deployed to chat2 on 5 Oct 2026, 16:56** on the owner's word ("push on prod"). Waiting for the owner to try it on chat2 and on real phones. Before it: Phase 8 (the CRM's automatic messages) needs his decisions; Phase 4 has one step left; Phase 6 waits for the router rules. |
| **Waiting to be deployed** | Nothing. chat2 runs commit `fb53320` (deployed 6 Oct 2026, ~15:00: person card, notification nudge, sidebar menu + Favourites, calls up to 50). All seven database files are applied. The Set password button works once CRM pull request #734 is merged and deployed. |
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
| `migrations/` | The four database files for the `chat` schema, and `apply.mjs`, which applies them (dry run unless `--commit`). |
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
node server/dev/e2e/browser-host.cjs     # 16 checks: search, own-screen preview, call host controls
node server/dev/e2e/browser-features.cjs # 12 checks: links, formatting, channel rename/leave/archive
node server/dev/e2e/browser-real-share.cjs  # a call sharing the PC's real screen (opens a window)

# Speed with heavy data (start the local chat with SEED_HEAVY=1 first; loading takes about 20 seconds):
#   SEED_HEAVY=1 node server/dev/local.mjs
node server/dev/e2e/browser-perf.cjs     # 31 measurements, each with a limit

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
| 1 Oct 2026 | Work in this repository goes straight to `main`: no branch, no pull request. Only the owner and the developer work here. Other repositories are unchanged. |
| 1 Oct 2026 | **The chat must stay lightweight and lag-free**, however long the channels get and however large the files. Measure with heavy data before saying something is fast. |
| 1 Oct 2026 | To add: calls from outside the office, the CRM's automatic messages, clickable links, channel housekeeping, simple formatting. **Not** to add: "seen" marks, a mute-everyone button or host handover, an audit screen, Mattermost history import, install as an app, dark mode. |
| 5 Oct 2026 | **The `Updates/` file is the plan**: build all ten sections exactly as written. This reverses two choices of 1 Oct: dark mode is now wanted, and so is a stand-in host. Deploys restart the chat and end live calls, so the owner deploys off-hours; the developer does not deploy this by itself. |

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
| `server/src/services/calls/call.service.js` | ~521 | The call lifecycle on the server, built around one set of timers and locks. Covered by the call service tests. |
| `web/src/context/chatReducer.ts` | ~467 | One pure function: every way the chat state can change. |
| `web/src/context/CallProvider.tsx` | ~394 | Start, join and leave share the same handful of working values. |

## Known small issues (also listed in `Phases.md`)

- Accepting the same call in two tabs at once can make both drop out.
- Signing out during a call is tidied up by the server after 10 seconds, not at once.
- A new restriction does not remove two people from a private channel they already share.
- `addRestriction` in `models/restrictions.model.js` still checks its own input. Moving those checks into `services/access.service.js` would complete the split.

---

## Log

### 6 Oct 2026, ~15:00 — person card; notifications nudge
The owner got no notification in another tab/app: nobody on chat2 had granted the browser permission or subscribed to push (0 subscriptions), and the default level is Mentions and direct messages. Now a line above the messages asks to turn notifications on (push when the server has a key; Not now = a week). Clicking a name or photo opens a person card (photo, role, presence, status, Message). Deployed.

### 6 Oct 2026, afternoon — sidebar menu and Favourites; calls up to 50
Asked for after Mattermost's channel menu: every conversation row has a ⋯ menu (also on right click) with Open in new window, Mark as unread, Add to favourites, Mute, Copy link, Add people, Leave channel; favourites sit in their own section at the top (database file `chat_007_favourites.sql`). The call limit went from 8 to 50 (mesh audio will strain well before that). Both deployed.

### 6 Oct 2026, 13:45 — big remote calls: the TURN relay had only 41 ports
A 13-person call with everyone outside the office left half of them on "connecting". Cause: the call is a full mesh (156 connections for 13 people), most of them relayed, and coturn's relay range was 49160–49200 (41 ports), all in use. Fixed on the server on the owner's word: `/etc/turnserver.conf` min-port 49160, max-port 51200, total-quota 1200, user-quota 64 (backup `/etc/turnserver.conf.bak-20261006`); ufw opened 49160:51200/udp; coturn restarted. **Still needed from the router team: forward UDP 49160–51200 to 192.168.1.58** (only 3478 and 49160–49200 are forwarded today); until then remote calls still have only 41 relay ports. Call limit raised to 50 the same day; mesh audio will strain past 15–20 people regardless.

### 6 Oct 2026, afternoon — CRM accounts for the Mattermost people; chat open to all CRM staff
The owner could not sign in as bradforbes24@gmail.com: that address had a Mattermost account only, and the chat signs in through the CRM. On his word ("yes go"; chat only, no CRM for these people): **41 CRM accounts** were created for the Mattermost people who had none (role Admin, approved, active, `chat.beta` as their only permission, `mattermost_user_id` set), each carrying their Mattermost PBKDF2 password hash; the owner's own account got the password he chose. The Nova automation was left out. `CHAT_REQUIRE_BETA=false` was set on chat2 (every approved, active CRM person may use the chat). The copy was run again for the new people.
- **Still needed in the CRM (not done — the developer's tooling refused the change as a sign-in weakening; the owner must allow it or do it):** accept Mattermost's `$pbkdf2$` hashes at sign-in and replace them with bcrypt on first success (until then the 40 carried-over passwords do not work; a reset link from the CRM is the workaround), and refuse accounts whose only permission is `chat.beta` at the CRM's own sign-in page unless the request carries `X-Login-For: chat` (the chat's forwarder now sends it). Both belong on CRM pull request #734.
- A locked sign-in is cleared in the CRM: Admin Panel (/management) → Locked Sign-ins → Unlock.

### 6 Oct 2026, 11:31 — faster start deployed
The owner found a refresh slow to show the conversations. Measured: the server answers the list in under 25 ms; the browser was fetching it only once the live connection was up (slow through the proxy). Now the list and the open conversation load at once over HTTP, the admin screens / whiteboard / breakout groups / add-to-call load when first used, and built files are cached for good. Create a channel got a people search. Deployed at 11:31 with no call live.

### 6 Oct 2026 — Add people, the signed-in rule, passwords set by Management or IT, and the Mattermost copy
The owner asked for four things and answered the copy questions (people with CRM accounts only; direct messages yes, groups later; no bot messages; skip large files; copy now).
- **Add people** to an existing channel from its details panel (the server already allowed it; the button was missing).
- **Signed-in rule:** only people who have signed in to the chat at least once are offered when picking someone (new message, new channel, add people, add to call). Admin > People shows when each person last used the chat, or Never signed in.
- **Set password:** Management or IT open Admin > People (IT see no restrictions) and set a person's password from their page. The chat forwards to the CRM's new `PUT /api/users/:id/password` (CRM pull request #734, awaiting the owner's merge); until that is live the button says the CRM does not offer it yet.
- **Mattermost copy:** `server/dev/import-mattermost.mjs` (rules in `server/dev/import/mattermost.js`, database file `chat_006_import_map.sql`). Dry run on the server: 78 people matched (42 who signed in to Mattermost have no CRM account), 45 channels, 416 one-to-one conversations, 158,510 messages, 5,183 files, 8,516 reactions; 70,941 messages left out (bots and people without accounts). The real copy was run the same day; **Result of the real copy (6 Oct 2026, 208 s, chat kept running):** 158,520 messages, 43 new channels (Town Square into General, 2 names already here reused), 416 one-to-one conversations, 3,958 files (1,495 left out: 268 over the limit or of other types, and about 1,200 that Mattermost lists but no longer has on disk), 8,516 reactions, 2,128 thread replies. Copied conversations start as read. People see the new channels after a reload. The staged Mattermost files stay in `/opt/chat-import/files` on the server for a later copy of group conversations; the Mattermost connection file was removed.
- Deployed at 11:11 the same day (no call was live), together with the presenter's-view change.

### 5 Oct 2026 (evening) — whiteboard: host only, move and zoom; clearer presence dots (built, **not deployed yet**)
The owner tried the board on chat2 and asked for: Ctrl + click/drag, zoom in and out, more room to write further down, and only the host able to use the board; and said that in dark mode he could not tell who is online.
- Whiteboard: only the host draws (the server refuses others); the board is larger than the screen; Ctrl + drag, the hand tool or scrolling moves it; Ctrl + scroll or the buttons zoom; everyone's view follows the host's. "Ctrl click" was read as the same gesture as Ctrl + drag.
- Presence dots in the sidebar are larger and bright (green online, amber away, a hollow ring offline), and offline names are a little fainter. Same colours on dark panels.
- Checked: server 480, web 178, browser-board 9/9. Waiting for the owner's word to deploy (he may be in a test call on chat2).

### 5 Oct 2026, 16:56 — Phase 9 deployed to chat2 ✅
The owner compared the build with the prototype and found differences; Settings order and Compact messages, "joined the call" toasts, the hang-up icon, thread reply avatars and click-through toasts were fixed (commit `df7475f`). He then said "push on prod". No call was live and nobody had posted for ten minutes. `chat_005_theme_avatars.sql` was applied first, then `deploy/deploy.sh`; the health check passed and the public site answers. Not yet compared side by side with the prototype: search box, right-hand panels, whiteboard, breakout panel, incoming-call card, phone layout.

### 5 Oct 2026 — Phase 9 built: the new design and call features from `Updates/` ✅ (not deployed)
The owner supplied a full specification (`Updates/CHAT-UI-BUILD.md`, `CHAT-CODE-SPEC.md`, a working prototype, a theme file) and asked for all of it. Built in ten sections, each with its own tests and a real-browser check, on branch `redesign-v2`, then merged.
- **S1–S3 design.** Light and dark mode with five accent colours, saved per person (and applied before the page draws, so there is no flash). The whole app redrawn to the prototype: sidebar with a profile card, channel header, right-hand panels (thread, pins, details), search as a centred box (Ctrl K), messages with day dividers and a "new" line, hover actions, toasts.
- **S4 profile photos.** Upload a JPEG, PNG or WebP up to 2 MB; it is cut square and stored as a 256-pixel JPEG. Shown on messages, lists, tiles and cards; everyone sees a change at once.
- **S5 call screen.** Full-screen dark stage, one tile per person, a green ring while they speak (worked out in the browser), a dock of controls, minimise to a pill. Reactions and raised hands. If the starter leaves, the person in the call longest is the host until the starter returns.
- **S6 ringing.** Incoming calls are a card: Accept, Decline, or Message (declines and posts your words to the caller). Anyone in a call can ring another person into it; a "Join my call" card in their direct conversation still works after a missed ring. A person in a call who is rung one-to-one can bring the caller into their call.
- **S7.** The sharer sees their own screen in a corner with Stop.
- **S8 whiteboard.** Everyone in the call draws on one board; late joiners see it; undo is your own stroke; clear is the host's. Kept in memory only, gone when the call ends.
- **S9 recording.** The host records in their own browser; everyone sees REC and is told; the file is saved into the conversation when recording stops or the host leaves.
- **S10 breakout groups.** The host splits the call into up to six groups. Each browser stops sending its voice to people outside its group, so the separation is real. Sharing and the whiteboard wait while groups are open.
- **Checked:** server and web tests, twelve real-browser scripts (up to five signed-in people at once), and the speed check with 100,000 messages.
- **Not done by design:** nothing deployed; the owner deploys off-hours. One new database file (`chat_005`).
- **Differences from the file** are listed under Phase 9 in `Phases.md`.

### 1 Oct 2026, 17:34 — Phase 7 deployed: lightweight, links, formatting, channel housekeeping ✅
The owner chose what to add (yes: calls from outside, CRM automatic messages, clickable links, channel housekeeping, simple formatting; no: "seen" marks, call extras, audit screen, Mattermost import, install as an app, dark mode) and asked whether the chat stays lag-free with very long chats and large files.
- **Measured first.** New tools: `SEED_HEAVY=1 node server/dev/local.mjs` loads 100,000 messages, 300 channels and 120 more people; `server/dev/e2e/browser-perf.cjs` takes 31 measurements, each with a limit. Normal use was already fast. The weak points were real: after scrolling back 2,000 messages the page held about 60,000 elements, typing froze up to 450 ms a key, arriving messages froze it 500 ms, and search took 0.5 to 0.85 s.
- **Fixed.** The page keeps at most 400 messages of a channel and pages both ways (`utils/messageWindow.ts`, `chatReducer.ts`, `MessageFeed.tsx`); the list and each message are redrawn only when they change (`memo` and stable callbacks); channels that are not open keep only their newest page; search is newest-first and uses three new indexes (`migrations/chat_004_search_speed.sql`). After: freezes under 70 ms, typing costs nothing extra, search 15 to 30 ms, memory 14 MB instead of 124 MB.
- **Files were already light:** the list shows thumbnails only; a document is fetched only on download.
- **Clickable links and formatting.** `utils/richText.ts` (pure parser, 13 tests) and `components/messages/RichText.tsx`. Bold, inline code, code blocks, lists, links. Text pieces only, never HTML. The server now stores code exactly as typed (`utils/sanitize.js`); before, it squeezed the indentation out of a code block.
- **Channel housekeeping.** `PATCH /channels/:id`, `POST /channels/:id/archive`, live event `channel_archived`, and rules on leaving (not General, not a direct message; a private channel whose last member leaves is archived). Screen: Details → Options (`components/channel/ChannelOptions.tsx`). An archived channel counts as having no members, so every route refuses it (`isMember` in `models/channels.model.js`).
- **Checked:** server tests 424 of 424; web tests 142 of 142; end-to-end 13 of 13; browser checks 14, 10, 5, 7, 16, the new `browser-features.cjs` 12 of 12, and the speed check 31 of 31; deploy rehearsal 51 of 51.
- **Deployed** after checking no call was live. The chat restarted once. Database file 004 applied on the live database (dry run first): three indexes on `chat.messages`. The trigram extension was already installed there by the CRM. Health, the new build and a refused unsigned request were checked from the public address; no new line in the error log.
- **Fixed along the way:** "any change in a call redraws the whole message list" (the list no longer redraws for that).
- **Phase 8 survey done** (CRM automatic messages): about 150 places, no buttons, 25 sending implementations. Kept in `Tasks/CRM-Mattermost-Survey.md` (local only). Needs the owner's decisions before work starts; see `Phases.md`.
- **Decisions made while building, for the owner to confirm:** search results newest first; nobody leaves General; a private channel whose last member leaves is archived; no un-archive button yet; leave and archive ask first.

### 1 Oct 2026, 16:47 — pull request #13 deployed; work now goes straight to `main` ✅
- The owner merged #13 and said: in this repository only the two of us work, so push directly to `main`. `Rules.md` (Git rule) now says so. Tests before every push and no force-push still apply. Other repositories keep branches and pull requests.
- Deployed #13 after checking no call was live. The chat restarted once and is healthy. The start-up warning from the database library is gone (no new line in the error log).
- People who were signed in reconnected on their own; their requests for channels, messages and settings were answered normally after the restart, which shows the new connection setting works with real use.

### 1 Oct 2026 — real screen share proven; start-up warning removed ✅ (the code change is not deployed yet)
- **Real screen share under the security headers: works.** New check `server/dev/e2e/browser-real-share.cjs` runs a two-person call against the local chat with the PC's real screen (no fake device; the microphone is a generated tone). The other person saw the real desktop at 1280 by 720. The "camera is not allowed" notice still appears in the browser console when a share starts. The chat never asks for the camera; the notice is the browser reporting that the header refuses it, and sharing is not affected.
- **Start-up warning removed.** `models/db.js` set `search_path` with a query each time a connection opened, which could overlap the first real query and made the database library print a deprecation warning. It is now a connection start-up option (`-c search_path=chat,public`). Checked against the real database, read only: six queries over three fresh connections all saw `chat,public` and found the chat tables. New test `test/db-pool.test.js`.
- Checked: server tests 396 of 396; deploy rehearsal 51 of 51.
- The owner still has to try chat2 by hand (search, a call, mute, remove, ask to join).

### 1 Oct 2026, 16:22 — security items and Phase 5 deployed to chat2 ✅
- The owner merged pull request #11. One run of `/opt/chat/deploy/deploy.sh` put four commits on the server: the security items (#9), the technical reference (#10) and Phase 5 (#11).
- Checked before: nobody was on a call, nobody had used chat2 in the previous five minutes, and no active person has an IP restriction set, so the new IP rule refuses nobody today.
- The deploy installed the upgraded mail library, rebuilt the web app and restarted the chat once. Health check passed.
- Checked after, on the server and from the public address: health answers; the new web build is served; the security headers are on every response; a request with no sign-in is refused; the error log holds only an old start-up warning (below).
- **Still to do by a person:** sign in on chat2, search for part of a word and for a name, make a call, share a real screen (the checks used a fake one), and try mute, remove and ask-to-join.
- **Small thing seen:** on every start the chat logs a deprecation warning from the database library (`client.query()` while a query is running; it comes from setting `search_path` in `models/db.js`). Harmless today. It must be changed before the library's next major version.
- **Way back, if ever needed:** as `deploy/SERVER.md` says: revert the pull request on GitHub, then run the deploy script. The IP rule alone can be switched to log-only with `IP_RESTRICTION_ENFORCE=false` in `/opt/chat/.env` and a restart.

### 1 Oct 2026 — Phase 5 built: search, own-screen preview, call host controls ✅ (deployed, see above)
The owner said to carry on with the chat system only. Phase 4's last step is a CRM clean-up that waits for his check of chat2, so the next chat work was Phase 5.
- **Search.** Cause found in the live server log: all 12 searches people made returned an empty list. Search matched whole English words in message text only; people typed part of a word ("Syste") or a person's name ("System Administrator", "akan"). Now: part of a word matches; every word typed must be in the text or the sender's name; the old full-text match is kept too ("invoices" finds "invoice"); the same box lists matching people (opens the conversation) and channels (opens the channel).
- **Own-screen preview.** The sharer sees their own screen, small, in the call panel. It plays the capture already running; nothing extra is sent.
- **Host controls.** The person who started the call can mute and remove others (remove asks "Yes / No" first). No unmute exists. A removed person's Join button becomes "Ask to join"; the host sees the request and lets them in or refuses; after a refusal they wait a minute. A person who only left or lost connection joins back freely. Removal is enforced by the server (their set-up messages stop being passed on); mute is done by the muted person's browser.
- **New addresses:** `POST /calls/:id/participants/:userId/mute`, `…/remove`, `POST` and `DELETE /calls/:id/join-requests`, `POST /calls/:id/join-requests/:userId`. **New live events:** `call_muted_by_host`, `call_removed`, `call_join_request`, `call_join_request_cancelled`, `call_join_answer`.
- **Where:** server `services/calls/host.controls.js` (new), `call.service.js`, `models/search.model.js`, `utils/searchText.js` (new); web `components/calls/HostActions.tsx`, `JoinRequests.tsx`, `OwnScreen.tsx` (new), `CallPanel.tsx`, `CallBanner.tsx`, `hooks/useCallHostActions.ts` (new), `context/callState.ts`, `utils/quickFind.ts`, `utils/joinRequests.ts` (new), `components/channel/SearchPanel.tsx`.
- **Checked:** server tests 395 of 395; web tests 120 of 120; end-to-end 13 of 13; browser checks 14, 10, 5, 7 and the new `browser-host.cjs` 16 of 16.
- **No database change. No new library.** One new fixed value: 60 seconds before a refused person may ask again.
- **Seen while testing:** with the fake devices the browser checks use, Edge logs "camera is not allowed" when a screen is shared. It comes from the new security header and the fake screen being a fake camera. Sharing still works in the checks. **Try a real screen share on chat2 right after the next deploy.**
- **Decisions made while building, for the owner to confirm:** the "Remove?" confirmation; no Remove in a one-to-one call; one minute wait after a refusal; no host controls for anyone while the host is out of the call.

### 1 Oct 2026 — technical reference written ✅
- The owner asked for one file describing everything implemented, with the technical detail. It is `IMPLEMENTATION.md` at the top of the repository.
- It covers: what is live and what is waiting, how the pieces fit, libraries and versions, folder layout, sign-in and access, every database table, every address, every live event, each feature, the web app, security, limits, settings, running it, tests, known issues, history.
- Every figure in it was checked against the code and the server on the day it was written. Anything merged in pull request #9 but not yet deployed is marked.
- **Keep it up to date:** when a feature, address, table, limit or setting changes, change that file in the same pull request.
- It holds no secret and no server address beyond what `deploy/SERVER.md` already has (the repository is public).

### 1 Oct 2026 — security items from the checklist review ✅ (deployed with Phase 5, see above)
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
