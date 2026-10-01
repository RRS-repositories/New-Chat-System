import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { withTimeout } from '../src/utils/timeout.ts';
import { subscriptionBody } from '../src/services/push.ts';
import { backFromAway, AWAY_AFTER_MS } from '../src/utils/presence.ts';

test('withTimeout: passes a fast result through, rejects a slow one with the given message', async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50, 'slow'), 7);
  await assert.rejects(withTimeout(Promise.reject(new Error('boom')), 50, 'slow'), /boom/);
  const t0 = Date.now();
  await assert.rejects(withTimeout(new Promise(() => {}), 30, 'Could not start notifications'), /Could not start notifications/);
  assert.ok(Date.now() - t0 < 1000, 'gives up on time');
});

test('subscribe body is exactly { endpoint, keys: { p256dh, auth } }', () => {
  const json = { endpoint: 'https://push.test/abc', expirationTime: null, keys: { p256dh: 'P', auth: 'A', extra: 'x' } };
  assert.deepEqual(subscriptionBody(json), { endpoint: 'https://push.test/abc', keys: { p256dh: 'P', auth: 'A' } });
  assert.equal(subscriptionBody({ endpoint: 'https://push.test/abc' }), null, 'no keys: not usable');
  assert.equal(subscriptionBody({ keys: { p256dh: 'P', auth: 'A' } }), null, 'no endpoint: not usable');
});

test('back from away: returning to the tab clears away even when input came first', () => {
  const now = 100 * AWAY_AFTER_MS;
  const longAgo = now - 2 * AWAY_AFTER_MS;
  // pointerdown arrives before focus: still "not looking" since long ago → stays away
  assert.equal(backFromAway({ sentAway: true, now, lastInputAt: now, notLookingSince: longAgo }), false);
  // then the tab is looked at again (notLookingSince cleared, treated as fresh input) → back
  assert.equal(backFromAway({ sentAway: true, now, lastInputAt: now, notLookingSince: null }), true);
  assert.equal(backFromAway({ sentAway: false, now, lastInputAt: now, notLookingSince: null }), false, 'nothing to undo');
});

function loadSw() {
  const handlers: Record<string, (e: any) => void> = {};
  const shown: Array<[string, any]> = []; const opened: string[] = [];
  const self: any = {
    addEventListener: (ev: string, fn: any) => { handlers[ev] = fn; },
    registration: { scope: 'https://chat.test/', showNotification: async (t: string, o: any) => { shown.push([t, o]); } },
    clients: { matchAll: async () => [], openWindow: async (u: string) => { opened.push(u); }, claim: async () => {} },
    skipWaiting: () => {},
  };
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), { self, encodeURIComponent });
  return { handlers, shown, opened };
}

test('sw.js push: a null, non-object or unreadable payload still shows a "Chat" notification via waitUntil', async () => {
  for (const data of [{ json: () => null }, { json: () => 42 }, { json: () => { throw new Error('bad'); } }, null]) {
    const { handlers, shown } = loadSw(); let waited: any = null;
    handlers.push!({ data, waitUntil: (p: any) => { waited = p; } });
    assert.ok(waited && typeof waited.then === 'function', 'waitUntil got a promise');
    await waited;
    assert.equal(shown.length, 1); assert.equal(shown[0]![0], 'Chat');
  }
});

test('sw.js notificationclick tolerates missing data', async () => {
  const { handlers, opened } = loadSw(); let waited: any = null;
  handlers.notificationclick!({ notification: { close() {} }, waitUntil: (p: any) => { waited = p; } });
  await waited;
  assert.deepEqual(opened, ['/']);
});
