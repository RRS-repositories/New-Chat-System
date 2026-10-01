# New Chat System — what has been implemented

A technical reference for the Rowan Rose team chat: every feature that exists, how it is built, and the numbers and names behind it.

**Written:** 1 October 2026
**Live at:** https://chat2.rowanroseclaims.co.uk
**Code:** this repository (`RRS-repositories/New-Chat-System`), branch `main`
**Companion documents:** `PRD.md` (what and for whom), `Architecture.md` (how the pieces fit), `Phases.md` (the plan), `Memory.md` (progress log), `deploy/SERVER.md` (running it on the server).

---

## 1. Status at a glance

| Part | State |
|---|---|
| Text chat, files, search, presence, notifications, voice calls, screen sharing, admin panel | **Live** on chat2 |
| Chat running from its own repository and folder (`/opt/chat`), with its own settings file | **Live** since 1 Oct 2026, 11:48 |
| Security items: IP restriction, upload content checks, security headers, request ceiling, mail library upgrade | **Built and tested, not deployed.** Pull request #9, waiting to be merged |
| Search button fix, own-screen preview for the sharer, call host controls | **Not built** (Phase 5) |
| Calls from outside the office | **Blocked** on the router port forwarding (Phase 6) |
| Chat inside the CRM, Mattermost history import, phone install, camera video | **Not built**, by decision |

Sections below mark anything that is in pull request #9 and not yet live with **(PR #9)**.

---

## 2. How it fits together

```
Browser (React app)
   │  HTTPS + WebSocket
   ▼
Cloudflare tunnel ──► nginx site "chat2" (port 80 on the server)
                          │  proxies everything, websockets included
                          ▼
                 chat-server (Node, 127.0.0.1:5020, one pm2 process)
                   ├─ Express: REST API under /api/chat, and the built web app
                   ├─ Socket.IO: namespace /chat (live events, call signalling)
                   ├─ PostgreSQL: the CRM's database, schema "chat"
                   ├─ Redis: Socket.IO adapter
                   ├─ Disk: /data/chat-uploads (files and thumbnails)
                   └─ CRM back end (127.0.0.1:5000): checks email + password at sign-in

Browser ◄──────── audio / screen (WebRTC, peer to peer) ────────► Browser
            STUN (free public servers) and TURN relay (our own coturn on the server)
```

- **Voice and screen never pass through the chat server.** The server only carries the small set-up messages between browsers.
- **One server process only.** Live calls and presence are held in that process's memory.
- **No paid services.** Everything is self-hosted or free.

---

## 3. Technology and versions

