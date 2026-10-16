// The sidebar the way the person arranged it: row order per section, and "Recent" direct messages.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyOrder, byLatest, moveId, recentDms } from '../src/utils/sidebarOrder.ts';

const ch = (id: string, over: Record<string, unknown> = {}) =>
  ({ id, type: 'dm', unreadCount: 0, mentionCount: 0, lastMessageAt: null, ...over }) as any;

test('applyOrder: arranged rows first in their order, the rest after as they came; no order means as it came', () => {
  const list = [ch('a'), ch('b'), ch('c'), ch('d')];
  assert.deepEqual(
    applyOrder(list, ['c', 'a']).map((c) => c.id),
    ['c', 'a', 'b', 'd'],
  );
  assert.deepEqual(
    applyOrder(list, ['zz', 'd']).map((c) => c.id),
    ['d', 'a', 'b', 'c'],
    'an id that no longer exists is ignored',
  );
  assert.equal(applyOrder(list, []), list);
});

test('moveId: below the target when dragging down, above it when dragging up; nothing on nonsense', () => {
  const ids = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveId(ids, 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveId(ids, 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveId(ids, 'a', 'd'), ['b', 'c', 'd', 'a'], 'to the end');
  assert.deepEqual(moveId(ids, 'd', 'a'), ['d', 'a', 'b', 'c'], 'to the top');
  assert.equal(moveId(ids, 'a', 'a'), ids);
  assert.equal(moveId(ids, 'x', 'a'), ids);
});

test('byLatest: whoever wrote last is at the top; empty conversations last, unless just opened', () => {
  const dms = [
    ch('old', { lastMessageAt: '2026-10-10T09:00:00Z', dmUserName: 'Old' }),
    ch('empty', { dmUserName: 'Empty' }),
    ch('newest', { lastMessageAt: '2026-10-16T12:00:00Z', dmUserName: 'New' }),
    ch('mid', { lastMessageAt: '2026-10-12T09:00:00Z', dmUserName: 'Mid' }),
  ];
  assert.deepEqual(
    byLatest(dms).map((c) => c.id),
    ['newest', 'mid', 'old', 'empty'],
  );
  assert.deepEqual(
    byLatest(dms, 'empty').map((c) => c.id),
    ['empty', 'newest', 'mid', 'old'],
    'the conversation just started leads until its first message',
  );
  assert.deepEqual(
    dms.map((c) => c.id),
    ['old', 'empty', 'newest', 'mid'],
    'the input is not changed',
  );
});

test('recentDms: unread, open, favourite or active within two weeks stay; the quiet old ones go', () => {
  const now = Date.parse('2026-10-12T12:00:00Z');
  const day = 24 * 60 * 60 * 1000;
  const dms = [
    ch('quiet-old', { lastMessageAt: new Date(now - 40 * day).toISOString() }),
    ch('active', { lastMessageAt: new Date(now - 3 * day).toISOString() }),
    ch('unread-old', { lastMessageAt: new Date(now - 90 * day).toISOString(), unreadCount: 2 }),
    ch('fav-old', { lastMessageAt: new Date(now - 90 * day).toISOString(), favourite: true }),
    ch('open-old', { lastMessageAt: new Date(now - 90 * day).toISOString() }),
    ch('never'),
  ];
  assert.deepEqual(
    recentDms(dms, 'open-old', now).map((c) => c.id),
    ['active', 'unread-old', 'fav-old', 'open-old'],
  );
});
