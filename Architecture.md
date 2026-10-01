# Architecture

How the chat is built, how the parts talk to each other, and where every file belongs.

## 1. The big picture

```
 Staff browser ──HTTPS──► Cloudflare ──► nginx (office server) ──► chat server (port 5020)
      │                                                                 │
      │  live updates (WebSocket)                                       ├─► Postgres database (schema "chat")
      │                                                                 ├─► Redis (live-update fan-out)
      │                                                                 └─► CRM (sign-in check only)
      │
      └──── voice + screen share go DIRECTLY to the other person's browser
            (through our own relay only when a direct path is impossible)
```

Three ideas to hold on to:

1. **One small server.** It stores messages, checks who is allowed, and pushes live updates.
2. **The CRM is only asked "is this person allowed in?"** People sign in with their CRM login. Chat keeps no passwords.
3. **Calls bypass the server.** The server only introduces the browsers to each other. Audio and screen share never pass through it.

## 2. Technical stack

| Part | Technology | Why |
|---|---|---|
| Server | Node.js 20, Express 4 | Same as the CRM, so the team already knows it. |
| Live updates | Socket.IO 4 with Redis | Instant delivery of messages, presence and call events. |
| Database | PostgreSQL, schema `chat` | The CRM's database server, in its own schema. No new database to run. |
| Web app | React 18, TypeScript, Vite | Small, fast, typed. |
| Icons | lucide-react | One icon set, already in use. |
| Files | Stored on the server disk, thumbnails by `sharp` | No cloud storage needed. |
| Push notifications | Web Push (`web-push`, VAPID keys) | Free; uses the browser makers' own push services. |
| Calls | WebRTC, built into browsers | No library and no media server. |
| Call relay | coturn on our own server | Free, self-hosted. Used only when two browsers cannot connect directly. |
| Tests | Node's built-in test runner, PGlite (real Postgres in memory), Playwright with Edge | Free, fast, no extra services. |

No paid service appears anywhere in the stack.

## 3. How the main flows work

### 3.1 Signing in
1. The person types their CRM email and password on chat2.
2. The chat server passes them to the CRM, which answers with a session token.
3. Every later request carries that token. The chat server checks it and checks the person is approved, active, not locked, and switched on for chat.
4. Live connections are re-checked every minute, so a revoked person is dropped quickly.

### 3.2 Sending a message
1. The browser sends the message to the server.
2. The server checks membership and restrictions, saves it, and records any @mentions.
3. The server pushes it to everyone in that channel who is connected.
4. People in the channel with no chat tab open get a push notification, if their settings allow.

### 3.3 A call
1. The caller's browser gets the microphone, then asks the server to start a call.
2. The server rings everyone in the channel.
3. Each person who accepts connects **directly** to every other person in the call.
4. The server keeps only the list of who is in the call. If one connection fails, only that one is affected.
5. When the last person leaves, the server writes a summary line into the channel.

## 4. Folder structure

This is the structure the code will follow. It applies the separation required by rule 7.

```
New Chat System/
├── PRD.md  Architecture.md  Rules.md  Phases.md  Design.md  Memory.md
├── rules.txt                  the owner's original rules
│
├── server/                    BACK END
│   ├── main.js                starts the server
│   ├── src/
│   │   ├── config/            reads environment settings (the only place that does)
│   │   ├── routes/            URL → controller. No logic here.
│   │   ├── controllers/       reads the request, calls a service, sends the reply
│   │   ├── services/          business rules: messages, calls, presence, notifications, access
│   │   ├── models/            database queries, one file per table or topic
│   │   ├── middleware/        sign-in check, error handling, rate limits, validation
│   │   ├── sockets/           live-update events (presence, typing, call signalling)
│   │   └── utils/             small shared helpers
│   ├── migrations/            database changes, numbered in order
│   ├── test/                  automated tests
│   └── dev/                   local test server and browser test scripts
│
├── web/                       FRONT END
│   ├── index.html
│   ├── public/                service worker for notifications
│   ├── src/
│   │   ├── pages/             whole screens: sign-in, chat, admin
│   │   ├── components/        reusable pieces: message, sidebar, call panel, dialogs
│   │   ├── hooks/             reusable screen logic: presence, attention, calls
│   │   ├── context/           shared state for the whole app
│   │   ├── services/          talking to the server (API client, socket)
│   │   ├── utils/             pure helpers: formatting, mentions, notification rules
│   │   ├── types/             shared TypeScript types
│   │   ├── config/            front-end settings
│   │   └── styles/            CSS, split by area (base, layout, sidebar, messages, calls, admin, theme)
│   └── test/                  automated tests
│
└── deploy/                    deploy script, process settings, server setup notes
```

### What each layer may and may not do

| Layer | May | May not |
|---|---|---|
| **routes** | Map a URL to a controller | Contain logic or database queries |
| **controllers** | Read the request, call services, shape the reply | Run SQL |
| **services** | Hold the business rules | Read `req`/`res` or write SQL |
| **models** | Run SQL | Know about HTTP |
| **middleware** | Sign-in, validation, errors, limits | Hold business rules |
| **components** | Show things | Call the server directly |
| **hooks / context** | Hold screen logic and state | Contain styling |
| **services (web)** | Call the server | Render anything |

## 5. How the code follows this structure

Since 1 October 2026 the code is in the structure above. A few points that are not obvious from the tree:

- **Server routes take their dependencies as arguments** (`createChannelRoutes({ db, emit })`). Each one builds its controller and lists its addresses. This is what lets the tests run a route against a test database.
- **Controllers may call a model directly** for a plain read. A service exists only where there is a real rule to apply (who may post, who may share a channel, access changes, calls, notifications).
- **Web components are grouped by area** inside `components/`: `layout`, `channel`, `messages`, `dialogs`, `calls`, `admin`, `common`.
- **Chat actions are grouped** in `hooks/actions/`: channels, reading, writing, people.
- **Styles are one file per area** in `styles/`. `tokens.css` holds every colour and size; `theme.css` is loaded last.
- **Four files are long on purpose.** They are listed in `Memory.md` with the reason.

## 6. Production setup

| Item | Value |
|---|---|
| Address | https://chat2.rowanroseclaims.co.uk |
| Server | Office server `192.168.1.58`, behind Cloudflare |
| Code on the server | `/opt/chat`, a copy of this repository following `main` |
| Deploy | `/opt/chat/deploy/deploy.sh` (see `deploy/SERVER.md`). It never touches the CRM. |
| Process | `chat-server`, managed by pm2 (`deploy/ecosystem.config.cjs`), port 5020 on localhost |
| Web server | nginx site `chat2` → port 5020 |
| Database | The CRM's Postgres, schema `chat` |
| Uploaded files | `/data/chat-uploads` |
| Call relay | coturn, port 3478 and ports 49160–49200 |
| Settings | `/opt/chat/.env`, the chat's own file on the server. Never stored in this repository. `deploy/env.example` lists the names. |