| Layer | What | Version |
|---|---|---|
| Runtime | Node.js, ES modules | 20 (server runs 20.20.2) |
| Web framework | Express | 4.21 |
| Live connection | Socket.IO, with the Redis adapter | 4.8 / 8.3 |
| Database driver | `pg` (raw SQL, no ORM) | 8.13 |
| Database | PostgreSQL, schema `chat` inside the CRM's database | 17.10 |
| Sign-in token | `jsonwebtoken` (verifies the CRM's token) | 9.0 |
| Uploads | `multer` (memory storage) | 2.4 |
| Image thumbnails | `sharp` | 0.35 |
| Push notifications | `web-push` (VAPID) | 3.6 |
| Email (optional digest) | `nodemailer` | 6.x live · 10.x **(PR #9)** |
| Front end | React, React Router, TypeScript, Vite | 18.2 / 7.13 / 5.8 / 6.2 |
| Icons | `lucide-react` | 0.462 |
| Calls | The browser's own WebRTC. No wrapper library. | — |
| Call relay | coturn (self-hosted) | — |
| Process manager | pm2 | 7.0 |
| Test tools | Node's built-in test runner, `supertest`, PGlite (Postgres in memory), `playwright-core` driving the installed Edge | — |
| Formatting | Prettier 3 via `npx` (single quotes, 120 columns, trailing commas) | — |

No UI kit, no CSS framework, no state-management library.

---

## 4. Repository layout

```
New Chat System/
├── PRD.md  Architecture.md  Rules.md  Phases.md  Design.md  Memory.md  IMPLEMENTATION.md
├── rules.txt                     the owner's rules for this project
├── deploy/
│   ├── deploy.sh                 pulls main, does only what the change needs, checks health
│   ├── ecosystem.config.cjs      pm2 definition of "chat-server"
│   ├── make-env.sh               builds /opt/chat/.env from the CRM's settings file
│   ├── env.example               every setting name, no values
│   ├── rehearse.sh               tests deploy.sh and make-env.sh with stand-ins (51 checks)
│   └── SERVER.md                 server notes
├── server/
│   ├── main.js                   entry point
│   ├── migrations/               chat_001…003 .sql + apply.mjs (dry run unless --commit)
│   ├── src/
│   │   ├── app.js  server.js     wiring: Express app, http server, Socket.IO
│   │   ├── config/               the only place that reads environment settings
│   │   ├── routes/      (11)     address → controller, no logic
│   │   ├── controllers/ (11)     read the request, call services/models, send the reply
│   │   ├── services/    (13)     the rules: messages, channels, access, calls, files, notifications, presence, digest, session
│   │   ├── models/      (16)     every SQL query
│   │   ├── middleware/  (3+1)    sign-in check, errors, rate limit; security headers (PR #9)
│   │   ├── sockets/     (3)      live events: core, presence, call signalling
│   │   └── utils/       (5+2)    ids, file names, validators, mentions, message cleaning; IP rules and file signatures (PR #9)
│   ├── test/            (36 files, 353 tests live · 368 with PR #9)
│   └── dev/                      local.mjs (local chat on PGlite) and e2e/ (5 scripts)
└── web/
    ├── index.html  vite.config.ts  public/sw.js
    ├── src/
    │   ├── App.tsx  main.tsx
    │   ├── pages/        (6)     sign-in, chat, admin people, one person's access, restrictions, DM redirect
    │   ├── components/   (37)    layout, channel, messages, dialogs, calls, admin, common
    │   ├── context/      (7)     chat state, call state, sign-out
    │   ├── hooks/        (14+5)  screen logic; hooks/actions/ holds the chat actions
    │   ├── services/     (9)     every call to the server, the socket, push, the call engine
    │   ├── utils/        (15)    pure helpers
    │   ├── config/  types/  styles/ (12 CSS files)
    └── test/             (14 files, 107 tests)
```

About 13,800 lines of source in `server/src` and `web/src`.

**Layer rules that are kept everywhere:** routes hold no logic; SQL lives only in `models/`; rules live in `services/`; screens and hooks never call the server directly, they go through `web/src/services/`.

**Four files are long on purpose:** `web/src/services/callManager.ts` (725 lines, the call engine), `server/src/services/calls/call.service.js` (495), `web/src/context/chatReducer.ts` (394), `web/src/context/CallProvider.tsx` (311). `Memory.md` gives the reason for each.

---

## 5. Sign-in and access

### 5.1 Sign-in

1. The sign-in page posts email and password to `POST /api/chat/auth/login`.
2. The chat server forwards them to the CRM (`CRM_INTERNAL_URL` + `/api/auth/login`, 10-second timeout). The real client address travels with it in `CF-Connecting-IP` and `X-Forwarded-For`, because the CRM limits sign-in attempts per address.
3. The CRM answers with its session token (a JWT, HS256, signed with `SESSION_JWT_SECRET`, audience `rrs-crm-session`, valid 7 days). The chat passes it on, minus the Mattermost token.
4. The browser keeps it in `localStorage` under `chat_session` and sends it as `Authorization: Bearer …` on every request and in the Socket.IO handshake.

The chat stores no passwords and issues no tokens of its own.

### 5.2 What is checked on every request

`middleware/auth.js` → `requireAuth`:

- the token verifies (signature, audience, expiry);
- the person still exists in `public.users`, is approved, is active, and has no open row in `account_locks`;
- the token was not issued before `users.sessions_valid_from` (this is how a password reset or a manager signing someone out ends their chat session);
- **access switch:** chat is on for the person (see 5.3), unless `CHAT_REQUIRE_BETA=false`;
- **(PR #9) IP restriction:** if the person has addresses listed in `users.ip_restriction` (set in the CRM's permission editor), the request must come from one of them. The address used is Cloudflare's `cf-connecting-ip`, then the socket address; the forwarded chain is not trusted. An empty list restricts nothing; a list with no usable entry also restricts nothing.

A live connection gets the same checks at the handshake, and again **every 60 seconds** while it is open (`SESSION_RECHECK_MS`), so a deactivated person loses chat within a minute rather than at the token's expiry.

### 5.3 The access switch

Chat is enabled for a person when any of these is true (`models/users.model.js`):

- their role is `Management` or `IT`;
- they hold the CRM permission `chat.beta` personally;
- they have no personal permission rows at all and their role's defaults include `chat.beta`.

This mirrors the CRM's own permission rule. `users.role` is the `user_role` enum, so it is cast with `u.role::text` before being compared with text.

Everyone else can sign in but sees "Team chat is not enabled for your account" (HTTP 403, code `chat_not_enabled`).

### 5.4 Admin

Routes under `/api/chat/admin` additionally require role `Management` (`requireManagement`).

---

## 6. Data model

PostgreSQL schema `chat`, created by `server/migrations/chat_001_schema.sql`, `chat_002_rich.sql`, `chat_003_notify_calls.sql`. People come from the CRM's `public.users`; the chat only reads that table.

| Table | Key columns | Notes |
|---|---|---|
| `channels` | `id` uuid, `name`, `display_name`, `type` (`public` / `private` / `dm` / `group_dm`), `purpose`, `header`, `dm_key`, `created_by`, `archived_at` | `dm_key` is unique, so two people have exactly one DM. A `general` public channel is seeded with every active person. |
| `channel_members` | `channel_id`, `user_id`, `role` (`owner` / `admin` / `member`), `last_read_at`, `muted`, `notify_pref` (`all` / `mentions` / `nothing` / `default`) | Primary key (channel, user). |
| `messages` | `id` uuid, `channel_id`, `user_id`, `thread_id`, `reply_to_id`, `content`, `content_search` (generated `tsvector`), `type` (`message` / `system` / `join` / `leave` / `file` / `call`), `pinned`, `pinned_by`, `pinned_at`, `edited_at`, `deleted_at`, `metadata` jsonb | Deletes are soft. GIN index on `content_search`; index on (channel, created_at desc, id desc) for paging. |
| `files` | `message_id`, `channel_id`, `user_id`, `filename`, `mime_type`, `size_bytes`, `file_path`, `thumbnail_path` | The file itself is on disk. |
| `mentions` | `message_id`, `channel_id`, `user_id`, `type` (`user` / `channel` / `all`), `read` | Drives the red mention badge. |
| `reactions` | (`message_id`, `user_id`, `emoji`) | One row per person per emoji. |
| `calls` | `id`, `channel_id`, `initiated_by`, `type` (`voice`; the database also accepts `video`, unused), `status` (`ringing` / `active` / `ended` / `missed` / `declined`), `started_at`, `ended_at`, `duration_secs` | A unique index allows only one live call per channel. |
| `call_participants` | (`call_id`, `user_id`), `joined_at`, `left_at`, `is_sharing_screen` | |
| `communication_restrictions` | `user_id`, `target_user_id`, `restriction` (`all` / `dm` / `call` / `channel`), `restricted_by`, `reason` | Who may not contact whom. |
| `user_preferences` | `desktop_notif`, `mobile_notif` (`all` / `mentions` / `nothing`), `sound_enabled`, `send_on_enter`, `status_text`, `status_emoji`, `last_digest_at`, plus unused `theme`, `message_display` | |
| `user_presence` | `user_id`, `last_seen_at` | "Last seen" for people who are offline. |
| `push_subscriptions` | `user_id`, `endpoint` (unique), `keys` jsonb, `user_agent` | Up to 10 per person. |
| `audit_log` | `actor_id`, `action`, `target_type`, `target_id`, `detail` jsonb | Access changes and message deletions by moderators. |

The database connection sets `search_path` to `chat, public`. Pool size 10.

**Applying a database file:** `node server/migrations/apply.mjs` lists what would run; `--commit` applies; `--only=<file>` applies one. The deploy script never applies them.

---

## 7. HTTP API

All under `/api/chat`. Every route except `/auth/login` needs the sign-in checks in section 5. Errors come back in one shape: `{ success: false, code, message }`; a server fault says only "Something went wrong". JSON bodies are limited to 64 KB.

| Method and address | What it does |
|---|---|
| `POST /auth/login` | Forwards sign-in to the CRM. |
| `GET /users/me` | The signed-in person. |
| `GET /users` | Everyone who can be messaged. |
| `GET /users/online` | Who is online and away, with status. |
| `GET /users/me/preferences` · `PATCH /users/me/preferences` | Notification level, sound, send-on-Enter. |
| `PATCH /users/me/status` | Status text (100 characters) and emoji (16). |
| `GET /channels` | The person's channels with unread and mention counts. |
| `POST /channels` | Create a public, private or group channel. |
| `POST /channels/dm` | Open (or find) a direct message with one person. |
| `GET /channels/:id` | Channel details and members. |
| `POST /channels/:id/members` · `DELETE /channels/:id/members/:userId` | Add or remove members. Removing needs channel admin. |
| `POST /channels/:id/read` | Mark read. |
| `PATCH /channels/:id/notify` | Per-channel notification level. |
| `GET /channels/browse` · `POST /channels/:id/join` | List public channels; join one. |
| `GET /channels/:id/messages` | A page of messages (50 by default, 100 at most, cursor = `created_at|id`). Also "around a message" for jumps. |
| `POST /channels/:id/messages` | Send. Limit: 1 per second per person. |
| `PATCH /messages/:id` · `DELETE /messages/:id` | Edit own message; delete own, or any as a channel admin. |
| `GET /messages/:id/thread` | A thread: the root and its replies. |
| `GET /channels/:id/pins` · `POST /messages/:id/pin` · `DELETE /messages/:id/pin` | Pinned messages, 50 per channel at most. |
| `POST /messages/:id/reactions` · `DELETE /messages/:id/reactions/:emoji` | Reactions (emoji up to 8 characters). |
| `POST /channels/:id/upload` | Upload up to 5 files of 20 MB each, with an optional caption. Limit: 5 uploads per minute per person. |
| `GET /channels/:id/files` | Files shared in a channel. |
| `GET /files/:id/download` · `GET /files/:id/thumb` | The file, or its thumbnail. Channel members only. |
| `GET /search?q=&channelId=&page=` | Full-text search, 20 results per page. |
| `GET /push/key` · `POST /push/subscribe` · `POST /push/unsubscribe` | Web Push set-up. |
| `GET /calls/ice` | STUN and TURN servers with a time-limited credential. |
| `POST /channels/:id/calls` | Start a call. |
| `GET /channels/:id/calls/active` · `GET /channels/:id/calls` | The live call, if any; call history. |
| `GET /calls/:id` · `POST /calls/:id/join` · `/leave` · `/decline` · `/screen-share` | Call actions. |
| `GET /admin/users` | Management: everyone, their role, whether chat is on, blocked counts. |
| `GET /admin/restrictions` · `GET /admin/restrictions/user/:userId` · `POST /admin/restrictions` · `DELETE /admin/restrictions/:id` | Management: who may not contact whom. |
| `PUT /admin/users/:userId/access` | Management: set what one person may do towards up to 500 others in one call. |

Outside `/api/chat`: `GET /health` returns `{ ok: true, service: "chat" }`; `GET /sw.js` is the notification worker (never cached); everything else returns the web app.

**(PR #9)** A general ceiling of 600 requests per minute per person sits in front of all of the above, in addition to the two tighter limits.

---

## 8. Live events (Socket.IO)

Namespace `/chat`, path `/socket.io`, transports websocket then polling, reconnection with a 10-second maximum delay. Rooms: one per person (`user:<id>`) and one per channel.

**Browser → server**

| Event | Purpose |
|---|---|
| `join_channel { channel_id }` | Subscribe to a channel's events (membership is checked). |
| `typing { channel_id }` | "is typing", throttled to one every 3 seconds per person per channel. |
| `mark_read { channel_id }` | Mark read; the person's other devices clear their badge too. |
| `set_away { away }` | Away or back. |
| `webrtc_signal { call_id, to_user_id, signal_data }` | Call set-up message for one other participant (64 KB at most). |

**Server → browser**

| Event | Meaning |
|---|---|
| `ready` | Handshake complete. |
| `session_ended { reason }` | The session is no longer valid (`token_invalid` or `chat_not_enabled`); the app signs out. |
| `new_message`, `message_edited`, `message_deleted` | Message changes. |
| `message_pinned`, `message_unpinned`, `reaction_added`, `reaction_removed` | |
| `typing` | Someone is typing. Shown for 5 seconds. |
| `unread_update { channel_id, unread_count, mention_count }` | Badge changes for this person. |
| `member_added`, `member_removed`, `channel_updated` | Membership and channel changes. |
| `user_online`, `user_offline`, `user_away`, `user_status` | Presence and status. |
| `call_started`, `call_participant_joined`, `call_participant_left`, `call_ended`, `call_dismissed` | Call lifecycle. |
| `call_screen_share_started`, `call_screen_share_stopped` | Screen share. |
| `webrtc_signal { call_id, from_user_id, signal_data }` | Call set-up message from another participant. |

---

## 9. Features in detail

### 9.1 Channels and direct messages

- **Public** channels can be browsed and joined by anyone with chat access. **Private** channels are by invitation. **Direct messages** are between exactly two people (members cannot be added). **Group** conversations are `group_dm`.
- Channel names are turned into a unique slug; creating needs a name.
- A direct message cannot be opened with yourself, or with someone you are blocked from messaging.
- A private channel cannot be created, or added to, with two people who are blocked from sharing private channels.
- The sidebar has two sections, Channels and Direct messages, each foldable; the folded state is kept in the browser (`chat.collapsed`). The last open channel is remembered (`chat_last_channel`).

### 9.2 Messages

- Plain text, up to **4,000 characters**. HTML tags are removed and their text kept ("3 < 5" stays as written). Trailing spaces and runs of spaces are tidied.
- **Edit** your own message (shows as edited). **Delete** is soft; a channel admin can delete anyone's message, and that is written to `audit_log`.
- **Reply** quotes one message. **Threads** hang replies off a root message and open in a side panel.
- **Reactions:** any emoji, one per person per emoji.
- **Pins:** up to 50 per channel, shown in a bar at the top.
- **Mentions:** `@Full Name`, `@FirstName` (only when that first name is unique in the channel), `@all`, `@channel`. Longest names are matched first, so "@Ann Agent" is not read as "@Ann". The input offers an autocomplete list.
- **Paging:** newest 50 first; older pages load as you scroll up. Jumping to a message from search or a pin loads the messages around it and highlights it.
- **Sending limit:** one message per second per person. Enter sends by default (a preference).

### 9.3 Files

- Up to **5 files per message, 20 MB each**.
- Allowed types: JPEG, PNG, GIF, WebP, SVG, PDF, Word, Excel, PowerPoint, CSV, plain text, ZIP, MP4, WebM.
- Stored under `CHAT_UPLOADS_DIR` (`/data/chat-uploads` on the server), in a folder per channel, under a generated name. File names are cleaned and sent back with a safe `Content-Disposition`.
- Images get a 200-pixel-wide JPEG **thumbnail** (`sharp`). Clicking opens a full-size view.
- Files are fetched with the sign-in token and shown from memory; only channel members can fetch them. An SVG is never served as an image (it can carry script); it downloads instead.
- **(PR #9)** The content must match the type: a real JPEG, PNG, PDF and so on is recognised by its first bytes. A program renamed to `photo.jpg` is refused with code `file_content`.

### 9.4 Search

PostgreSQL full-text search (`to_tsvector('english', content)`, GIN index), limited to channels the person is in, ranked by relevance then date, 20 results per page, with the matching words highlighted in a short excerpt. A result jumps to the message.

**Known issue:** the search button was reported not working on the live site. Fixing or removing it is Phase 5.

### 9.5 Unread counts and read tracking

- Each channel shows an unread count; mentions show a red badge; the browser tab title shows the total.
- A channel is marked read only when it is open **and the tab is being looked at** (visible and focused), and only after a message has been on screen for 0.8 seconds.
- Marking read on one device clears the badge on the person's other devices.

### 9.6 Presence and status

- Green dot = online, amber = away, none = offline.
- **Away** after 5 minutes with no pointer, key, wheel or touch input, or when the tab is hidden. A person is away only when all of their open tabs are.
- Going offline is announced **5 seconds** after the last connection closes, so a page reload does not flicker.
- Each person can set a status message and emoji.
- Held in the server's memory; `user_presence.last_seen_at` keeps the last time someone was seen.

### 9.7 Notifications

Three channels, one rule.

**The rule.** Each person chooses a level: all messages, mentions only, or nothing. Each channel can override it (`notify_pref`), or be muted. At "mentions only", a direct message always counts.

- **In the open tab:** a sound (can be turned off) and, when the tab is not being looked at, a desktop notification.
- **With no tab connected: Web Push.** The browser's own push service delivers it to a small service worker (`/sw.js`), which shows the notification unless a chat tab is visible and focused. Clicking it opens the right channel. Needs the VAPID keys (`CHAT_VAPID_PUBLIC`, `CHAT_VAPID_PRIVATE`); without them push is simply off. A notification shows at most 140 characters of the message. Message pushes live 24 hours, an incoming-call push 30 seconds. A subscription the push service reports as gone is deleted.
- **Daily email digest of unread mentions** (optional, **off**): one email at 08:00 UTC to people with unread mentions who are not connected. Turned on by `CHAT_DIGEST_ENABLED=true` and the SMTP settings.

System, join, leave and call-summary messages never notify.

### 9.8 Voice calls

**Shape.** A full mesh: each browser holds one WebRTC connection to every other participant. Up to **8 people**. Voice only (no camera, by decision), with echo cancellation, noise suppression and automatic gain.

**Starting and joining**

1. `POST /channels/:id/calls` creates the call as `ringing`. Everyone in the channel gets `call_started`; people with no tab open get a push. Only one live call per channel (a unique index enforces it).
2. Others see an incoming-call window and hear a ringtone. They accept (`/calls/:id/join`) or decline.
3. The first person to join makes the call `active`.
4. Unanswered after **30 seconds**, the call ends as `missed` and "Missed call from …" is posted in the channel.
5. Someone can join late while the call is live.
6. When the last person leaves, the call ends and a summary line with the duration is posted.

**Set-up messages (signalling).** Sent as `webrtc_signal` through the server to one named participant. Three kinds: a session description, an ICE candidate, and a mute state.

- The **joiner** makes the offer to each person already in the call. Those people wait; if no offer arrives in 4 seconds they start themselves.
- Renegotiation follows the "perfect negotiation" pattern; the **polite** side is the one with the larger user id.
- Each connection is independent. If one fails, it gets one ICE restart; if still not connected after 10 seconds only that connection is closed and that person is shown as lost. Nobody else in the call is affected.

**One device per person.** A call belongs to the browser tab that joined it. Requests carry that tab's connection id. If the tab's connection drops, the person has **10 seconds** to reconnect and re-join before they are taken out of the call. Opening the call in another tab moves it there.

**Finding a route.** `GET /calls/ice` returns free public STUN servers and our own TURN relay. The TURN credential is made per person and is valid 12 hours: username `<expiry>:<userId>`, password an HMAC-SHA1 of that with `CHAT_TURN_SECRET`. No TURN accounts are stored.

**Restrictions.** A person blocked from calling another cannot start or join a call in their direct message ("You cannot call this person").

**Server restart.** Calls are held in memory, so a restart ends them; on start-up the server marks any call left `ringing` or `active` as ended.

**Fixed on 1 October:** the microphone prompt no longer lingers after a failed join; repeated screen shares no longer grow the connection; two people accepting at the same moment no longer deadlock.

### 9.9 Screen sharing

- One person shares at a time ("Someone is already sharing").
- Uses exactly one video channel per connection, reused for every share, so starting and stopping does not renegotiate from scratch.
- The share is tied to the call device; stopping the browser's own "stop sharing" bar ends it.
- Viewers can go **full screen** or **open the shared screen in its own window**.
- On wide screens the call panel docks on the right and the page makes room.

**Not built yet:** the person sharing does not see a preview of their own screen (Phase 5).

### 9.10 Admin panel (Management only)

- **People:** everyone, their role, whether chat is switched on for them, who is online, and how many people they are blocked from or by. Filters and search.
- **One person's access:** a row per colleague with three ticks — Messages, Calls, Private channels. Saved in one request. Blocking all three is stored as one `all` row; otherwise one row per kind. Every change is written to `audit_log`.
- **Restrictions list:** every block in force, with who set it and why; add and remove.

A restriction applies when opening a direct message, calling, and creating or adding to a private channel. **Known gap:** it does not remove two people from a private channel they already share.

### 9.11 Settings

Per person: notification level, sound on or off, Enter-to-send, status message. Stored in `chat.user_preferences`.

---

## 10. The web app

- **Entry:** `main.tsx` → `App.tsx`: the sign-in gate, the providers, and the list of pages.
- **Addresses:** `/`, `/channels/:id`, `/channels/:id/thread/:messageId`, `/channels/:id/details`, `/admin`, `/admin/users/:id`, `/admin/restrictions`. All built in `config/routes.ts`.
- **State:** two React contexts and reducers, no library.
  - `ChatProvider` + `chatReducer`: channels, messages per channel, threads, pins, people, presence, preferences.
  - `CallProvider` + `callState`: this tab's call, the incoming call, and which channels have a live call.
- **Talking to the server:** `services/apiClient.ts` (fetch with the token; a 401 signs out), `chatApi.ts`, `callApi.ts`, `authApi.ts`, `socket.ts`, `push.ts`.
- **The call engine:** `services/callManager.ts`, written without React and with the browser pieces injected, so it is tested with fakes (36 tests).
- **Live events:** `hooks/useChatSocketEvents.ts` and `hooks/useCallSocketEvents.ts` turn socket events into state changes. Events that arrive while a call is still being created are held (500 at most) and applied once the call id is known.
- **Styles:** plain CSS in 12 files, one per area. Every colour and size is a variable in `tokens.css`; `theme.css` loads last.
- **Design:** accent violet `#6C4DE6`; sidebar deep indigo `#1B1F3A`; online green `#22C55E`, away amber `#F59E0B`, attention red `#DC2626`. System font, 14 px base, 16 px in inputs so phones do not zoom. Sidebar 240 px. Below 768 px wide the layout becomes a single column. Full list in `Design.md`.
- **Build:** `tsc --noEmit && vite build` → `web/dist` (about 365 KB of script, 113 KB compressed; 21 KB of CSS). Served by the chat server itself, cached for 1 hour except the service worker.

---

## 11. Security

**Live**

- Every API route requires a valid CRM session; admin routes require Management.
- Sessions are re-checked against the CRM's user table on every request and every 60 seconds on a live connection.
- All SQL uses parameters. No user input is ever placed in query text.
- One error handler; server faults reveal nothing ("Something went wrong").
- Message content is plain text with tags removed.
- Files: type allowlist, size and count limits, cleaned names, members-only downloads, SVG never rendered.
- Request body limit 64 KB. `X-Powered-By` removed. CORS is off unless origins are listed.
- Push subscription endpoints are validated (https only, a public host, never localhost or a private address) and capped at 10 per person.
- Call set-up messages are capped at 64 KB and only relayed between participants of the same call.
- The settings file on the server is readable by its owner only and holds only what the chat needs. No secret is in the repository, which is public.

**(PR #9), built and tested, not deployed**

- Per-person **IP restriction**, the same rule the CRM enforces.
- **Upload content checks** (first bytes must match the type).
- **Security headers** on every response: `Content-Security-Policy` (own scripts, API and live connection only; nothing may frame the chat), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Strict-Transport-Security`, `Permissions-Policy` (camera and location off; microphone and screen capture for this site only).
- **General ceiling** of 600 requests per minute per person.
- **`nodemailer` 6 → 10**, clearing the one known high-severity library issue. `npm audit` then reports none.

**Inherited from the CRM's sign-in, not fixable in the chat alone:** no multi-factor sign-in; 7-day sessions kept in the browser; the CRM's password rules.

---

## 12. Limits at a glance

| What | Limit |
|---|---|
| Message length | 4,000 characters |
| Messages | 1 per second per person |
| Files per message / size each | 5 / 20 MB |
| Uploads | 5 per minute per person |
| All requests **(PR #9)** | 600 per minute per person |
| JSON request body | 64 KB |
| Messages per page | 50 (100 at most) |
| Search results per page | 20 |
| Pins per channel | 50 |
| People in a call | 8 |
| Ring time | 30 seconds |
| Reconnect grace in a call | 10 seconds |
| Offline grace for presence | 5 seconds |
| Away after | 5 minutes without input |
| Typing indicator | sent every 3 s at most, shown 5 s |
| Session re-check on a live connection | every 60 seconds |
| TURN credential life | 12 hours |
| Push subscriptions per person | 10 |
| Status text / emoji | 100 / 16 characters |
| People set in one access change | 500 |

---

## 13. Settings

Read in one place, `server/src/config/index.js`, from `/opt/chat/.env` on the server. `deploy/env.example` lists every name.

| Name | Purpose | Default |
|---|---|---|
| `SESSION_JWT_SECRET` | Verifies the CRM's token. **Must equal the CRM's.** At least 32 characters or the server refuses to start. | — |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | Database. **Must equal the CRM's.** | port 5432, SSL on |
| `REDIS_URL` | Socket.IO adapter. | off if empty |
| `CRM_INTERNAL_URL` | Where the CRM answers on the server. | `http://127.0.0.1:5000` |
| `CHAT_PORT` | Port the chat listens on (localhost only). | 5020 |
| `CHAT_PUBLIC_URL` | Link used in the digest email. | `https://chat2.rowanroseclaims.co.uk` |
| `CHAT_UPLOADS_DIR` | Where files are kept. | `/data/chat-uploads` |
| `CHAT_CORS_ORIGINS` | Only for development on another origin. | empty |
| `CHAT_REQUIRE_BETA` | `false` opens chat to all staff. | on |
| `IP_RESTRICTION_ENFORCE` **(PR #9)** | `false` only logs what would be refused. | on |
| `CHAT_VAPID_PUBLIC`, `CHAT_VAPID_PRIVATE`, `CHAT_VAPID_SUBJECT` | Web Push. | push off if empty |
| `CHAT_STUN_URLS` | STUN servers. | Google and Cloudflare public STUN |
| `CHAT_TURN_URLS`, `CHAT_TURN_SECRET` | Our coturn relay and its shared secret. | relay off if empty |
| `CHAT_DIGEST_ENABLED`, `SMTP_*`, `MAIL_FROM`, `MAIL_FROM_NAME` | Daily mention digest. | off |

Fixed in code: ring time 30 s, 8 people per call, call reconnect grace 10 s, presence grace 5 s, digest hour 08:00 UTC, TURN credential 12 h.

---

## 14. Running it

### On the server

| Item | Value |
|---|---|
| Code | `/opt/chat`, following `main` (Node 20.20.2, pm2 7.0.1) |
| Process | `chat-server` under pm2, `server/main.js`, restart above 400 MB |
| Listens | `127.0.0.1:5020` |
| In front | nginx site `chat2` → Cloudflare tunnel |
| Settings | `/opt/chat/.env` (made by `deploy/make-env.sh` from the CRM's file; owner-readable only) |
| Files | `/data/chat-uploads` |
| Relay | coturn: port 3478 (UDP and TCP), relay ports 49160–49200 (UDP), shared-secret credentials |
| Logs | `pm2 logs chat-server` |

**Deploy:** `/opt/chat/deploy/deploy.sh`. It pulls `main` and does only what the change needs:

- web app only → rebuilds beside the live folder and swaps; **no restart**, so calls are not cut;
- server code → restarts the process (a few seconds; calls in progress end);
- server libraries → installs, then restarts;
- a failed web build never replaces the working one; a deploy that fails half way is picked up by the next run; a changed deploy script hands over to its new version; it ends with a health check.

It never touches the CRM. The reverse is not fully true: the CRM's `deploy.sh --all` restarts every pm2 process, the chat included.

### On a developer PC

```
cd server && npm ci
cd ../web && npm ci && npm run build

node server/dev/local.mjs        # http://localhost:5021 — the real server on an in-memory database
# sign in as m@x (Management), a@x, b@x, c@x, dee@x, eli@x or fay@x — password: local
```

---

## 15. Testing

| What | Command | Count |
|---|---|---|
| Server | `cd server && npm test` | 353 (368 with PR #9), 36 files |
| Web | `cd web && npm test` | 107, 14 files |
| Types | `cd web && npx tsc --noEmit` | clean |
| End to end (API) | `node server/dev/e2e/api-smoke.mjs` | 13 |
| Real browser: notifications | `node server/dev/e2e/browser-notify.cjs` | 10 |
| Real browser: calls and screen share | `node server/dev/e2e/browser-calls.cjs` | 14 |
| Real browser: layout | `node server/dev/e2e/browser-polish.cjs` | 5 |
| Real browser: admin panel | `node server/dev/e2e/browser-admin.cjs` | 7 |
| Deploy scripts | `bash deploy/rehearse.sh` | 51 |

- Server tests run the real SQL against PGlite, which uses the same `user_role` enum as the CRM, so a missing `::text` cast is caught.
- The browser checks drive the Microsoft Edge already installed on the PC, with fake microphone and screen-capture devices, two or three signed-in people at once.
- Each end-to-end script needs a freshly started local chat.

---

## 16. Known issues and not built

**Known small issues**

- Accepting the same call in two tabs at once can make both drop out.
- Any change in a call redraws the whole message list.
- Signing out during a call is tidied up by the server after 10 seconds, not at once.
- A new restriction does not remove two people from a private channel they already share.
- The search button is reported not working on the live site.
- `addRestriction` in `models/restrictions.model.js` still checks its own input; those checks belong in `services/access.service.js`.

**Requested, not built (Phase 5)**

1. Search button: find the cause; fix if simple, otherwise remove.
2. The person sharing sees their own shared screen.
3. Call host controls: the person who started the call can mute and remove others, and cannot unmute anyone. A disconnected person can join back freely; a removed person sends a join request the host accepts or refuses.

**Waiting on others (Phase 6):** router port forwarding for calls from outside the office — ports 3478 (UDP and TCP) and 49160–49200 (UDP) to the server.

**Only on the owner's word:** the chat inside the CRM, moving the CRM's automatic messages off Mattermost, importing Mattermost history, phone install.

**Decided against:** camera video; any paid service.

---

## 17. History

| When | What |
|---|---|
| 28–29 Sep 2026 | Text chat, rich messaging, the access switch, restrictions, browse and join. Built inside the CRM repository. |
| 30 Sep 2026 | Presence, notifications, voice calls, screen sharing. Chat removed from the CRM's menu; chat2 only. Layout improvements. Admin panel. |
| 1 Oct 2026 | Three call fixes and the colour theme. Chat moved to this repository (pull requests #1–#3). Code reshaped to the folder structure (#4). Own deploy script, settings file and server folder; chat2 switched to `/opt/chat` (#5–#8). Security items built (#9, open). |
