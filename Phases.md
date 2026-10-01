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

## Phase 3 — Reshape the code to the rules ✅

**Goal:** the code follows the folder structure in `Architecture.md` and the code-quality rules.

- **Server:** split into routes, controllers, services, models, middleware, sockets, config, utils.
- **Web app:** split into pages, components, hooks, context, services, utils, types, config, styles.
- **Styles:** split the one large CSS file into files by area.
- Remove dead code and leftovers. Remove the unused CRM-embedding remains.

**Behaviour does not change.** Done in small steps, with tests run after each.

**Done when:** every file sits in the right folder, all tests and browser tests pass, and the app behaves the same. *Done 1 October 2026: 353 server tests, 107 web tests, 13 end-to-end checks and 36 browser checks pass; before/after screenshots match. Four files stay long on purpose; `Memory.md` lists them with the reason.*

---

## Phase 4 — Switch the server to this repository ⏳ (in progress)

**Goal:** chat2 runs from this repository, and chat deploys no longer touch the CRM.

Steps, in order:

1. ✅ **Deploy files in this repository:** deploy script, process settings, server notes, and a script to apply database changes. Rehearsed locally (43 checks).
2. ✅ **The switch on the server** (1 October 2026, 11:48): this repository is in `/opt/chat` with its own settings file, built there, and the chat process now runs from it. The chat was down for about 2 seconds. Nobody was on a call.
3. ✅ **CRM repository, part 1** (pull request #619 in `CRM-Finalised`, merged and on the server since 1 October 2026): the chat step is out of the CRM's deploy script and the chat process is out of its process list.
4. ⏳ **CRM repository, part 2:** delete the `chat-server/` and `chat-ui/` folders and the chat database files from the CRM repository. Done after the owner has checked chat2.

**Needs:** the owner's "go".

**Done when:** chat2 works from the new folder and the owner has checked it.

---

## Security items from the checklist review ✅ (built and deployed 1 October 2026)

Done outside the numbered phases, at the owner's request ("implement all other", MFA later):
per-person IP restriction, upload content checks, security headers, a general request limit, and the mail library upgrade. Details in `Memory.md`.

**Done when:** deployed on the owner's word ✅, and chat2 still works for sign-in, messages, files and calls (the owner's check).

---

## Phase 5 — The three requested items ▶ (deployed 1 October 2026, 16:22; waiting for the owner to try them)

1. ✅ **Search button:** the cause was found in the server log. Every search returned nothing, because search only matched whole words inside message text, and people typed part of a word or a person's name. Fixed: part of a word now matches, a person's name finds what they wrote, and the same box also finds people and channels.
2. ✅ **Own screen preview:** the person sharing sees their own shared screen in the call panel.
3. ✅ **Call host controls:** the person who started the call can mute others and remove them. The host cannot unmute anyone.

**Decided by the owner (1 October 2026):**
- A person who was disconnected can join back freely.
- A person the host removed sends a join request when they try to come back. The host accepts or refuses it.

**Also decided while building (say if any should change):**
- Removing asks "Remove? Yes / No" first, so one stray click cannot remove someone.
- Remove is not offered in a one-to-one call (leaving does the same).
- After a refusal the person waits one minute before asking again.
- If the host leaves and the call goes on, nobody has host controls, and a removed person cannot come back. The host is the host again when they return.

**Done when:** each works locally in the browser tests ✅ (16 of 16), is deployed ✅, and the owner has tried it.

---

## Phase 6 — Calls from outside the office ⏳

- The server team adds three port-forwarding rules on the office router (message already written for them).
- Test a call between someone in the office and someone on mobile data.

**Done when:** an outside call connects with audio and screen share.

---

## Phase 7 — Lightweight, links, formatting, channel housekeeping ▶ (deployed 1 October 2026, 17:34; waiting for the owner to try)

The owner chose these on 1 October 2026 and asked that the chat stay light however long the channels get.

1. ✅ **Lightweight.** Measured first with 100,000 messages, 300 channels and 120 more people. Scrolling far back used to leave 60,000 elements on the page and freeze typing for up to 450 ms a key. Now the page keeps at most 400 messages of a channel and pages in both directions; the longest freeze is under 70 ms; search answers in 15 to 30 ms instead of 0.5 to 0.85 s. A speed check with limits is part of the repository.
2. ✅ **Clickable links.** Web addresses in messages open in a new tab.
3. ✅ **Simple formatting.** `**bold**`, `` `code` ``, code blocks, and lists.
4. ✅ **Channel housekeeping.** Rename, leave, archive (Details → Options).

**Decided while building (say if any should change):**
- Search results are newest first.
- Nobody can leave General. A private channel whose last member leaves is archived.
- Archiving hides a channel for everyone and keeps its messages. There is no un-archive button yet.
- Leaving and archiving both ask "are you sure" first.

**Done when:** it works locally in the browser tests ✅ (12 of 12, speed check 31 of 31), is deployed ✅, and the owner has tried it.

---

## Phase 8 — The CRM's automatic messages in the chat ⏳ (approved 1 October 2026; needs the owner's decisions before work starts)

**Goal:** every automatic message the CRM posts to Mattermost goes to this chat instead, so Mattermost can be switched off.

**What the survey found** (kept locally in `Tasks/CRM-Mattermost-Survey.md`):
- About **150** places post an automatic message, not forty. About 125 are in programs that are running.
- **No buttons anywhere.** 13 places post a coloured card; 2 send a direct message to a person; the rest are plain text to a channel.
- About **25** separate pieces of sending code. There is no single helper.
- Mattermost is also used for sign-in, user accounts, presence, embedded chat pages in the CRM, the FOS hub chat and the "Nova" agent. Those are a separate job from the messages.

**Proposed steps:**
1. **Chat side:** a way for the CRM to post as a named bot with its own key: text, a simple card, a channel by name, or a direct message to a person by email.
2. **CRM side:** one helper that every one of the 150 places calls, replacing the 25 implementations. It posts to Mattermost, to the chat, or to both, by a switch.
3. **Run both** for a while and compare, channel by channel. Then switch Mattermost posting off.

**Needs from the owner:** which chat channel each Mattermost channel becomes (about 30 targets); whether to run both side by side first; and whether sign-in, the embedded pages and the Nova agent are part of this phase or a later one.

---

## Later — only on the owner's word 🔒

| Item | Note |
|---|---|
| Show the chat inside the CRM | When the owner says the chat is finished. |
| Import old Mattermost conversations | Maybe. |
| Install on phones | Maybe not needed. |

## Known small issues, to schedule

- Accepting the same call in two tabs at once can make both drop out.
- Signing out during a call does not record the leave immediately; the server tidies up after 10 seconds.
- Host mute is carried out by the muted person's own browser; the server cannot silence audio that travels directly between browsers.
- A restriction added between two people does not remove them from a private channel they already share.
