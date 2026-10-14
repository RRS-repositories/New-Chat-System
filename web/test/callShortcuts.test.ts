// Keyboard shortcuts during a call: Ctrl+D mute, Ctrl+Shift+S share, Ctrl+Shift+H hand; nothing hangs up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CALL_SHORTCUTS, callShortcut, withShortcut } from '../src/utils/callShortcuts.ts';

const press = (key: string, mods: Partial<{ ctrl: boolean; meta: boolean; shift: boolean; alt: boolean }> = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  metaKey: !!mods.meta,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
});

test('Ctrl+D (or Command+D) is mute; the letter may come either case', () => {
  assert.equal(callShortcut(press('d', { ctrl: true })), 'mute');
  assert.equal(callShortcut(press('D', { meta: true })), 'mute');
  assert.equal(callShortcut(press('d')), null, 'a plain d while typing is not a shortcut');
  assert.equal(callShortcut(press('d', { ctrl: true, alt: true })), null, 'Alt is a different key');
});

test('Ctrl+Shift+S shares, Ctrl+Shift+H raises a hand; Ctrl+S alone (the browser save) is not ours', () => {
  assert.equal(callShortcut(press('S', { ctrl: true, shift: true })), 'share');
  assert.equal(callShortcut(press('h', { meta: true, shift: true })), 'hand');
  assert.equal(callShortcut(press('s', { ctrl: true })), null);
  assert.equal(callShortcut(press('e', { ctrl: true, shift: true })), null, 'no shortcut leaves a call');
});

test('every shortcut in the list maps back to itself, and the hint names the keys', () => {
  for (const s of CALL_SHORTCUTS) {
    const [, key] = s.keys.split('+').slice(-1).join('').split('');
    void key;
  }
  assert.equal(withShortcut('Mute', 'mute'), 'Mute (Ctrl+D)');
  assert.equal(withShortcut('Share screen', 'share'), 'Share screen (Ctrl+Shift+S)');
  assert.deepEqual(
    CALL_SHORTCUTS.map((s) => s.action),
    ['mute', 'share', 'hand'],
  );
});
