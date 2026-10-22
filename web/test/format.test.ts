import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dayKey,
  dayLabel,
  formatClock,
  formatFull,
  formatTime,
  groupWithPrevious,
  shortName,
} from '../src/utils/format.ts';

const now = new Date('2026-09-28T15:30:00.000Z');
test('formatTime: today → time, this week → weekday + time, older → day month', () => {
  assert.match(formatTime('2026-09-28T09:05:00.000Z', now), /^\d{2}:\d{2}$/);
  assert.match(formatTime('2026-09-25T09:05:00.000Z', now), /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  assert.match(formatTime('2026-09-12T09:05:00.000Z', now), /^12 Sep$/);
});
test("times are shown on the reader's own clock: the same moment reads differently in London and in India", () => {
  const iso = '2026-10-16T09:05:00.000Z';
  assert.equal(formatClock(iso, 'Europe/London'), '10:05');
  assert.equal(formatClock(iso, 'Asia/Kolkata'), '14:35');
  assert.equal(formatClock(iso, 'America/New_York'), '05:05');
  // Without a zone the device's own is used (whatever this machine is set to).
  const local = new Date(iso);
  const hm = `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}`;
  assert.equal(formatClock(iso), hm);
  // The day changes at the reader's midnight, not London's: 23:30 UTC on 15 Oct is already 16 Oct in India.
  const late = '2026-10-15T23:30:00.000Z';
  assert.equal(dayKey(late, 'Asia/Kolkata'), '2026-10-16');
  assert.equal(dayKey(late, 'UTC'), '2026-10-15');
  assert.equal(dayLabel(late, new Date('2026-10-16T02:00:00.000Z'), 'Asia/Kolkata'), 'Today');
  assert.equal(dayLabel(late, new Date('2026-10-16T02:00:00.000Z'), 'UTC'), 'Yesterday');
  assert.equal(formatTime(late, new Date('2026-10-16T02:00:00.000Z'), 'Asia/Kolkata'), '05:00');
  assert.match(formatFull(iso, 'Asia/Kolkata'), /16 Oct 2026, 14:35 (IST|GMT\+5:30)/);
});
test('shortName: first name and the initial of the last; a single name stays', () => {
  assert.equal(shortName('Sayed Mohammad'), 'Sayed M.');
  assert.equal(shortName('Akanksha Shivaji Powar'), 'Akanksha P.');
  assert.equal(shortName('  priyanshu  srivastava '), 'priyanshu S.');
  assert.equal(shortName('Cher'), 'Cher');
  assert.equal(shortName(''), '');
});
test('groupWithPrevious: same author within 5 minutes', () => {
  const a = { userId: 1, createdAt: '2026-09-28T10:00:00.000Z' } as any;
  assert.equal(groupWithPrevious(a, { userId: 1, createdAt: '2026-09-28T10:04:59.000Z' } as any), true);
  assert.equal(groupWithPrevious(a, { userId: 1, createdAt: '2026-09-28T10:05:01.000Z' } as any), false);
  assert.equal(groupWithPrevious(a, { userId: 2, createdAt: '2026-09-28T10:00:10.000Z' } as any), false);
  assert.equal(groupWithPrevious(undefined, a), false);
});
