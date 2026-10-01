import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generation, latestOnly } from '../src/utils/latest.ts';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('a slower earlier response resolves to undefined and never overwrites the newer one', async () => {
  const latest = latestOnly<string>();
  const a = deferred<string>();
  const b = deferred<string>();
  const pa = latest(a.promise);
  const pb = latest(b.promise);
  b.resolve('new');
  assert.equal(await pb, 'new');
  a.resolve('old');
  assert.equal(await pa, undefined);
});

test('in-order responses: only the newest call yields its value', async () => {
  const latest = latestOnly<number>();
  const a = deferred<number>();
  const b = deferred<number>();
  const pa = latest(a.promise);
  const pb = latest(b.promise);
  a.resolve(1);
  b.resolve(2);
  assert.equal(await pa, undefined);
  assert.equal(await pb, 2);
});

test('a single call resolves to its value; a stale rejection is swallowed, a current one is thrown', async () => {
  const latest = latestOnly<string>();
  assert.equal(await latest(Promise.resolve('x')), 'x');
  const a = deferred<string>();
  const pa = latest(a.promise);
  const pb = latest(Promise.reject(new Error('boom')));
  a.reject(new Error('stale'));
  assert.equal(await pa, undefined);
  await assert.rejects(pb, /boom/);
});

test('generation(): a newer query makes an older pending "More" stale', () => {
  const gen = generation();
  const q1 = gen.next();
  const more = gen.current(); // "More" captured while q1 was showing
  assert.equal(gen.isCurrent(more), true);
  const q2 = gen.next(); // user typed a new query
  assert.equal(gen.isCurrent(more), false);
  assert.equal(gen.isCurrent(q1), false);
  assert.equal(gen.isCurrent(q2), true);
});

test('separate latestOnly() instances do not share tickets', async () => {
  const one = latestOnly<string>();
  const two = latestOnly<string>();
  const p1 = one(Promise.resolve('a'));
  const p2 = two(Promise.resolve('b'));
  assert.equal(await p1, 'a');
  assert.equal(await p2, 'b');
});
