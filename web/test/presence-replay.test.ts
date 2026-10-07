// Live presence events that arrive while the snapshot is still being fetched are applied again after it,
// so the older snapshot cannot wipe a fresh "online" or "offline".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotReplay } from '../src/utils/presence.ts';

test('an event during the fetch is applied at once and again after the snapshot', () => {
  const applied: string[] = [];
  const r = createSnapshotReplay<string>((a) => applied.push(a));
  r.begin();
  r.event('online 71');
  r.end('snapshot');
  assert.deepEqual(applied, ['online 71', 'snapshot', 'online 71']);
});

test('events outside a fetch are applied once; a failed fetch replays nothing', () => {
  const applied: string[] = [];
  const r = createSnapshotReplay<string>((a) => applied.push(a));
  r.event('online 1');
  r.begin();
  r.event('offline 2');
  r.end();
  r.event('away 3');
  assert.deepEqual(applied, ['online 1', 'offline 2', 'away 3']);
});

test('overlapping fetches replay once, after the last one', () => {
  const applied: string[] = [];
  const r = createSnapshotReplay<string>((a) => applied.push(a));
  r.begin();
  r.event('online 1');
  r.begin();
  r.end('snap A');
  r.event('online 2');
  r.end('snap B');
  assert.deepEqual(applied, ['online 1', 'snap A', 'online 2', 'snap B', 'online 1', 'online 2']);
});
