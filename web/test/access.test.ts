import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accessMap, allBlocked, anyBlocked, blockedList, filterPeople } from '../src/utils/access.ts';
import type { Restriction } from '../src/types/index.ts';

const row = (userId: number, targetUserId: number, restriction: Restriction['restriction']): Restriction => ({
  id: `${userId}-${targetUserId}-${restriction}`,
  userId,
  targetUserId,
  restriction,
  reason: '',
  restrictedBy: 1,
  createdAt: '2026-09-30T10:00:00Z',
  userName: null,
  targetName: null,
  restrictedByName: null,
});

test('accessMap: outgoing and incoming blocks are kept apart, and "all" covers every kind', () => {
  const m = accessMap(2, [row(2, 3, 'all'), row(2, 5, 'dm'), row(5, 2, 'call'), row(7, 8, 'all')]);
  assert.deepEqual(m.get(3)!.out, { dm: true, call: true, channel: true });
  assert.deepEqual(m.get(3)!.in, { dm: false, call: false, channel: false });
  assert.deepEqual(m.get(5)!.out, { dm: true, call: false, channel: false });
  assert.deepEqual(m.get(5)!.in, { dm: false, call: true, channel: false });
  assert.equal(m.has(7), false, 'rows between other people are ignored');
  assert.equal(allBlocked(m.get(3)!.out), true);
  assert.equal(anyBlocked(m.get(5)!.in), true);
  assert.equal(anyBlocked(m.get(3)!.in), false);
  assert.equal(blockedList(m.get(5)!.out), 'Messages');
  assert.equal(blockedList(m.get(3)!.out), 'Messages, Calls, Private channels');
});

test('accessMap: separate rows for the same pair add up', () => {
  const m = accessMap(2, [row(2, 3, 'dm'), row(2, 3, 'channel')]);
  assert.deepEqual(m.get(3)!.out, { dm: true, call: false, channel: true });
});

test('filterPeople: by name, email or role text, and by exact role', () => {
  const people = [
    { fullName: 'Ann Agent', role: 'cs_agent', email: 'ann@x.co' },
    { fullName: 'Bob Sales', role: 'Sales', email: 'bob@x.co' },
    { fullName: 'Cy Sales', role: 'Sales' },
  ];
  assert.deepEqual(
    filterPeople(people, 'ann', '').map((p) => p.fullName),
    ['Ann Agent'],
  );
  assert.deepEqual(
    filterPeople(people, 'BOB@', '').map((p) => p.fullName),
    ['Bob Sales'],
  );
  assert.deepEqual(
    filterPeople(people, '', 'Sales').map((p) => p.fullName),
    ['Bob Sales', 'Cy Sales'],
  );
  assert.deepEqual(
    filterPeople(people, 'cy', 'Sales').map((p) => p.fullName),
    ['Cy Sales'],
  );
  assert.equal(filterPeople(people, '  ', '').length, 3);
});
