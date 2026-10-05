# CHAT-CODE-SPEC — the code behind the visuals

Companion to `CHAT-UI-BUILD.md`. Grounded in the live system: Node/Express/Socket.IO server (`server/src`), React 18 + TS client (`web/src`), full-mesh WebRTC voice (≤8), in-memory call state, `webrtc_signal` relay, "perfect negotiation" (polite = larger user id), one live call per channel (unique index), one reused video channel per connection for shares. Keep the layer rules: routes→controllers→services→models; client talks only through `web/src/services/`.

## A. Already live server-side — reskin only, write NO new backend
Reactions (`reactions` table + `POST/DELETE /messages/:id/reactions`), threads (`thread_id`, `GET /messages/:id/thread`), pins (50/channel), edit/delete (soft), typing (3s throttle socket event), presence, search (tsvector), files, push, status text+emoji, browse/join channels, group DMs, admin access matrix, call lifecycle (`call_started/joined/left/ended`, 30s → missed, late join, 10s reconnect grace), screen share events, TURN creds. The prototype's message UI, sidebar, panels, incoming ringtone/push all bind to these existing APIs/events.

## B. Themes — tiny
- DB: `chat.user_preferences.theme` column **already exists unused**. No migration.
- Server: whitelist `theme` in the existing preferences PATCH (service + validator). Store JSON string `{"mode":"dark","accent":"ocean"}`.
- Client: `chat-theme.jsx` ThemeProvider reads localStorage first paint, then syncs from/to preferences so the choice follows the person across devices. Tokens go in the existing `tokens.css`/`theme.css` (they already exist — replace values, keep filenames).

