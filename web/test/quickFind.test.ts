import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameScore, quickFind } from '../src/utils/quickFind.ts';

const people = ['Joanne Field', 'Ann Agent', 'System Administrator', 'Bob Sales', 'Annie Hall'].map((fullName, i) => ({
  id: i + 1,
  fullName,
}));
const names = (query: string, limit?: number) =>
  quickFind(people, (p) => p.fullName, query, limit).map((p) => p.fullName);

test('part of a name is enough, whatever the letter case', () => {
  assert.deepEqual(names('syste'), ['System Administrator']);
  assert.deepEqual(names('ADMIN'), ['System Administrator']);
  assert.deepEqual(names('System Administrator'), ['System Administrator']);
});

test('a name that starts with what was typed comes before one that only contains it', () => {
  assert.deepEqual(names('ann'), ['Ann Agent', 'Annie Hall', 'Joanne Field']);
});

test('every word typed must be in the name', () => {
  assert.deepEqual(names('ann hall'), ['Annie Hall']);
  assert.deepEqual(names('ann zzz'), []);
});

test('nothing typed finds nothing, and the list is kept short', () => {
  assert.deepEqual(names('   '), []);
  assert.equal(nameScore('Ann Agent', ''), 0);
  assert.deepEqual(names('a', 2).length, 2);
});
