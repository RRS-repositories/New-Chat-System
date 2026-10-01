import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESTRICTION_TYPES, typeLabel, restrictionRow, validateRestrictionForm, toRestrictionInput, withSelfSorted, isManagement } from '../src/lib/restrictions.ts';
import type { Restriction } from '../src/api/types.ts';

const row: Restriction = {
  id: 'r1', userId: 1, targetUserId: 2, restriction: 'dm', reason: 'HR', restrictedBy: 9,
  createdAt: '2026-09-12T09:05:00.000Z', userName: 'Alice A', targetName: 'Bob B', restrictedByName: 'Brad F',
};

test('the allowed types are exactly all/dm/call/channel, all first (the default)', () => {
  assert.deepEqual([...RESTRICTION_TYPES], ['all', 'dm', 'call', 'channel']);
});

test('typeLabel names each type', () => {
  assert.equal(typeLabel('all'), 'Everything');
  assert.equal(typeLabel('dm'), 'Direct messages');
  assert.equal(typeLabel('call'), 'Calls');
  assert.equal(typeLabel('channel'), 'Private channels');
});

test('restrictionRow formats a row for the table (User, Blocked from, Target, Type, Set by, Date)', () => {
  assert.deepEqual(restrictionRow(row), {
    id: 'r1', user: 'Alice A', blockedFrom: 'cannot message', target: 'Bob B', type: 'Direct messages', setBy: 'Brad F', date: '12 Sep 2026', reason: 'HR',
  });
  assert.equal(restrictionRow({ ...row, restriction: 'all' }).blockedFrom, 'cannot contact');
  assert.equal(restrictionRow({ ...row, restriction: 'call' }).blockedFrom, 'cannot call');
  assert.equal(restrictionRow({ ...row, restriction: 'channel' }).blockedFrom, 'cannot share private channels with');
  // London wall-clock date, not UTC: 23:30 UTC on 30 Sep is 1 Oct in BST.
  assert.equal(restrictionRow({ ...row, createdAt: '2026-09-30T23:30:00.000Z' }).date, '1 Oct 2026');
});

test('restrictionRow falls back to "User #id" when a name is missing (e.g. deactivated user)', () => {
  const r = restrictionRow({ ...row, userName: null, targetName: null, restrictedByName: null });
  assert.equal(r.user, 'User #1'); assert.equal(r.target, 'User #2'); assert.equal(r.setBy, 'User #9');
});

test('restrictionRow tolerates an unparsable date', () => {
  assert.equal(restrictionRow({ ...row, createdAt: 'nope' }).date, '');
});

test('validateRestrictionForm: needs both people, different people, and a known type', () => {
  assert.equal(validateRestrictionForm({ userId: 1, targetUserId: 2, restriction: 'all' }), null);
  assert.equal(validateRestrictionForm({ userId: null, targetUserId: 2, restriction: 'all' }), 'Choose a user');
  assert.equal(validateRestrictionForm({ userId: 1, targetUserId: null, restriction: 'all' }), 'Choose a target');
  assert.equal(validateRestrictionForm({ userId: 3, targetUserId: 3, restriction: 'dm' }), 'User and target must be different people');
  assert.equal(validateRestrictionForm({ userId: 1, targetUserId: 2, restriction: 'bogus' }), 'Choose a restriction type');
});

test('toRestrictionInput trims the reason, drops it when blank, and always sends bothWays', () => {
  assert.deepEqual(toRestrictionInput({ userId: 1, targetUserId: 2, restriction: 'channel', reason: '  noisy  ', bothWays: true }),
    { userId: 1, targetUserId: 2, restriction: 'channel', reason: 'noisy', bothWays: true });
  assert.deepEqual(toRestrictionInput({ userId: 1, targetUserId: 2, restriction: 'all', reason: '   ', bothWays: false }),
    { userId: 1, targetUserId: 2, restriction: 'all', bothWays: false });
});

test('withSelfSorted adds the current user (once) and sorts by fullName', () => {
  const me = { id: 5, fullName: 'Carol C', role: 'Management', email: 'c@x' };
  const list = [{ id: 2, fullName: 'dave d', role: 'Sales' }, { id: 1, fullName: 'Alice A', role: 'Sales' }];
  assert.deepEqual(withSelfSorted(list, me).map((u) => u.id), [1, 5, 2]);
  assert.deepEqual(withSelfSorted([...list, { id: 5, fullName: 'Carol C', role: 'Management' }], me).map((u) => u.id), [1, 5, 2]);
  assert.deepEqual(Object.keys(withSelfSorted([], me)[0]!).sort(), ['fullName', 'id', 'role']);
});

test('isManagement only for the Management role', () => {
  assert.equal(isManagement({ role: 'Management' }), true);
  assert.equal(isManagement({ role: 'Sales' }), false);
  assert.equal(isManagement({ role: 'management ' }), false);
});