## C. Profile photos — small
- Chat-owned avatars; do not touch the CRM users table.
- Migration `chat_004`: `user_preferences.avatar_file_id uuid null` (or `users_chat_profile` table if prefs is 1-row-per-user already — it is, so prefs column is fine).
- Server: `POST /api/chat/users/me/avatar` (multipart → existing file service + PR#9 signature checks, images only, ≤2 MB), `DELETE` same path. Include `avatar_url` in the people payloads and broadcast a `user_updated` socket event so open tabs refresh.
- Client: square-crop to 256 JPEG before upload (canvas, pattern = `setProfilePhoto()` in prototype); one `<Avatar>` component everywhere (image else initials-on-hue).

## D. In-call reactions + raise hand — trivial (no DB, no REST)
In-memory per-call, relay pattern identical to `webrtc_signal`:
- C→S `call_reaction {call_id, emoji}` → validate participant, rate-limit 5 per 3s/person → S→call `call_reaction {from_user_id, emoji}`. Nothing stored.
- C→S `call_hand {call_id, up:bool}` → store on participant in the in-memory call → S→call `call_hand_changed {user_id, up}`. Include `hands:[user_id]` in the call snapshot returned by `GET /calls/:id` / join, so late joiners see raised hands.
- Client: `callManager` passthrough + `useCallSocketEvents` → float animation / tile badge (visuals in prototype).

## E. Add people to a live call — medium
New in-memory `invited` set on the call `{user_id, invited_by, expires_at}`.
- `POST /calls/:id/invite {user_id}`: checks — call live; live participants + pending invites < 8; target has chat+call access; **restrictions both directions**; not already in. Effects: (a) to target `call_invited {call_id, channel_id, from_user_id}` + reuse the existing 30s incoming-call push; (b) to call `call_invite_pending {user_id}` (renders the "Ringing…" tile); (c) **post a join-link message** into the inviter↔invitee DM (open/create via the existing DM mechanism): message `type:'call'`, content "Can you join my call?", `metadata:{kind:'call_invite', call_id, channel_id}`. Client renders it as a "Join my call" card.
- Accept = existing `POST /calls/:id/join`, from the ring **or** from the DM card. Authorise join for a non-member of the channel **iff** they are in `invited` — they join the call only, no channel text access.
- Invite lifetimes: the **ring** (incoming window, push, "Ringing…" tile) expires after 30s → `call_invite_ended {user_id, reason:'cancelled'|'timeout'|'declined'}`; the **join authorisation** stays until the call ends, so the DM card works after a missed ring. The card's Join button checks the call is still live (existing lifecycle events / `GET /calls/:id`) and shows "Call has ended" otherwise.
- `DELETE /calls/:id/invite/:userId` (inviter or host) cancels both the ring and the authorisation.

## F. Accept-while-busy merge — small, rides on E
B is in call X; A rings B (call Y, B's DM). B presses Accept-and-merge:
- `POST /calls/:yid/merge {into_call_id: xid}` (caller must be a ringing target of Y and a participant of X; X under cap). Server: ends Y as `declined` with system note "merged"; adds A to X's `invited`; sends A `call_merge {join_call_id: xid}`. A's client auto-joins X via the normal join path (mesh offers as usual).
- Decline-with-message needs **no server change**: client calls existing `/calls/:id/decline`, then sends a normal DM message via the existing messages API (use the existing DM-open/redirect mechanism to get the channel id).

## G. Host controls (Phase 5, UI already designed) — small
In-memory, host = call initiator (fallback: longest-present participant on host leave).
- `call_host_mute {call_id, user_id}` → server emits the existing mute-state signal kind to that person's client, which mutes the local track and shows "Host muted you — unmute when ready" (they can self-unmute; host can never unmute — keep this rule).
- `call_host_remove {call_id, user_id}` → remove from call, add to in-memory `removed` set (blocks silent rejoin), emit `call_participant_left {reason:'removed'}`.
- `call_rejoin_request {call_id}` from a removed person → host gets `call_rejoin_requested {user_id}` → `approve` moves them to `invited`, `deny` notifies. 10s-disconnect rejoins are unaffected (not in `removed`).

## H. Whiteboard — medium (transport: Socket.IO relay, NOT data channels)
Server already relays per-call traffic and gives late-join replay for free; ≤8 people makes bandwidth trivial — data channels would add negotiation for no gain.
- In-memory `call.whiteboard = []` (cap 2,000 strokes; `clear` empties; dropped on call end — nothing persists by design).
- C→S `call_wb {call_id, op}` where op is `stroke {id, points:[[x,y]…], color, size, eraser}` (send in ~100ms point batches under one stroke id for live drawing), `undo {stroke_id}` (own strokes only), `clear {}` (host only). Validate participant; append/remove; broadcast to others.
- Snapshot: full stroke array included on join/open so late joiners see the board.
- Client: canvas exactly as prototype (normalised 0–1 coords so screen sizes match; eraser = `destination-out`).

## I. Record meeting — medium, client-side (no server recorder)
- Host's browser mixes: `AudioContext` → `MediaStreamAudioDestinationNode` fed by local mic + every remote audio track (tracks added/removed as people join/leave); if a share is active, add its video track. `MediaRecorder` → **webm** (opus/vp8).
- REC pill: relay `call_rec {call_id, on}` (host only) → broadcast `call_rec_changed {on, by}`; flag in in-memory call + snapshot so joiners see it. Everyone always sees the pill — recording is never silent.
- On stop or host leaving: upload through the existing file-message path into the call's channel, content "Call recording", `metadata:{kind:'call_recording', call_id, duration_secs}`.
- Known limits to accept: file is made on the host's machine (host tab crash = recording lost); format is webm not m4a (plays fine in browsers; transcode later if ever needed); respect the existing upload size limit.

## J. Breakout groups — the big one (server state + real audio isolation, NO renegotiation)
Server (in-memory on the call):
- `call.breakout = {active:bool, groups:[{id, name, member_ids[]}]}`; unassigned people are with the host in the main room.
- Host-only socket ops: `call_bo_set {call_id, groups}` (whole state each time — ≤8 people, keep it dumb), `call_bo_start`, `call_bo_end`. Validate host + that member_ids are participants. Broadcast `call_bo_state {active, groups}` to everyone; include in the join snapshot (a rejoiner lands back in their group).
Client (the clever bit, in `callManager.ts`):
- On `call_bo_state`, compute my room (my group, or main room). For each peer connection to someone **outside** my room: `audioSender.replaceTrack(null)`; for someone inside: `replaceTrack(micTrack)`. `replaceTrack` on the same m-line does **not** renegotiate — instant, and real isolation (out-of-room peers receive no audio at all, not just muted playback). Belt-and-braces: also don't render audio from out-of-room peers.
- Tiles grey out / regroup per prototype; speaking indicators only fire for in-room peers.
- v1 rule: screen share and whiteboard are disabled while breakouts are active (scoping them per-group is a v2). Enforce server-side (reject share/wb ops when `breakout.active`).
- Host "Bring everyone back" = `call_bo_end` → every client restores `replaceTrack(micTrack)` to all.

## K. Decisions — RESOLVED 5 Oct 2026 (Sayed)
1. Breakouts v1: share + whiteboard paused while groups are live — **agreed**.
2. Add-to-call: ring them AND post a join-link message into the DM (section E as written); invitee joins the call only, never the channel's text — **agreed**.
3. Recording: webm, host-side, always-visible REC pill + "this call is being recorded" join toast — **agreed**.
4. Avatars chat-only — **agreed**.
No open questions. Build exactly as specified.

## L. Build order (slots into CHAT-UI-BUILD.md sections)
B,C → S1/S4 · D,G → S5 · E,F → S6 · H → S8 · I → S9 · J → S10. Every item above lists its full contract — Claude Code should implement exactly these event names and payloads, add tests beside the existing 368/107, and run each section's Verify checklist before moving on.
