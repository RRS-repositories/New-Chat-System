import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTime, groupWithPrevious } from '../src/lib/format.ts';

const now = new Date('2026-09-28T15:30:00.000Z');
test('formatTime: today → time, this week → weekday + time, older → day month', () => {
  assert.match(formatTime('2026-09-28T09:05:00.000Z', now), /^\d{2}:\d{2}$/);
  assert.match(formatTime('2026-09-25T09:05:00.000Z', now), /^[A-Z][a-z]{2} \d{2}:\d{2}$/);
  assert.match(formatTime('2026-09-12T09:05:00.000Z', now), /^12 Sep$/);
});
test('groupWithPrevious: same author within 5 minutes', () => {
  const a = { userId: 1, createdAt: '2026-09-28T10:00:00.000Z' } as any;
  assert.equal(groupWithPrevious(a, { userId: 1, createdAt: '2026-09-28T10:04:59.000Z' } as any), true);
  assert.equal(groupWithPrevious(a, { userId: 1, createdAt: '2026-09-28T10:05:01.000Z' } as any), false);
  assert.equal(groupWithPrevious(a, { userId: 2, createdAt: '2026-09-28T10:00:10.000Z' } as any), false);
  assert.equal(groupWithPrevious(undefined, a), false);
});
