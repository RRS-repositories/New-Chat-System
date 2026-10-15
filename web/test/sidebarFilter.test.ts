// The sidebar's filter box and "mark all read" on a section.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestRow, filterRows, unreadRows } from '../src/utils/sidebarFilter.ts';

const ch = (id: string, over: Record<string, unknown>) =>
  ({ id, type: 'public', displayName: '', dmUserName: null, unreadCount: 0, mentionCount: 0, ...over }) as any;
const rows = [
  ch('sales', { displayName: 'SALES' }),
  ch('training', { displayName: 'SALES TRAINING' }),
  ch('ann', { type: 'dm', dmUserName: 'Ann Agent' }),
  ch('joanne', { type: 'dm', dmUserName: 'Joanne Salesi' }),
];

test('filterRows: channel names and people names, any case; blank keeps everything in order', () => {
  assert.deepEqual(
    filterRows(rows, 'sales').map((c) => c.id),
    ['sales', 'training', 'joanne'],
  );
  assert.deepEqual(
    filterRows(rows, 'ann').map((c) => c.id),
    ['ann', 'joanne'],
  );
  assert.deepEqual(filterRows(rows, 'xyz'), []);
  assert.equal(filterRows(rows, '  '), rows);
});

test('bestRow: a name that starts with what was typed wins over one that merely contains it', () => {
  assert.equal(bestRow(rows, 'ann')?.id, 'ann');
  assert.equal(bestRow(rows, 'sales tr')?.id, 'training');
  assert.equal(bestRow(rows, 'nobody'), null);
  assert.equal(bestRow(rows, ''), null);
});

test('unreadRows: rows with unread or mentions, not the one open', () => {
  const list = [ch('a', { unreadCount: 2 }), ch('b', { mentionCount: 1 }), ch('c', {}), ch('d', { unreadCount: 5 })];
  assert.deepEqual(
    unreadRows(list, 'd').map((c) => c.id),
    ['a', 'b'],
  );
});
