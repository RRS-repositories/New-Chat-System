# Chat UI Redesign — Build Doc for Claude Code

**Design source of truth:** `chat-app-redesign-v2.html` (working prototype — open it in a browser, lift its CSS values and layout patterns directly).
**Theme bridge:** `chat-theme.jsx` (drop-in React theme layer + the CSS token block).
**Engineering contracts:** `CHAT-CODE-SPEC.md` — exact socket events, endpoints, payloads and state shapes for S4–S10. Implement those contracts verbatim; do not invent alternatives.

## Ground rules — read once, apply to every section
- Repo `RRS-repositories/New-Chat-System`, served from `/opt/chat`. Frontend: `web/src` (React 18 + TS + Vite). Server: `server/src` (Express + Socket.IO).
- This is a **reskin plus 4 new features**. Do NOT touch: auth/session, `server/src/sockets/` signalling, `web/src/services/callManager.ts` internals, `models/` SQL — unless a section explicitly says so.
- Keep the layer rules: screens/hooks never call the server directly; everything goes through `web/src/services/`.
- Product rules that stay: voice + screen share only (no camera), 8-person call cap, one sharer at a time, host can mute/remove but never unmute, removed person must request to rejoin, 10s reconnect grace.
- Deploys restart chat and kill live calls — never auto-deploy; the humans deploy off-hours.
- Work one section at a time. At the end of each section run its **Verify** checklist AND the existing suites (`server/test` 368, `web/test` 107). All green before the next section. If a check fails, fix it before moving on — do not proceed broken.

