/**
 * Keyboard shortcuts during a call (the owner's ask, 14 Oct 2026). Ctrl on Windows, Command on a Mac.
 *
 *   Ctrl+D          mute / unmute
 *   Ctrl+Shift+S    share screen / stop sharing
 *   Ctrl+Shift+H    raise / lower hand
 *
 * Leaving a call has no shortcut on purpose: one wrong key must not drop someone out of a call.
 */
export type CallShortcut = 'mute' | 'share' | 'hand';

export const CALL_SHORTCUTS: Array<{ keys: string; does: string; action: CallShortcut }> = [
  { keys: 'Ctrl+D', does: 'Mute or unmute', action: 'mute' },
  { keys: 'Ctrl+Shift+S', does: 'Share screen or stop sharing', action: 'share' },
  { keys: 'Ctrl+Shift+H', does: 'Raise or lower hand', action: 'hand' },
];

type KeyLike = { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean };

/** The call action a key press means, or null when it is not one of the shortcuts. */
export function callShortcut(e: KeyLike): CallShortcut | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = (e.key || '').toLowerCase();
  if (!e.shiftKey && key === 'd') return 'mute';
  if (e.shiftKey && key === 's') return 'share';
  if (e.shiftKey && key === 'h') return 'hand';
  return null;
}

/** The hint shown on a button: "Mute (Ctrl+D)". */
export function withShortcut(label: string, action: CallShortcut): string {
  const s = CALL_SHORTCUTS.find((x) => x.action === action);
  return s ? `${label} (${s.keys})` : label;
}
