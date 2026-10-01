# Phases

The project in small steps. Only one phase is worked on at a time.
A phase starts when the owner says "go" and ends when the owner has seen the result.

**Status key:** ✅ done · ▶ current · ⏳ waiting · 🔒 only on the owner's word

---

## Already done before this repository existed

Built between 28 September and 1 October 2026, inside the CRM repository. All of it is live on chat2 unless marked.

| # | What | Status |
|---|---|---|
| A | Text chat: sign-in, channels, direct messages, live delivery, unread counts | ✅ live |
| B | Rich messaging: mentions, replies, threads, pins, reactions, files, search | ✅ live |
| C | Access switch, restrictions between people, browse and join public channels | ✅ live |
| D | Presence, notification settings, desktop and push notifications | ✅ live |
| E | Voice calls and screen sharing, one-to-one and group | ✅ live |
| F | Full-screen and separate-window screen viewing, scroll only the messages, folding sidebar sections | ✅ live |
| G | Admin panel: people list and per-person contact permissions | ✅ live |
| H | Three call fixes (microphone release, long calls with many screen shares, two people answering at once) and the new colour theme | ✅ live (1 Oct) |

---

## Phase 1 — Project documents ✅

**Goal:** the five documents exist and the owner agrees with them.

- Write `PRD.md`, `Architecture.md`, `Rules.md`, `Phases.md`, `Design.md`.
- The owner reads them and asks for changes.

**Done when:** the owner approves the documents. *Approved 1 October 2026.*

---

## Phase 2 — Move the code here ✅

**Goal:** this repository holds the whole chat system, and it works on the developer's PC exactly as it does today.

- Copy the server, the web app, the database files and the local test setup into this repository.
- Start `Memory.md`.
- Run all automated tests and the browser tests locally.

**Nothing changes for staff.** The live site keeps running from the old place during this phase.

**Done when:** all tests pass from this repository. *Done 1 October 2026: 353 server tests, 107 web tests, and all end-to-end and browser checks pass from here.*

---

## Phase 3 — Reshape the code to the rules ⏳

**Goal:** the code follows the folder structure in `Architecture.md` and the code-quality rules.

- **Server:** split into routes, controllers, services, models, middleware, sockets, config, utils.
- **Web app:** split into pages, components, hooks, context, services, utils, types, config, styles.
- **Styles:** split the one large CSS file into files by area.
- Remove dead code and leftovers. Remove the unused CRM-embedding remains.

**Behaviour does not change.** Done in small steps, with tests run after each.

**Done when:** every file sits in the right folder, all tests and browser tests pass, and the app behaves the same.

---

## Phase 4 — Switch the server to this repository ⏳

**Goal:** chat2 runs from this repository, and chat deploys no longer touch the CRM.

- Put this repository on the server in its own folder, with its own deploy script.
- Point the chat process at it. A few seconds of downtime, once.
- Remove the chat folders and the chat deploy step from the CRM repository.

**Needs:** the owner's "go".

**Done when:** chat2 works from the new folder and the owner has checked it.

---

## Phase 5 — The three requested items ⏳

1. **Search button:** find why it does not work on the live site. Fix if simple, otherwise remove it.
2. **Own screen preview:** the person sharing sees their own shared screen in the call panel.
3. **Call host controls:** the person who started the call can mute others and remove them. The host cannot unmute anyone.

**Decided by the owner (1 October 2026):**
- A person who was disconnected can join back freely.
- A person the host removed sends a join request when they try to come back. The host accepts or refuses it.

**Done when:** each works locally in the browser tests, is deployed, and the owner has tried it.

---

## Phase 6 — Calls from outside the office ⏳

- The server team adds three port-forwarding rules on the office router (message already written for them).
- Test a call between someone in the office and someone on mobile data.

**Done when:** an outside call connects with audio and screen share.

---

## Later — only on the owner's word 🔒

| Item | Note |
|---|---|
| Move the CRM's automatic messages from Mattermost to this chat | About forty places in the CRM. Messages with buttons are the hard part. |
| Show the chat inside the CRM | When the owner says the chat is finished. |
| Import old Mattermost conversations | Maybe. |
| Install on phones | Maybe not needed. |

## Known small issues, to schedule

- Accepting the same call in two tabs at once can make both drop out.
- Any change in a call redraws the whole message list (wasteful, not broken).
- Signing out during a call does not record the leave immediately; the server tidies up after 10 seconds.
- A restriction added between two people does not remove them from a private channel they already share.
