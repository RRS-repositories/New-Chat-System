// Small pure pieces of the redesign: the theme, day chips, the NEW line, avatar colours, file labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { ACCENTS, DEFAULT_THEME, cleanTheme, sameTheme } from '../src/utils/theme.ts';
import { dayKey, dayLabel, formatClock } from '../src/utils/format.ts';
import { firstNewMessageId } from '../src/utils/firstNew.ts';
import { hueOf } from '../src/utils/hue.ts';
import { fileKind } from '../src/utils/files.ts';

test('cleanTheme: anything becomes a valid theme', () => {
  assert.deepEqual(cleanTheme({ mode: 'dark', accent: 'ocean' }), { mode: 'dark', accent: 'ocean' });
  assert.deepEqual(cleanTheme({ mode: 'neon', accent: 'teal' }), DEFAULT_THEME);
  assert.deepEqual(cleanTheme(null), DEFAULT_THEME);
  assert.deepEqual(cleanTheme('dark'), DEFAULT_THEME);
  assert.deepEqual(cleanTheme({ accent: 'toString' }), DEFAULT_THEME, 'not fooled by built-in property names');
  assert.equal(Object.keys(ACCENTS).length, 5);
  assert.ok(sameTheme({ mode: 'dark', accent: 'ocean' }, { mode: 'dark', accent: 'ocean' }));
  assert.ok(!sameTheme({ mode: 'dark', accent: 'ocean' }, { mode: 'light', accent: 'ocean' }));
});

test('the page-load script accepts exactly the accents the app knows', () => {
  const boot = readFileSync(new URL('../public/theme-boot.js', import.meta.url), 'utf8');
  for (const accent of Object.keys(ACCENTS)) assert.ok(boot.includes(`'${accent}'`), accent);
  assert.ok(boot.includes("'chatTheme'"), 'same storage key');
});

test('theme.css defines every accent and dark mode', () => {
  const css = readFileSync(new URL('../src/styles/theme.css', import.meta.url), 'utf8');
  for (const accent of Object.keys(ACCENTS).filter((a) => a !== 'violet'))
    assert.ok(css.includes(`body[data-accent='${accent}']`), accent);
  assert.ok(css.includes("body[data-mode='dark']"));
});

test('no colour is written straight into a stylesheet outside the token and theme files', () => {
  const dir = new URL('../src/styles/', import.meta.url);
  // Fixed by design: the always-dark sidebar and call screen, white on a coloured button, and the
  // whiteboard and shared screen, which stay light in dark mode.
  const allowed = /^#(fff|ffffff|c6cbe7|8b92bf|aeb4db|9ba2cb|e6e8fa|7f86b4|848bb8|a7add6|181c39)$/i;
  const offenders: string[] = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.css') || ['tokens.css', 'theme.css', 'calls.css', 'legacy.css'].includes(file)) continue;
    const css = readFileSync(new URL(file, dir), 'utf8');
    for (const hex of css.match(/#[0-9a-f]{3,8}\b/gi) || []) if (!allowed.test(hex)) offenders.push(`${file}: ${hex}`);
  }
  assert.deepEqual(offenders, []);
});

test('day chips: Today, Yesterday, then the weekday and date (UK time)', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  assert.equal(dayLabel('2026-10-05T08:00:00Z', now), 'Today');
  assert.equal(dayLabel('2026-10-04T22:59:00Z', now), 'Yesterday');
  assert.equal(dayLabel('2026-10-04T23:30:00Z', now), 'Today', '00:30 UK summer time is already the next day');
  assert.equal(dayLabel('2026-10-01T10:00:00Z', now), 'Thursday, 1 Oct');
  assert.equal(dayLabel('2025-12-25T10:00:00Z', now), 'Thursday, 25 Dec 2025');
  assert.notEqual(dayKey('2026-10-04T22:59:00Z'), dayKey('2026-10-04T23:30:00Z'));
  assert.equal(dayKey('2026-10-05T08:00:00Z'), dayKey('2026-10-05T20:00:00Z'));
  assert.equal(formatClock('2026-10-05T13:05:00Z'), '14:05');
});

const msg = (id: string, userId: number, type = 'message') => ({ id, userId, type }) as any;

test('the NEW line goes above the oldest unread message from someone else', () => {
  const items = [msg('a', 2), msg('b', 1), msg('c', 2), msg('d', 3), msg('e', 1)];
  assert.equal(firstNewMessageId(items, 1, 2), 'c', 'two unread: c and d (my own do not count)');
  assert.equal(firstNewMessageId(items, 1, 1), 'd');
  assert.equal(firstNewMessageId(items, 1, 0), null);
  assert.equal(firstNewMessageId(items, 1, 50), 'a', 'more unread than on the page: the top of the page');
  assert.equal(firstNewMessageId([msg('x', 1)], 1, 3), null, 'nothing from anyone else');
  assert.equal(firstNewMessageId([msg('s', 2, 'system'), msg('y', 2)], 1, 1), 'y');
});

test('each person keeps one colour, and names differ', () => {
  assert.equal(hueOf('Ann Agent'), hueOf('  ann agent '));
  assert.ok(hueOf('Ann Agent') >= 0 && hueOf('Ann Agent') < 360);
  assert.notEqual(hueOf('Ann Agent'), hueOf('Bob Sales'));
});

test('a file card says what the file is in plain words', () => {
  assert.equal(fileKind('application/pdf', 'Report.PDF'), 'PDF');
  assert.equal(fileKind('image/png', 'photo.png'), 'Image');
  assert.equal(fileKind('video/webm', 'Call recording.webm'), 'Recording');
  assert.equal(fileKind('application/octet-stream', 'thing.bin'), 'File');
});
