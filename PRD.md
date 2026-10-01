# PRD — Project Requirements Document

## 1. What we are building

A private team chat for Rowan Rose Solicitors, to replace Mattermost.
Staff use it to message each other, share files, make voice calls and share their screens.

It runs in a web browser at **https://chat2.rowanroseclaims.co.uk**.

## 2. Who uses it

| Who | What they do |
|---|---|
| **Staff** (sales, customer service, payments, admin, IT) | Chat in channels and direct messages, share files, call colleagues, share their screen. |
| **Management** | Everything staff can do, plus the Admin panel: see everyone, and control who may contact whom. |

About 56 people have a CRM login. They sign in to the chat with the same email and password as the CRM. There is no separate chat account.

## 3. Ground rules for the product

These come from the owner (Brad) and do not change without his say.

1. **The chat lives only on chat2.** It is not shown inside the CRM. The CRM keeps Mattermost until the owner says the chat is finished.
2. **No paid services.** Only self-hosted or free components.
3. **Minimal and lightweight.** A simple, fast interface. No heavy extras.
4. **Calls are decentralised.** Voice and screen share travel directly between browsers. One person's bad connection must not affect the others.
5. **Voice and screen share only.** No camera video.
6. **Access is controlled.** Only people switched on for chat can use it, and Management can restrict who contacts whom.

## 4. Features

### 4.1 Already built and working

| Area | What it does |
|---|---|
| **Sign in** | CRM email and password. A person who is deactivated, locked or signed out in the CRM loses chat within a minute. |
| **Access switch** | Chat works only for Management, IT, and people with the CRM permission "Team chat (beta)". Others see "Team chat is not enabled for your account". |
| **Channels** | Public channels anyone can browse and join. Private channels by invitation. |
| **Direct messages** | One-to-one and small group conversations. |
| **Messages** | Send, edit, delete. Replies, threads, @mentions, emoji reactions, pinned messages. |
| **Files** | Share files and images up to 20 MB, with image previews. |
| **Search** | Search past messages and jump to one. *(Reported not working on the live site — see Phases.)* |
| **Unread tracking** | Unread counts, a red badge for mentions, the count in the browser tab title. A channel is not marked read while you are not looking at it. |
| **Presence** | Green dot online, amber away, and a status message each person can set. |
| **Notifications** | Sound and desktop notifications. Each person chooses all messages, mentions only, or nothing. Any channel can be muted. Push notifications reach people with no chat tab open. |
| **Voice calls** | One-to-one and group, up to 8 people. Ring, accept, decline, join late, mute. A summary line appears in the channel when the call ends. |
| **Screen sharing** | One person shares at a time. Viewers can go full screen or open the screen in its own window. |
| **Admin panel** (Management) | List of everyone, their role, whether chat is on, who is online. Per person: tick boxes for Messages, Calls and Private channels against every other person. Block or allow a whole group in one click. |
| **Layout** | Only the messages scroll. Sidebar sections fold and unfold. |

### 4.2 Requested, not built yet

1. **Search button:** find out why it is not working on the live site. Fix it if the fix is simple; otherwise remove the button.
2. **Own screen preview:** the person sharing must see what they are sharing.
3. **Call host controls:** the person who started the call can mute other people and remove them from the call. The host cannot unmute anyone.
   - Someone who was **disconnected** (lost connection, closed the tab) can simply join back.
   - Someone who was **removed** by the host cannot walk back in. If they try to join, the host gets a request and chooses to accept or refuse.

### 4.3 Later, only when the owner says so

- Move the CRM's automatic messages (email alerts, FOS, callbacks, payments, monitoring and others) from Mattermost to this chat.
- Show the chat inside the CRM.
- Import old Mattermost conversations.
- Install on phones.

### 4.4 Decided against

- Camera video in calls.
- Paid relay or paid chat services.

## 5. What "done" means

A feature is done when all of these are true:

1. It works in a real browser on the developer's PC against the local test setup.
2. Its automated tests pass.
3. The owner has tried it on chat2 and is happy.
4. `Memory.md` records what was done.

## 6. Limits worth knowing

- **Calls from outside the office** need three port-forwarding rules on the office router. Until those are in place, calls are only reliable between people inside the office.
- **Group calls above about 6 people** lose quality, because every browser connects to every other browser. The hard limit is 8.
- **The production server has 3 processor cores** and also runs the CRM, so the chat must stay light.