---
## S1 — Design tokens + theme system
**Goal:** every colour in the app comes from CSS variables; light/dark mode + 5 accent themes, persisted.
- Create `web/src/styles/theme.css` with the `THEME_CSS` block from `chat-theme.jsx` (it is the prototype's `:root` + `body[data-accent=…]` + `body[data-mode="dark"]` blocks, verbatim).
- Add `ThemeProvider` + `useTheme` from `chat-theme.jsx` at the app root (wrap in `App.tsx`). It sets `data-mode`/`data-accent` on `<body>` and persists to `localStorage("chatTheme")`.
- Add `<AppearanceSettings/>` into the existing user settings dialog (mode segmented control + 5 swatches, markup/classes in the jsx file).
- Migrate the 12 existing CSS files to use the new vars for surfaces/accents (search for hex values, replace with `var(--paper/--ink/--mut/--line/--violet/--grad/--violet-soft…)`). Whiteboard canvas and shared-screen content stay white regardless of mode.
**Verify:** [ ] toggling dark flips the whole workspace, no white flashes or unreadable text on any page (sign-in, chat, admin) [ ] each of the 5 swatches recolours buttons, badges, sidebar, active states [ ] choice survives a reload [ ] no hardcoded accent hex left in `web/src` outside theme.css [ ] web tests green.

## S2 — App shell reskin
**Goal:** sidebar, channel header, right panel match the prototype.
- Sidebar: gradient brand row, search bar (⌘K), section labels, unread badges, presence dots, profile card bottom with gear — exact spacing/typography from prototype `.s-*` classes.
- Channel header: name + topic, actions (call, pins, info) as `.hbtn` ghost buttons.
- Right panel (`#panel` pattern): threads / pins / details; DM details opens with the profile card (big avatar, name, status).
- Mobile: sidebar becomes an overlay drawer (burger), panel full-width — copy the prototype's `@media (max-width:760px)` rules.
**Verify:** [ ] desktop + 390px mobile both match prototype screenshots [ ] drawer opens/closes, no scroll bleed [ ] unread badges and presence render from real data [ ] web tests green.

## S3 — Messages + composer
**Goal:** message area matches prototype: grouped messages, day chips, NEW divider, hover actions (react/thread/pin/edit/delete), reactions row, file cards, typing indicator, rounded composer with attach/emoji/send.
- Reuse existing message state/actions from `context/` + `hooks/actions/` — this is styling + layout only, no behaviour changes.
- Search overlay styled per prototype `.sbox`, with jump-to-message flash.
**Verify:** [ ] send/edit/delete/react/pin/thread all still work [ ] day chips + NEW divider correct [ ] file upload renders the new file card [ ] search jump flashes the message [ ] both suites green.

## S4 — Profile photos
**Goal:** users can upload a photo; it shows on messages, sidebar, call tiles, details panel.
- Server: `POST /api/chat/users/me/avatar` (multipart, reuse existing file service + PR #9 file-signature checks; store like other uploads; add `avatar_url` to users via a new migration `chat_004`). `DELETE` to remove. Route→controller→service→model, no logic in routes.
- Client: in settings, Upload/Remove per prototype (`.ph-prev` row). Client-side square-crop to 256px JPEG before upload (canvas — code pattern is `setProfilePhoto()` in the prototype).
- Render: one `Avatar` component used everywhere — image if `avatar_url`, else initials on the user's hue gradient (prototype `avInner`/`av`). Call tiles, ring screens, chips included.
**Verify:** [ ] upload → photo appears on own messages, sidebar card, call tile without reload [ ] other users see it after their next fetch/socket event [ ] remove restores initials [ ] non-image upload rejected [ ] server + web tests green, new endpoint has tests.

## S5 — Call screen reskin
**Goal:** restyle the in-call UI to the prototype's dark stage. **No signalling or engine changes** — bind the new UI to the existing `CallProvider` state.
- Dark stage (`--dk`), aurora background, per-person hue tiles, speaking = green glow + equaliser, name chips, host ⋯ menu on tiles (existing mute/remove actions only).
- **Critical CSS detail:** tile grid must use `grid-auto-rows:1fr` on the grid container (tiles use container queries and collapse to 0 height without it — this bug was found and fixed in the prototype).
- Glass dock: mic, add, share, whiteboard, record, hand, react, breakout, leave — buttons for S8–S10 render disabled behind a feature flag until those sections ship.
- Minimise to floating pill (timer + hang up) while chatting; top-left pills for REC/breakouts.
**Verify:** [ ] floating menus and toasts layer ABOVE the call overlay (menus opened in-call must be visible — set their z-index higher than the call screen's) [ ] 2-person and 8-person calls lay out correctly, tiles never 0-height [ ] existing host controls work from the new tile menus [ ] mute states, speaking glow reflect real engine events [ ] minimise/restore keeps the call alive [ ] mobile call screen usable [ ] both suites green.

## S6 — Incoming-call box + add-to-call
**Goal:** replace the full-screen incoming ring with the prototype's centred card; let in-call users ring more people in.
- Incoming card (`#incbox`): callee avatar, Accept / Decline / **Message** (quick replies + custom — sending one declines the call AND posts the text into that DM). Shows over the app or over an active call (call-waiting); 30s timeout → missed-call message. Uses existing ring events only.
- Accept while already in a call = the caller joins your current call (merge) if under the 8 cap — server: extend call service so an accept can target an existing call id; keep it a small, additive change in `calls` service + signalling payload.
- Add-to-call: dock button lists channel/org members not in the call; ringing shows a "Ringing…" overlay on a placeholder tile; cancel from the tile menu; cap enforced.
**Verify:** [ ] incoming card over idle app and over a live call [ ] Message decline posts into the DM [ ] timeout logs a missed call [ ] add-to-call rings, joins, cancels; 9th invite blocked [ ] accept-while-busy merges [ ] both suites green.

## S7 — Sharer self-preview
**Goal:** the person sharing sees their own shared screen (small labelled preview), per Phase 5.
- Client-only: render the local display stream into a corner preview on the share layout (prototype's share view with filmstrip).
**Verify:** [ ] sharer sees preview, others unaffected [ ] stop-share cleans it up [ ] web tests green.

## S8 — Whiteboard
**Goal:** shared whiteboard inside a call (prototype's `.wb` view).
- Client: canvas, 5 pen colours, 3 sizes, eraser (`destination-out`), undo (own strokes), clear (host). Strokes = simple point arrays.
- Transport: broadcast strokes over a new Socket.IO event in the call namespace (`call:wb:stroke` etc.); server relays to call members and keeps strokes in memory per call (replay to late joiners, drop on call end). No DB.
**Verify:** [ ] two browsers draw live to each other [ ] late joiner sees existing strokes [ ] undo removes only own last stroke, host clear wipes all [ ] ends cleanly with the call [ ] both suites green.

## S9 — Record meeting
**Goal:** host can record; recording lands in the conversation as a file message.
- Client-only mixer: `AudioContext` mixing local mic + remote audio tracks (+ share video track if active) → `MediaRecorder` (webm) → on stop, upload through the existing file-message path with label "Call recording". Pulsing REC pill for everyone (broadcast a `call:rec` on/off event); auto-stop and save on leave.
- No server-side recorder. Server change is only the REC relay event.
**Verify:** [ ] record → stop → playable file message appears in the channel/DM [ ] everyone sees the REC pill [ ] leaving mid-recording still saves [ ] both suites green.

## S10 — Breakout rooms (biggest — last)
**Goal:** host splits a call into groups (prototype's side panel), used for training.
- Server (`calls` service + signalling): breakout state on a call = named groups of member ids; host-only ops: create/rename/delete group, assign/move member, start, end ("bring everyone back"). On start/move, members' audio is re-scoped to their group (treat each group as a sub-room for audio routing); unallocated people stay with the host.
- Client: side panel per prototype — add group (cap 6), per-group "Add people" button, chip → move menu, live banner, live reallocation, end for all.
**Verify:** [ ] host creates 2 groups, assigns, starts — members only hear their group [ ] live move switches a member's audio room [ ] end returns everyone to one room [ ] non-hosts see state but can't modify [ ] rejoin during breakouts lands in the right group [ ] full test suites green + new tests for the breakout ops.

---
**Done = all 10 sections verified.** Then a human deploys (off-hours — deploy restarts chat and drops live calls) and smoke-tests on real phones.
