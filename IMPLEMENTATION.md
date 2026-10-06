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
| Security items: IP restriction, upload content checks, security headers, request ceiling, mail library upgrade | **Live** since 1 Oct 2026, 16:22 |
| Search that finds part of a word, people and channels; own-screen preview for the sharer; call host controls (mute, remove, ask to rejoin) | **Live** since 1 Oct 2026, 16:22. Waiting for the owner to try them (Phase 5) |
| Lightweight with very long channels (a window of messages on the page, indexed search); clickable links; simple formatting; channel rename, leave and archive | **Live** since 1 Oct 2026, 17:34. Waiting for the owner to try them (Phase 7) |
| The new design (light and dark, five accents), profile photos, the new call screen, incoming-call card, add to call, whiteboard, recording, breakout groups | **Live** since 5 Oct 2026, 16:56 (Phase 9, section 9.12). Waiting for the owner to try it |
| The CRM's automatic messages posted into the chat | **Approved, not started** (Phase 8). About 150 places in the CRM, not forty |
| Calls from outside the office | **Blocked** on the router port forwarding (Phase 6) |
| Chat inside the CRM, Mattermost history import, phone install, camera video | **Not built**, by decision |

The marks **(PR #9)** and **(Phase 5)** below show what went live together in the deploy of 1 Oct 2026, 16:22.

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
| Email (optional digest) | `nodemailer` | 10.x |
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
│   │   ├── services/    (14)     the rules: messages, channels, access, calls, call host controls, files, notifications, presence, digest, session
│   │   ├── models/      (16)     every SQL query
│   │   ├── middleware/  (3+1)    sign-in check, errors, rate limit; security headers (PR #9)
│   │   ├── sockets/     (3)      live events: core, presence, call signalling
│   │   └── utils/       (8)      ids, file names, validators, mentions, message cleaning, search text; IP rules and file signatures (PR #9)
│   ├── test/            (43 files, 424 tests)
│   └── dev/                      local.mjs (local chat on PGlite) seed-heavy.mjs (heavy test data) and e2e/ (9 scripts)
└── web/
    ├── index.html  vite.config.ts  public/sw.js
    ├── src/
    │   ├── App.tsx  main.tsx
    │   ├── pages/        (6)     sign-in, chat, admin people, one person's access, restrictions, DM redirect
    │   ├── components/   (42)    layout, channel, messages, dialogs, calls, admin, common
    │   ├── context/      (7)     chat state, call state, sign-out
    │   ├── hooks/        (15+5)  screen logic; hooks/actions/ holds the chat actions
    │   ├── services/     (9)     every call to the server, the socket, push, the call engine
    │   ├── utils/        (19)    pure helpers
    │   ├── config/  types/  styles/ (12 CSS files)
    └── test/             (18 files, 142 tests)
```

About 15,700 lines of source in `server/src` and `web/src`.

**Layer rules that are kept everywhere:** routes hold no logic; SQL lives only in `models/`; rules live in `services/`; screens and hooks never call the server directly, they go through `web/src/services/`.

**Four files are long on purpose:** `web/src/services/callManager.ts` (725 lines, the call engine), `server/src/services/calls/call.service.js` (521), `web/src/context/chatReducer.ts` (467), `web/src/context/CallProvider.tsx` (394). `Memory.md` gives the reason for each.

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

PostgreSQL schema `chat`, created by `server/migrations/chat_001_schema.sql`, `chat_002_rich.sql`, `chat_003_notify_calls.sql` and `chat_004_search_speed.sql` (indexes only). People come from the CRM's `public.users`; the chat only reads that table.

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

Every database connection opens with `search_path` set to `chat, public` (a connection start-up option, so it is in place before the first query). Pool size 10.

**Indexes that keep it fast as it grows:** messages by channel and time (paging in both directions), by time alone (newest-first search), by sender, a full-text index, and a trigram index on the text (part-of-a-word search). On the live database the trigram extension `pg_trgm` was already installed by the CRM.

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
| `PATCH /channels/:id` `{ displayName, purpose }` | Rename the channel and/or set its purpose. Channel owner or admin, or Management. Not for a direct message. |
| `POST /channels/:id/archive` | Hide the channel for everyone; messages are kept. Channel owner or admin, or Management. Not General, not a direct message, not while a call is live. |
| `POST /channels/:id/members` · `DELETE /channels/:id/members/:userId` | Add or remove members. Removing needs channel admin. |
| `POST /channels/:id/read` | Mark read. |
| `PATCH /channels/:id/notify` | Per-channel notification level. |
| `GET /channels/browse` · `POST /channels/:id/join` | List public channels; join one. |
| `GET /channels/:id/messages` | A page of messages, oldest first (50 by default, 100 at most). No cursor: the newest page. `before=<cursor>`: the page older than it. `after=<cursor>`: the page newer than it, with `hasNewer`. `around=<message id>`: a window around one message. Every message carries its own `cursor`. |
| `POST /channels/:id/messages` | Send. Limit: 1 per second per person. |
| `PATCH /messages/:id` · `DELETE /messages/:id` | Edit own message; delete own, or any as a channel admin. |
| `GET /messages/:id/thread` | A thread: the root and its replies. |
| `GET /channels/:id/pins` · `POST /messages/:id/pin` · `DELETE /messages/:id/pin` | Pinned messages, 50 per channel at most. |
| `POST /messages/:id/reactions` · `DELETE /messages/:id/reactions/:emoji` | Reactions (emoji up to 8 characters). |
| `POST /channels/:id/upload` | Upload up to 5 files of 20 MB each, with an optional caption. Limit: 5 uploads per minute per person. |
| `GET /channels/:id/files` | Files shared in a channel. |
| `GET /files/:id/download` · `GET /files/:id/thumb` | The file, or its thumbnail. Channel members only. |
| `GET /search?q=&channelId=&page=` | Message search, 20 results per page (see 9.4). |
| `GET /push/key` · `POST /push/subscribe` · `POST /push/unsubscribe` | Web Push set-up. |
| `GET /calls/ice` | STUN and TURN servers with a time-limited credential. |
| `POST /channels/:id/calls` | Start a call. |
| `GET /channels/:id/calls/active` · `GET /channels/:id/calls` | The live call, if any; call history. |
| `GET /calls/:id` · `POST /calls/:id/join` · `/leave` · `/decline` · `/screen-share` | Call actions. |
| `POST /calls/:id/participants/:userId/mute` · `/remove` **(Phase 5)** | Host only: mute or remove one person in the call. |
| `POST /calls/:id/join-requests` · `DELETE /calls/:id/join-requests` **(Phase 5)** | A removed person asks the host to come back, or stops waiting. |
| `POST /calls/:id/join-requests/:userId` `{ accept }` **(Phase 5)** | Host only: let a waiting person back in, or refuse. |
| `POST /calls/:id/invite` `{ user_id }` · `DELETE /calls/:id/invite/:userId` **(Phase 9)** | Someone in the call rings another person into it; the person who rang, or the host, takes it back. |
| `POST /calls/:id/merge` `{ into_call_id }` **(Phase 9)** | A person in a call who is being rung one-to-one brings that caller into their call. |
| `POST /users/me/avatar` · `DELETE /users/me/avatar` · `GET /users/:id/avatar` **(Phase 9)** | Profile photo: save (one picture, 2 MB at most, five a minute), remove, fetch. |
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
| `call_reaction { call_id, emoji }` · `call_hand { call_id, up }` **(Phase 9)** | A reaction (five in three seconds at most) or a raised hand, from the tab that is in the call. |
| `call_wb { call_id, op }` **(Phase 9)** | A whiteboard change: `stroke` (new, or more points), `undo` (own stroke), `clear` (host). |
| `call_rec { call_id, on }` **(Phase 9)** | The host says recording started or stopped. |
| `call_bo_set { call_id, groups }` · `call_bo_start` · `call_bo_end` **(Phase 9)** | Host only: the arrangement of breakout groups, opening them, bringing everyone back. |

**Server → browser**

| Event | Meaning |
|---|---|
| `ready` | Handshake complete. |
| `session_ended { reason }` | The session is no longer valid (`token_invalid` or `chat_not_enabled`); the app signs out. |
| `new_message`, `message_edited`, `message_deleted` | Message changes. |
| `message_pinned`, `message_unpinned`, `reaction_added`, `reaction_removed` | |
| `typing` | Someone is typing. Shown for 5 seconds. |
| `unread_update { channel_id, unread_count, mention_count }` | Badge changes for this person. |
| `member_added`, `member_removed`, `channel_updated`, `channel_archived` | Membership and channel changes: joined, left or removed, renamed, archived. |
| `user_online`, `user_offline`, `user_away`, `user_status` | Presence and status. |
| `call_started`, `call_participant_joined`, `call_participant_left`, `call_ended`, `call_dismissed` | Call lifecycle. |
| `call_muted_by_host`, `call_removed` **(Phase 5)** | The host muted this person (sent to their call tab) or removed them (sent to all their tabs). |
| `call_join_request`, `call_join_request_cancelled` **(Phase 5)** | To the host: someone asks to come back, or stopped waiting. |
| `call_join_answer { accepted, reason }` **(Phase 5)** | To the person who asked: let in, refused, or the host left. |
| `call_screen_share_started`, `call_screen_share_stopped` | Screen share. |
| `webrtc_signal { call_id, from_user_id, signal_data }` | Call set-up message from another participant. |
| `user_updated { user_id, avatar_url }` **(Phase 9)** | Someone changed or removed their profile photo. |
| `call_host_changed { host_user_id }` **(Phase 9)** | The host of the call changed (the starter left, or came back). |
| `call_reaction`, `call_hand_changed` **(Phase 9)** | A reaction to float up the screen; a hand went up or down. |
| `call_invited`, `call_invite_pending`, `call_invite_ended { reason }`, `call_merge { join_call_id }` **(Phase 9)** | Ringing a person into a call: to that person; to the call (the "Ringing…" tile); the ring is over (`cancelled`, `timeout`, `declined`); and "join this call instead" to a caller who was merged. |
| `call_wb { from_user_id, op }` **(Phase 9)** | A whiteboard change by someone else (or `full`: the board holds 2,000 strokes and took no more). |
| `call_rec_changed { on, by }` **(Phase 9)** | Recording started or stopped. Everyone in the call is told. |
| `call_bo_state { active, groups }` **(Phase 9)** | The breakout groups as they are now. |

---

## 9. Features in detail

### 9.1 Channels and direct messages

- **Public** channels can be browsed and joined by anyone with chat access. **Private** channels are by invitation. **Direct messages** are between exactly two people (members cannot be added). **Group** conversations are `group_dm`.
- Channel names are turned into a unique slug; creating needs a name.
- A direct message cannot be opened with yourself, or with someone you are blocked from messaging.
- A private channel cannot be created, or added to, with two people who are blocked from sharing private channels.
- The sidebar has two sections, Channels and Direct messages, each foldable; the folded state is kept in the browser (`chat.collapsed`). The last open channel is remembered (`chat_last_channel`).
- **Housekeeping** (Details → Options). The owner, a channel admin or Management can **rename** a channel and set its purpose (name up to 80 characters, purpose up to 250), and **archive** it. An archived channel disappears from everyone's list at once; its messages stay in the database, but nothing in it can be read or posted. Anyone can **leave** a channel, after a "Yes, leave" confirmation. Nobody leaves General (everyone is always in it) or a direct message. A private channel whose last member leaves is archived. Renames and archives are written to `audit_log`. There is no un-archive button; it is one database update if ever needed.

### 9.2 Messages

- Plain text, up to **4,000 characters**. HTML tags are removed and their text kept ("3 < 5" stays as written). Trailing spaces and runs of spaces are tidied. **Code is the exception:** a fenced block and `inline code` are stored exactly as typed.
- **Formatting** (shown when the message is drawn, never stored as HTML): `**bold**`, `` `code` ``, fenced code blocks, lists (lines starting with `-`, `*` or `1.`), and web addresses as links. Links are `http` and `https` only, open in a new tab, and pass no referrer. A full stop or bracket after an address is not part of it. Code: `web/src/utils/richText.ts` (pure parser) and `web/src/components/messages/RichText.tsx`.
- **Edit** your own message (shows as edited). **Delete** is soft; a channel admin can delete anyone's message, and that is written to `audit_log`.
- **Reply** quotes one message. **Threads** hang replies off a root message and open in a side panel.
- **Reactions:** any emoji, one per person per emoji.
- **Pins:** up to 50 per channel, shown in a bar at the top.
- **Mentions:** `@Full Name`, `@FirstName` (only when that first name is unique in the channel), `@all`, `@channel`. Longest names are matched first, so "@Ann Agent" is not read as "@Ann". The input offers an autocomplete list.
- **Paging and the window.** The newest 50 load first. Scrolling up loads older pages; in old history, scrolling down loads newer ones. The page never holds more than **400 messages of one channel**: past that, the far end is let go and fetched again if the person scrolls back. What is being read stays exactly where it is on screen while pages come and go. Channels that are not open keep only their newest page. Jumping to a message from search or a pin loads the messages around it and highlights it.
- **Sending limit:** one message per second per person. Enter sends by default (a preference).

### 9.3 Files

- Up to **5 files per message, 20 MB each**.
- Allowed types: JPEG, PNG, GIF, WebP, SVG, PDF, Word, Excel, PowerPoint, CSV, plain text, ZIP, MP4, WebM.
- Stored under `CHAT_UPLOADS_DIR` (`/data/chat-uploads` on the server), in a folder per channel, under a generated name. File names are cleaned and sent back with a safe `Content-Disposition`.
- Images get a 200-pixel-wide JPEG **thumbnail** (`sharp`). Clicking opens a full-size view.
- Files are fetched with the sign-in token and shown from memory; only channel members can fetch them. An SVG is never served as an image (it can carry script); it downloads instead.
- **(PR #9)** The content must match the type: a real JPEG, PNG, PDF and so on is recognised by its first bytes. A program renamed to `photo.jpg` is refused with code `file_content`.

### 9.4 Search

**Before Phase 5:** PostgreSQL full-text search (`to_tsvector('english', content)`, GIN index), limited to channels the person is in, ranked by relevance then date, 20 results per page. It matched whole English words in message text only.

**What was wrong.** The button was reported as not working. The server log showed that every search people made returned nothing: they typed part of a word ("Syste") or a person's name ("System Administrator"), and neither can match whole words in message text.

**(Phase 5) What search does now.** One box finds three things:

- **Messages.** A message matches when every word typed appears in its text or in its sender's name. Part of a word counts, and letter case does not matter (`ILIKE`, with `%`, `_` and `\` in the query taken literally). The full-text match is kept as well, so "invoices" still finds "invoice". **Newest first.** At most 8 words are used. The excerpt is cut around the first match and the typed text is highlighted. Three indexes keep this fast on a large table: a trigram index on the text, an index by sender, and an index by time.
- **People.** Matched by name in the browser from the list already loaded. Choosing one opens the conversation with them.
- **Channels.** Matched by name in the browser from the channels the person is in. Choosing one opens it.

A name that starts with what was typed is listed before one that only contains it; five of each at most. "This channel only" narrows to messages in the open channel. Code: `server/src/models/search.model.js`, `server/src/utils/searchText.js`, `web/src/utils/quickFind.ts`, `web/src/components/channel/SearchPanel.tsx`.

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

**Shape.** A full mesh: each browser holds one WebRTC connection to every other participant. Up to **50 people** (raised from 8 on 6 Oct 2026; a full mesh strains well before that, so expect trouble past 15–20 on ordinary machines and connections). Voice only (no camera, by decision), with echo cancellation, noise suppression and automatic gain.

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

**(Phase 5) Host controls.** The host is the person who started the call, and only while they are in it themselves. Everyone sees a "host" tag beside that person.

- **Mute.** The host presses mute beside a person. The server tells that person's call tab (`call_muted_by_host`), which switches its microphone off and shows "… muted you. You can unmute yourself." The host has no unmute: there is no such request on the server.
- **Remove.** Asked twice ("Remove? Yes / No"). The person leaves the call and is told why. The others close their connection to them, and the server stops passing their set-up messages, so they cannot stay connected. Not offered in a one-to-one call, where leaving does the same.
- **Coming back.** A removed person's Join button reads "Ask to join". Pressing it sends a request; they see "Waiting for the host to let you back in…" with Cancel. The host sees "… asks to rejoin" with Let in and Refuse. Let in lifts the removal and the person's browser joins on its own. After a refusal they must wait 60 seconds before asking again.
- **Disconnected is not removed.** Someone who left or lost their connection joins back with no request.
- **Host gone.** If the host leaves while the call goes on, nobody has host controls. A removed person cannot be let back in, and anyone waiting is told so. If the host comes back they are the host again and see who is still waiting.
- **Where it lives.** In the server's memory for the life of the call (`server/src/services/calls/host.controls.js`), like the call devices. A new call starts clean.
- **Limit to know.** Mute is carried out by the muted person's own browser. A person using the normal app cannot avoid it; the server cannot silence audio that travels directly between browsers.

### 9.9 Screen sharing

- One person shares at a time ("Someone is already sharing").
- Uses exactly one video channel per connection, reused for every share, so starting and stopping does not renegotiate from scratch.
- The share is tied to the call device; stopping the browser's own "stop sharing" bar ends it.
- Viewers can go **full screen** or **open the shared screen in its own window**.
- On wide screens the call panel docks on the right and the page makes room.

**(Phase 5) Own-screen preview.** The person sharing sees their own shared screen, small, in the call panel, with "This is what the others see". It plays the capture that is already running, so nothing extra is sent.

### 9.10 Admin panel (Management only)

- **People:** everyone, their role, whether chat is switched on for them, who is online, and how many people they are blocked from or by. Filters and search.
- **One person's access:** a row per colleague with three ticks — Messages, Calls, Private channels. Saved in one request. Blocking all three is stored as one `all` row; otherwise one row per kind. Every change is written to `audit_log`.
- **Restrictions list:** every block in force, with who set it and why; add and remove.

A restriction applies when opening a direct message, calling, and creating or adding to a private channel. **Known gap:** it does not remove two people from a private channel they already share.

### 9.11 Settings

Per person: notification level, sound on or off, Enter-to-send, status message. Stored in `chat.user_preferences`.

### 9.12 The new design and call features (Phase 9, live since 5 Oct 2026)

Built from the owner's `Updates/` file. The prototype in `Updates/chat-app-redesign-v2.html` is the design reference.

**Design.** Colours are tokens in `web/src/styles/tokens.css`; `theme.css` holds dark mode and the five accents (violet, ocean, sunset, emerald, magenta). The choice is on `body[data-mode]` and `body[data-accent]`, stored per person in `chat.user_preferences.theme` as `{"mode","accent"}`, kept in the browser too and applied by `public/theme-boot.js` before the page draws. The font (Inter) is served by the chat itself.

**Profile photos.** JPEG, PNG or WebP up to 2 MB, checked by content, cut to a square and stored as a 256×256 JPEG under `uploads/avatars/`. The web app shrinks and crops before sending. Everyone's screen updates through `user_updated`.

**Call screen.** `components/calls/CallScreen.tsx`: a full-screen stage with one tile per person (`CallTile`), the dock (`CallDock`), and a minimised pill. Speaking is measured in the browser from each audio track (`hooks/useSpeaking.ts`). The host is the starter while in the call, otherwise whoever has been in it longest.

**Incoming call.** A card with a 30-second countdown: Accept, Decline, Message. Message declines and posts the chosen words into the direct conversation with the caller. The card also shows over a call the person is already in.

**Add to call.** Anyone in a call can ring another person into it. Checked: the call is live; people in it plus people being rung stay within 8; the person can use chat; no call restriction either way. The person rings for 30 seconds; the call shows a "Ringing…" tile; a "Join my call" message (type `call`, `metadata.kind = call_invite`) is posted into the direct conversation between the two and works until the call ends. Someone from outside the call's channel joins the call only: they never get the channel's messages.

**Merge.** A person in a call who is rung one-to-one can accept and bring the caller in: the one-to-one ring ends ("Call joined to a call already going on") and the caller's tab joins the other call by itself. A one-to-one call that grew to three or more goes on until one person is left.

**Whiteboard.** One board per call. **Only the host draws** (changed 5 Oct 2026 on the owner's word; the server refuses anyone else); everyone in the call sees it. Strokes are lists of points given as fractions of the board, so they land in the same place on every screen. The board is larger than the screen: the host moves it with Ctrl + drag, the hand tool or the scroll wheel, and zooms from 25% to 400% with Ctrl + scroll or the − and + buttons; everyone else's view follows the host's (they can look around themselves until the host next moves). Strokes are sent in batches about ten times a second, relayed by the server, and kept in memory (2,000 at most) with the host's view, so a late joiner sees the board as it is. Undo takes back the host's own latest stroke; clear wipes the board and puts the view back. Nothing is stored; the board is gone when the call ends.

**Recording.** Host only. Made in the host's browser: every voice is mixed into one track (plus the shared screen, if one is being shared when recording starts) and written as WebM. Everyone sees a REC pill and is told, including people who join meanwhile. When recording stops, or the host leaves or is cut off, the file is uploaded into the call's conversation as "Call recording" (`metadata.kind = call_recording`). Limits: closing the host's tab loses it; 20 MB at most (about 80 minutes of voice), then it stops and saves by itself.

**Breakout groups.** Host only: up to six named groups; anyone not in a group stays in the main room with the host. The server keeps the arrangement and tells the call. The separation of sound is done by each browser: it takes its microphone off the connection to everyone outside its room (`CallManager.setRoom`), which needs no new call set-up and means those people receive no sound at all. People can be moved while groups are open. Screen sharing and the whiteboard are refused while groups are open. Someone who leaves the call leaves their group; when nobody is left in any group, the groups close.

---

### 9.13 Who is offered, adding people, passwords, and the Mattermost copy (6 Oct 2026)

**Only people who have signed in.** Wherever a person is picked (new message, new channel, add people, add to call), the list holds only people who have signed in to the chat at least once: those with a row in `chat.user_presence`, written when they first connect. Admin → People shows when each person last used the chat, or "Never signed in".

**Add people.** A channel's details panel has an Add people row (anyone in the channel may; private channels still apply the sharing restrictions). `POST /channels/:id/members`.

**Set a password.** Management and IT may open Admin → People (IT see no restrictions tab and no access table) and set a person's password from their page. The chat forwards `PUT /api/chat/admin/users/:id/password` to the CRM's `PUT /api/users/:id/password` with the caller's own session; the CRM applies its password rules, signs the person out everywhere and writes its audit. Nobody sets their own password here. Until the CRM has that route (CRM pull request #734), the chat answers "The CRM does not offer this yet".

**Mattermost copy.** `node server/dev/import-mattermost.mjs` (dry run) and `--commit`, run on the server with `MM_DATABASE_URL`, `MM_FILES_DIR` (a copy of Mattermost's data folder) and `IMPORT_ACTOR_ID` set. Rules (the owner's, 6 Oct 2026): only people who signed in to Mattermost and have a CRM account with the same email; public and private channels, and one-to-one conversations where both people qualify (group conversations not yet); no messages from bots or automations; files over 20 MB or of a type the chat does not take are left out; Town Square lands in General and Off-Topic is skipped; copied conversations start as read. Messages keep their original dates, threads, pins, edits, files and reactions. `chat.import_map` (database file `chat_006`) remembers what was copied, so the script can be run again and copies nothing twice. Nothing is written in a dry run.

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
- **Staying light.** The message list (`MessageFeed`) and each message (`Message`) are wrapped in `memo`, and every callback passed to them is kept stable, so a keystroke, a presence change or one new message does not redraw the messages already on screen. The window rules are in `utils/messageWindow.ts`; the state keeps at most 400 messages for the open channel and 50 to 100 for the others.
- **Styles:** plain CSS in 12 files, one per area. Every colour and size is a variable in `tokens.css`; `theme.css` loads last.
- **Design:** accent violet `#6C4DE6`; sidebar deep indigo `#1B1F3A`; online green `#22C55E`, away amber `#F59E0B`, attention red `#DC2626`. System font, 14 px base, 16 px in inputs so phones do not zoom. Sidebar 240 px. Below 768 px wide the layout becomes a single column. Full list in `Design.md`.
- **Build:** `tsc --noEmit && vite build` → `web/dist` (about 385 KB of script, 119 KB compressed; 23 KB of CSS). Served by the chat server itself, cached for 1 hour except the service worker.

---

## 11. Security

**Live**

- Every API route requires a valid CRM session; admin routes require Management.
- Sessions are re-checked against the CRM's user table on every request and every 60 seconds on a live connection.
- All SQL uses parameters. No user input is ever placed in query text.
- One error handler; server faults reveal nothing ("Something went wrong").
- Message content is plain text with tags removed. Formatting and links are built on screen from text pieces, never from HTML, so nothing typed in a message can run as code. Links are `http`/`https` only.
- Files: type allowlist, size and count limits, cleaned names, members-only downloads, SVG never rendered.
- Request body limit 64 KB. `X-Powered-By` removed. CORS is off unless origins are listed.
- Push subscription endpoints are validated (https only, a public host, never localhost or a private address) and capped at 10 per person.
- Call set-up messages are capped at 64 KB and only relayed between participants of the same call.
- The settings file on the server is readable by its owner only and holds only what the chat needs. No secret is in the repository, which is public.

**(PR #9), live since 1 Oct 2026, 16:22**

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
| Messages of one channel kept on the page | 400 |
| Search results per page | 20 |
| Pins per channel | 50 |
| People in a call | 8 |
| Ring time | 30 seconds |
| Wait before a refused person may ask the host again **(Phase 5)** | 60 seconds |
| Words used from one search **(Phase 5)** | 8 |
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

Fixed in code: ring time 30 s, 50 people per call, call reconnect grace 10 s, wait before asking the host again 60 s, presence grace 5 s, digest hour 08:00 UTC, TURN credential 12 h.

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
| Server | `cd server && npm test` | 478, 49 files |
| Web | `cd web && npm test` | 176, 23 files |
| Types | `cd web && npx tsc --noEmit` | clean |
| End to end (API) | `node server/dev/e2e/api-smoke.mjs` | 13 |
| Real browser: notifications | `node server/dev/e2e/browser-notify.cjs` | 10 |
| Real browser: calls and screen share | `node server/dev/e2e/browser-calls.cjs` | 14 |
| Real browser: layout | `node server/dev/e2e/browser-polish.cjs` | 5 |
| Real browser: admin panel | `node server/dev/e2e/browser-admin.cjs` | 7 |
| Real browser: search, own-screen preview, host controls | `node server/dev/e2e/browser-host.cjs` | 16 |
| Real browser, **real screen**: a two-person call sharing the PC's actual screen (opens a window; needs a desktop) | `node server/dev/e2e/browser-real-share.cjs` | 1 |
| Real browser: links, formatting, channel rename, leave and archive | `node server/dev/e2e/browser-features.cjs` | 12 |
| Real browser: the new design (themes, panels, messages) **(Phase 9)** | `node server/dev/e2e/browser-redesign.cjs` | 17 |
| Real browser: profile photos **(Phase 9)** | `node server/dev/e2e/browser-avatars.cjs` | 6 |
| Real browser: the call screen, reactions, hands, stand-in host **(Phase 9)** | `node server/dev/e2e/browser-callscreen.cjs` | 11 |
| Real browser: incoming-call card, add to call, merge **(Phase 9)** | `node server/dev/e2e/browser-invite.cjs` | 9 |
| Real browser: whiteboard **(Phase 9)** | `node server/dev/e2e/browser-board.cjs` | 7 |
| Real browser: recording (the saved file is played back) **(Phase 9)** | `node server/dev/e2e/browser-record.cjs` | 4 |
| Real browser: breakout groups (checked on the real audio connections) **(Phase 9)** | `node server/dev/e2e/browser-breakout.cjs` | 7 |
| Real browser: add people, the signed-in rule, Management or IT setting a password | `node server/dev/e2e/browser-people.cjs` | 5 |
| Speed with heavy data (needs `SEED_HEAVY=1`) | `node server/dev/e2e/browser-perf.cjs` | 31 measurements |
| Deploy scripts | `bash deploy/rehearse.sh` | 51 |

- Server tests run the real SQL against PGlite, which uses the same `user_role` enum as the CRM, so a missing `::text` cast is caught.
- The browser checks drive the Microsoft Edge already installed on the PC, with fake microphone and screen-capture devices, two or three signed-in people at once. `browser-real-share.cjs` is the exception: it captures the real screen, to prove the security headers do not block sharing.
- Each end-to-end script needs a freshly started local chat.

---

### Speed with heavy data

The owner's requirement (1 October 2026): the chat must stay light, with no freezing, however long the channels get. It is measured, not assumed.

```
SEED_HEAVY=1 node server/dev/local.mjs      # 100,000 messages in one channel, 300 more channels, 120 more people
node server/dev/e2e/browser-perf.cjs        # 31 measurements, each with a limit; fails if one is broken
```

| What was measured | Before | After |
|---|---|---|
| Open the 100,000-message channel | 0.4 s | 0.3 s |
| Scrolled back 2,000 messages: messages kept on the page | 2,050 | 400 |
| Page elements at that point | 59,668 | 13,681 |
| Memory used by the page | 124 MB | 14 MB |
| Longest freeze while scrolling back | 467 ms | 67 ms |
| Longest freeze while typing, with all that loaded | 450 ms | 17 ms |
| Longest freeze when 12 messages arrive | 500 ms | 33 to 50 ms |
| Search for part of a word | 677 ms | 15 ms |
| Search for a person's name | 848 ms | 17 to 27 ms |
| Channel list with 301 channels | 47 ms | 47 ms |

Measured on the developer PC against the in-memory test database, which is slower than the real one. Files were already light: the list shows small thumbnails only, and a document is fetched only when someone presses download.

**Run the speed check again after any change to the message list, the message state, paging or search.**

---

## 16. Known issues and not built

**Known small issues**

- Accepting the same call in two tabs at once can make both drop out.
- Signing out during a call is tidied up by the server after 10 seconds, not at once.
- A new restriction does not remove two people from a private channel they already share.
- `addRestriction` in `models/restrictions.model.js` still checks its own input; those checks belong in `services/access.service.js`.

**Live since 1 Oct 2026, 16:22, waiting for the owner to try (Phase 5):** the search fix, the own-screen preview and the call host controls. Sections 9.4, 9.8 and 9.9 describe them.

**Real screen sharing under the security headers** was checked on 1 October 2026 with `browser-real-share.cjs`: the other person saw the real desktop. The browser prints a "camera is not allowed" notice when a share starts; that is the header refusing the camera, which the chat never uses, and it does not affect sharing.

**Approved by the owner, not built yet:** the CRM's automatic messages posted into the chat, so Mattermost can be switched off (Phase 8). A survey found about 150 places in the CRM that post to Mattermost, through about 25 separate pieces of sending code, with no buttons anywhere. It needs the owner's decisions on channels before work starts.

**Waiting on others (Phase 6):** router port forwarding for calls from outside the office — ports 3478 (UDP and TCP) and 49160–49200 (UDP) to the server.

**Only on the owner's word:** the chat inside the CRM, moving the CRM's automatic messages off Mattermost, importing Mattermost history, phone install.

**Live since 5 Oct 2026, 16:56, waiting for the owner to try (Phase 9):** everything in the owner's `Updates/` file. See section 9.12.

**Decided against (owner, 1 October 2026):** camera video; any paid service; "seen" marks on direct messages; a "mute everyone" button; an audit screen; importing old Mattermost conversations; installing the chat as an app. (Dark mode and a stand-in host were on this list; the owner's file of 5 October asks for both, and they are built.) Link previews are also out: the server would have to fetch outside web pages.

---

## 17. History

| When | What |
|---|---|
| 28–29 Sep 2026 | Text chat, rich messaging, the access switch, restrictions, browse and join. Built inside the CRM repository. |
| 30 Sep 2026 | Presence, notifications, voice calls, screen sharing. Chat removed from the CRM's menu; chat2 only. Layout improvements. Admin panel. |
| 1 Oct 2026 | Three call fixes and the colour theme. Chat moved to this repository (pull requests #1–#3). Code reshaped to the folder structure (#4). Own deploy script, settings file and server folder; chat2 switched to `/opt/chat` (#5–#8). Security items built and merged (#9), not deployed yet. |
| 1 Oct 2026 (later) | Phase 5 built (#11): search finds part of a word, people and channels; the sharer sees their own screen; call host controls. Deployed with the security items at 16:22. |
| 1 Oct 2026 (evening) | Phase 7: kept light with very long channels (measured with 100,000 messages), clickable links, simple formatting, channel rename, leave and archive. Deployed at 17:34 with one new database file (indexes). |
| 5 Oct 2026 | Phase 9: the new design (light and dark, five accents), profile photos, the new call screen, incoming-call card, add to call and merge, whiteboard, recording, breakout groups. Deployed to chat2 the same day at 16:56. |
