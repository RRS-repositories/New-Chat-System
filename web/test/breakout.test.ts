// Breakout groups: who hears whom, and the host's edits to the arrangement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GROUPS,
  NO_BREAKOUT,
  addGroup,
  describeGroups,
  groupOf,
  movePerson,
  removeGroup,
  renameGroup,
  roomOf,
  type Breakout,
} from '../src/utils/breakout.ts';

// Meg (1) is the host. Ann (2) and Bob (3) are in Group 1, Cy (5) in Group 2, Dee (6) in no group.
const open: Breakout = {
  active: true,
  groups: [
    { id: 'g1', name: 'Group 1', member_ids: [2, 3] },
    { id: 'g2', name: 'Group 2', member_ids: [5] },
  ],
};
const othersFor = (me: number) => [1, 2, 3, 5, 6].filter((id) => id !== me);

test('with the groups closed everyone is in one room', () => {
  assert.equal(roomOf(NO_BREAKOUT, 2, othersFor(2)), null);
  assert.equal(roomOf({ ...open, active: false }, 2, othersFor(2)), null);
});

test('with the groups open you hear your group; people in no group are with the host', () => {
  assert.deepEqual(roomOf(open, 2, othersFor(2)), [3], 'Ann hears Bob');
  assert.deepEqual(roomOf(open, 3, othersFor(3)), [2], 'Bob hears Ann');
  assert.deepEqual(roomOf(open, 5, othersFor(5)), [], 'Cy is alone in Group 2');
  assert.deepEqual(roomOf(open, 1, othersFor(1)), [6], 'the host hears Dee');
  assert.deepEqual(roomOf(open, 6, othersFor(6)), [1], 'Dee hears the host');
  assert.equal(groupOf(open, 3)?.name, 'Group 1');
  assert.equal(groupOf(open, 6), null);
});

test('moving a person: into a group, to another group, back to the main room', () => {
  const moved = movePerson(open.groups, 3, 'g2');
  assert.deepEqual(
    moved.map((g) => g.member_ids),
    [[2], [5, 3]],
  );
  assert.deepEqual(
    movePerson(moved, 3, null).map((g) => g.member_ids),
    [[2], [5]],
  );
  assert.deepEqual(
    movePerson(open.groups, 6, 'g1').map((g) => g.member_ids),
    [[2, 3, 6], [5]],
  );
  assert.deepEqual(open.groups[0].member_ids, [2, 3], 'the original is not changed');
});

test('adding, renaming and removing groups; six is the most', () => {
  let groups = addGroup([], 'a');
  assert.deepEqual(groups, [{ id: 'a', name: 'Group 1', member_ids: [] }]);
  groups = addGroup(groups, 'b');
  groups = renameGroup(groups, 'a', 'Trainees');
  assert.deepEqual(
    groups.map((g) => g.name),
    ['Trainees', 'Group 2'],
  );
  groups = removeGroup(groups, 'a');
  groups = addGroup(groups, 'c');
  assert.deepEqual(
    groups.map((g) => g.name),
    ['Group 2', 'Group 3'],
    'a new name never repeats one in use',
  );
  for (let i = 0; i < 10; i++) groups = addGroup(groups, `x${i}`);
  assert.equal(groups.length, MAX_GROUPS);
});

test('the banner lists who is where, leaving empty groups out', () => {
  const names: Record<number, string> = { 2: 'Ann', 3: 'Bob', 5: 'Cy' };
  const groups = [...open.groups, { id: 'g3', name: 'Group 3', member_ids: [] }];
  assert.equal(
    describeGroups(groups, (id) => names[id]),
    'Group 1: Ann, Bob · Group 2: Cy',
  );
});
