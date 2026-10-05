// The profile photo store: who has a photo, loading it once, and telling only the right avatars.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { avatarStore } from '../src/services/avatars.ts';
import { centreSquare } from '../src/utils/cropImage.ts';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
let fetched: string[] = [];
beforeEach(() => {
  avatarStore.reset();
  fetched = [];
  avatarStore.configure(async (path) => {
    fetched.push(path);
    if (path.includes('broken')) throw new Error('nope');
    return new Blob(['x'], { type: 'image/jpeg' });
  });
});

test('a person with no photo has none, and nothing is fetched', () => {
  assert.equal(avatarStore.get(7), null);
  assert.equal(avatarStore.get(null), null);
  assert.equal(avatarStore.has(7), false);
  assert.deepEqual(fetched, []);
});

test('a photo is fetched once, on first use, and only its owner’s avatars are told', async () => {
  avatarStore.setAll({ 7: '/api/chat/users/7/avatar?v=1', 8: '/api/chat/users/8/avatar?v=1' });
  const told: number[] = [];
  avatarStore.subscribe(7, () => told.push(7));
  avatarStore.subscribe(8, () => told.push(8));
  assert.deepEqual(fetched, [], 'nothing is fetched until an avatar is on screen');
  assert.equal(avatarStore.get(7), null, 'not loaded yet');
  assert.equal(avatarStore.get(7), null);
  await tick();
  assert.deepEqual(fetched, ['/api/chat/users/7/avatar?v=1'], 'asked for twice, fetched once');
  assert.deepEqual(told, [7]);
  assert.match(avatarStore.get(7)!, /^blob:/);
  assert.equal(avatarStore.has(8), true);
});

test('a changed photo is fetched again; a removed photo goes back to none', async () => {
  avatarStore.set(7, '/a?v=1');
  avatarStore.get(7);
  await tick();
  const first = avatarStore.get(7);
  let told = 0;
  avatarStore.subscribe(7, () => told++);
  avatarStore.set(7, '/a?v=1');
  assert.equal(told, 0, 'the same address changes nothing');
  avatarStore.set(7, '/a?v=2');
  assert.equal(told, 1);
  assert.equal(avatarStore.get(7), null);
  await tick();
  assert.notEqual(avatarStore.get(7), first);
  avatarStore.set(7, null);
  assert.equal(avatarStore.get(7), null);
  assert.equal(avatarStore.has(7), false);
});

test('setAll removes people who are no longer listed', async () => {
  avatarStore.setAll({ 7: '/a?v=1', 8: '/b?v=1' });
  let told = 0;
  avatarStore.subscribe(8, () => told++);
  avatarStore.setAll({ 7: '/a?v=1' });
  assert.equal(avatarStore.has(8), false);
  assert.equal(told, 1);
});

test('a photo that arrives after it was replaced is thrown away', async () => {
  avatarStore.set(7, '/a?v=1');
  avatarStore.get(7);
  avatarStore.set(7, '/a?v=2');
  await tick();
  assert.equal(avatarStore.get(7), null, 'the old picture is not shown under the new address');
  await tick();
  assert.match(avatarStore.get(7)!, /^blob:/);
  assert.deepEqual(fetched, ['/a?v=1', '/a?v=2']);
});

test('a photo that cannot be fetched shows initials, and is not asked for over and over', async () => {
  avatarStore.set(7, '/broken');
  avatarStore.get(7);
  await tick();
  assert.equal(avatarStore.get(7), null);
  assert.equal(avatarStore.get(7), null);
  assert.deepEqual(fetched, ['/broken']);
});

test('the centre square of a picture', () => {
  assert.deepEqual(centreSquare(900, 400), { x: 250, y: 0, side: 400 });
  assert.deepEqual(centreSquare(300, 700), { x: 0, y: 200, side: 300 });
  assert.deepEqual(centreSquare(256, 256), { x: 0, y: 0, side: 256 });
});
