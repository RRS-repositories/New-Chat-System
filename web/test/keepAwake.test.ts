// The Web Lock that keeps the browser from freezing the chat's tab.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESENCE_LOCK, holdPresenceLock } from '../src/utils/keepAwake.ts';

test('holds one shared lock for the life of the page; without Web Locks it does nothing', async () => {
  assert.equal(holdPresenceLock(null), false);
  assert.equal(holdPresenceLock({} as any), false);
  const requests: Array<{ name: string; mode: string }> = [];
  let settled = false;
  const locks = {
    request(name: string, opts: { mode: string }, cb: () => Promise<void>) {
      requests.push({ name, mode: opts.mode });
      return cb().then(() => {
        settled = true;
      });
    },
  };
  assert.equal(holdPresenceLock(locks as any), true);
  assert.equal(holdPresenceLock(locks as any), true, 'a second call does not take another lock');
  assert.deepEqual(requests, [{ name: PRESENCE_LOCK, mode: 'shared' }]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(settled, false, 'the lock is never released by the page');
});
