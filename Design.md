# Design

The look of the chat: colours, fonts, spacing and the feel of each part.

## 1. Principles

1. **Minimal.** Show the conversation; keep everything else quiet.
2. **Familiar.** It should feel like part of the Rowan Rose CRM: deep indigo and violet.
3. **Calm.** One accent colour. Red is reserved for things that need attention.
4. **Fast.** No animations beyond short fades. No decorative images.

## 2. Colours

### Brand and accent

| Name | Colour | Used for |
|---|---|---|
| Accent | `#6C4DE6` violet | Buttons, links, the send button, focus outlines |
| Accent strong | `#5637CF` | Hover state of buttons |
| Accent soft | `#F1EEFE` | Mention highlight, selected items, highlighted message |
| Accent line | `#D9D1FB` | Soft borders around accent areas |

### Sidebar (dark)

| Name | Colour | Used for |
|---|---|---|
| Sidebar background | `#1B1F3A` deep indigo | The whole left panel |
| Sidebar text | `#C5C9E6` | Channel and people names |
| Sidebar quiet text | `#8D92B8` | Section titles, secondary text |
| Sidebar bright text | `#FFFFFF` | Your name, the open channel, unread channels |
| Open channel | violet at 32% | Background of the selected row |
| Unread badge | `#8B6CFF` | Count of unread messages |

### Main area (light)

| Name | Colour | Used for |
|---|---|---|
| Background | `#FFFFFF` | Messages and panels |
| Soft background | `#F7F7FB` | Page background behind cards |
| Hover | `#F4F3FA` | Row under the pointer |
| Border | `#E7E6F0` | Lines between areas |
| Text | `#1B1F3A` | Main text |
| Quiet text | `#6B6F8A` | Times, hints, secondary text |

### Meaning colours

| Meaning | Colour | Used for |
|---|---|---|
| Online / call | `#22C55E` green | Online dot, call icon, accept button |
| Away | `#F59E0B` amber | Away dot |
| Attention | `#DC2626` red | Mention badge, leave call, blocked rows |
| Error text | `#B91C1C` | Error messages |

### Avatars

Each person gets one steady colour for their initials, chosen from eight:
`#6C4DE6` `#0E9F8E` `#E0672B` `#2F7DE1` `#C2418B` `#5B8C2A` `#8A5CD6` `#C98A0B`

The same person always gets the same colour, so people are easy to tell apart.

## 3. Typography

| Item | Value |
|---|---|
| Font | The device's own system font (Segoe UI on Windows, San Francisco on Apple). No font download. |
| Base size | 14 px, line height 1.5 |
| Small text | 12 px (times, hints, badges) |
| Titles | 14 px, weight 600 (channel title, names) |
| Sign-in title | 20 px, weight 600 |
| Input text | 16 px, so phones do not zoom in when typing |

Weights used: 400 normal, 500 medium, 600 for names and titles. No italics for emphasis.

## 4. Spacing and shape

| Item | Value |
|---|---|
| Spacing steps | 4, 8, 12, 16 px |
| Corners | 4 px for small items, 6–8 px for rows, inputs, avatars and buttons, 12 px for the sign-in card |
| Sidebar width | 240 px |
| Side panel width | 320 px (thread, details), 300 px (call) |
| Header height | 48 px |
| Row height in sidebar | 32 px |
| Shadows | Only on things that float: dialogs, menus, the sign-in card |

## 5. Layout

```
┌───────────┬──────────────────────────────┬───────────┐
│ Sidebar   │ Channel header               │ Side      │
│ (dark)    ├──────────────────────────────┤ panel     │
│           │                              │ (thread,  │
│ Channels  │ Messages  ← only this scrolls│ details   │
│ People    │                              │ or call)  │
│           ├──────────────────────────────┤           │
│ Actions   │ Message box                  │           │
└───────────┴──────────────────────────────┴───────────┘
```

- The page itself never scrolls. Only the message list does.
- The sidebar's top (your name) and bottom (actions) stay fixed. A long channel list scrolls on its own.
- Under 768 px wide the sidebar slides in from the left, and side panels cover the screen.

## 6. Components

| Component | Look |
|---|---|
| **Buttons** | Primary: violet background, white text. Secondary: white with a border. Dangerous: red text or red background. |
| **Icon buttons** | 32 px square, soft hover background, always with a text label for screen readers. |
| **Inputs** | White, 1 px border, violet outline when focused. |
| **Dialogs** | Centred card on a dimmed background. Close with the X or the Escape key. |
| **Badges** | Small rounded counts. Violet for unread, red for mentions. |
| **Presence dot** | 8 px circle: green online, amber away, hollow offline. |
| **Messages** | Avatar on the left, name and time on one line, text below. Consecutive messages from one person are grouped. System lines (calls, joins) are small, grey and centred. |
| **Call panel** | Right-hand panel: who is in the call, the shared screen when there is one, three buttons at the bottom (Mute, Share screen, Leave in red). |
| **Sign-in page** | White card on an indigo-to-violet gradient. |

## 7. Icons

One set only: **lucide**. Size 14–18 px, same colour as the text beside them. No emoji as interface icons.

## 8. Accessibility

- Text contrast of at least 4.5 to 1 against its background.
- Every button reachable by keyboard, with a visible violet focus outline.
- Every icon-only button has a spoken label.
- Colour is never the only signal: badges carry numbers, states carry words.
