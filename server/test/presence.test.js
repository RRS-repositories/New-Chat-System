import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createPresence } from '../src/services/presence/registry.js';
import { attachPresence } from '../src/sockets/presence.socket.js';

// Fake timers: run() fires every pending timer, as if graceMs had passed.
function fakeTimers() {
  let seq = 0; const pending = new Map();
  return {
    pending,
    setTimeout(fn, ms) { const id = ++seq; pending.set(id, { fn, ms }); return { id, unref() {} }; },
    clearTimeout(h) { if (h) pending.delete(h.id); },
    run() { const all = [...pending.values()]; pending.clear(); for (const t of all) t.fn(); },
  };
}

test('first socket is "first"; a second socket of the same user is not; both are listed', () => {
  const p = createPresence({ graceMs: 5000, timers: fakeTimers() });
  assert.deepEqual(p.connect(1, 's1'), { first: true });
  assert.deepEqual(p.connect(1, 's2'), { first: false });
  assert.deepEqual(p.connect(2, 's3'), { first: true });
  assert.deepEqual(p.socketsOf(1).sort(), ['s1', 's2']);
  assert.deepEqual(p.socketsOf(9), []);
  assert.equal(p.isConnected(1), true); assert.equal(p.isConnected(9), false);
  assert.deepEqual(p.snapshot(), { online: [1, 2], away: [] });
});

test('closing one of two sockets does not start the offline timer', () => {
  const timers = fakeTimers(); const p = createPresence({ graceMs: 5000, timers });
  p.connect(1, 's1'); p.connect(1, 's2');
  const off = [];
  p.disconnect(1, 's1', (u) => off.push(u));
  assert.equal(timers.pending.size, 0);
  timers.run();
  assert.deepEqual(off, []); assert.equal(p.isConnected(1), true); assert.deepEqual(p.socketsOf(1), ['s2']);
});

test('last socket gone: onOffline fires after graceMs and the user leaves the snapshot', () => {
  const timers = fakeTimers(); const p = createPresence({ graceMs: 5000, timers });
  p.connect(1, 's1');
  const off = [];
  p.disconnect(1, 's1', (u) => off.push(u));
  assert.equal(timers.pending.size, 1);
  assert.equal([...timers.pending.values()][0].ms, 5000);
  assert.equal(p.isConnected(1), false, 'no live socket during the grace');
  assert.deepEqual(p.snapshot().online, [1], 'still shown online until user_offline is sent');
  assert.deepEqual(off, []);
  timers.run();
  assert.deepEqual(off, [1]);
  assert.deepEqual(p.snapshot(), { online: [], away: [] });
  // Connecting afterwards is "first" again.
  assert.deepEqual(p.connect(1, 's9'), { first: true });
});

test('a reconnect within the grace cancels the offline and is not "first"', () => {
  const timers = fakeTimers(); const p = createPresence({ graceMs: 5000, timers });
  p.connect(1, 's1');
  const off = [];
  p.disconnect(1, 's1', (u) => off.push(u));
  assert.deepEqual(p.connect(1, 's2'), { first: false });
  assert.equal(timers.pending.size, 0, 'timer cleared');
  timers.run();
  assert.deepEqual(off, []); assert.equal(p.isConnected(1), true);
});

test('disconnect of an unknown socket or user is a no-op', () => {
  const timers = fakeTimers(); const p = createPresence({ graceMs: 5000, timers });
  p.connect(1, 's1');
  p.disconnect(1, 'nope', () => assert.fail('no offline'));
  p.disconnect(7, 's1', () => assert.fail('no offline'));
  assert.equal(timers.pending.size, 0); assert.equal(p.isConnected(1), true);
});

test('away only when ALL sockets are away; any active socket makes the user online', () => {
  const p = createPresence({ graceMs: 5000, timers: fakeTimers() });
  p.connect(1, 's1'); p.connect(1, 's2');
  assert.deepEqual(p.setAway(1, 's1', true), { changed: false, away: false });
  assert.deepEqual(p.snapshot(), { online: [1], away: [] });
  assert.deepEqual(p.setAway(1, 's2', true), { changed: true, away: true });
  assert.equal(p.isAway(1), true);
  assert.deepEqual(p.snapshot(), { online: [], away: [1] });
  assert.deepEqual(p.setAway(1, 's2', true), { changed: false, away: true }, 'repeat is not a change');
  assert.deepEqual(p.setAway(1, 's1', false), { changed: true, away: false });
  assert.deepEqual(p.snapshot(), { online: [1], away: [] });
});

test('a new socket is active, so it ends "away"; closing the only active socket makes the rest away', () => {
  const p = createPresence({ graceMs: 5000, timers: fakeTimers() });
  p.connect(1, 's1'); p.setAway(1, 's1', true);
  assert.equal(p.isAway(1), true);
  p.connect(1, 's2');
  assert.equal(p.isAway(1), false);
  p.disconnect(1, 's2', () => {});
  assert.equal(p.isAway(1), true);
  assert.deepEqual(p.snapshot(), { online: [], away: [1] });
});

test('setAway for a socket the registry does not know changes nothing', () => {
  const p = createPresence({ graceMs: 5000, timers: fakeTimers() });
  assert.deepEqual(p.setAway(1, 's1', true), { changed: false, away: false });
  p.connect(1, 's1');
  assert.deepEqual(p.setAway(1, 'other', true), { changed: false, away: false });
});

test('an onOffline that throws does not escape the timer', () => {
  const timers = fakeTimers(); const p = createPresence({ graceMs: 5000, timers });
  p.connect(1, 's1');
  p.disconnect(1, 's1', () => { throw new Error('boom'); });
  const orig = console.error; console.error = () => {};
  try { assert.doesNotThrow(() => timers.run()); } finally { console.error = orig; }
  assert.equal(p.isConnected(1), false);
});

test('close() clears pending grace timers and makes later callbacks no-ops', () => {
  const timers = fakeTimers(); const p = createPresence({ graceMs: 5000, timers });
  const off = [];
  p.connect(1, 's1'); p.connect(2, 's2');
  p.disconnect(1, 's1', (u) => off.push(u));
  // A callback captured before close() (a timer the host could not cancel) must do nothing.
  const [captured] = [...timers.pending.values()];
  p.close();
  assert.equal(timers.pending.size, 0, 'timer cleared');
  captured.fn();
  assert.deepEqual(off, []);
  // After close, a disconnect does not start a timer or fire onOffline.
  p.disconnect(2, 's2', (u) => off.push(u));
  assert.equal(timers.pending.size, 0);
  timers.run();
  assert.deepEqual(off, []);
});

test('default timers are unref()d so the process is not held open', () => {
  const orig = globalThis.setTimeout; let unrefd = false;
  globalThis.setTimeout = (fn, ms) => { const t = orig(fn, ms); const u = t.unref.bind(t); t.unref = () => { unrefd = true; return u(); }; return t; };
  try {
    const p = createPresence({ graceMs: 10 });
    p.connect(1, 's1'); p.disconnect(1, 's1', () => {});
  } finally { globalThis.setTimeout = orig; }
  assert.equal(unrefd, true);
});

// ---- attachPresence with a fake namespace/socket ----------------------------------

function harness({ dbFails = false } = {}) {
  const timers = fakeTimers();
  const presence = createPresence({ graceMs: 5000, timers });
  const emitted = [];
  const nsp = { emit: (e, p) => emitted.push([e, p]) };
  const queries = [];
  const db = { async query(sql, params) { queries.push({ sql, params }); if (dbFails) throw new Error('db down'); return { rows: [], rowCount: 1 }; } };
  let n = 0;
  const open = (userId) => {
    const socket = new EventEmitter(); socket.id = `s${++n}`;
    attachPresence({ nsp, socket, user: { id: userId, fullName: 'X' }, presence, db });
    return socket;
  };
  return { timers, presence, emitted, queries, open };
}
const flush = () => new Promise((r) => setImmediate(r));

test('attachPresence: user_online once per user, not for a second tab', () => {
  const h = harness();
  h.open(1); h.open(1);
  assert.deepEqual(h.emitted, [['user_online', { user_id: 1 }]]);
});

test('attachPresence: the first connect upserts last_seen_at; a second tab does not', async () => {
  const h = harness();
  h.open(1); await flush();
  assert.equal(h.queries.length, 1);
  assert.match(h.queries[0].sql, /INSERT INTO chat\.user_presence[\s\S]*ON CONFLICT \(user_id\) DO UPDATE SET last_seen_at = now\(\)/);
  assert.deepEqual(h.queries[0].params, [1]);
  h.open(1); await flush();
  assert.equal(h.queries.length, 1);
});

test('attachPresence: a failing last_seen_at write on connect is logged, and user_online still goes out', async () => {
  const h = harness({ dbFails: true });
  const logged = []; const orig = console.error; console.error = (...a) => logged.push(a.join(' '));
  try { h.open(1); await flush(); await flush(); } finally { console.error = orig; }
  assert.deepEqual(h.emitted, [['user_online', { user_id: 1 }]]);
  assert.ok(logged.some((l) => /db down/.test(l)));
});

test('attachPresence: set_away emits user_away only when the user-level state changes', () => {
  const h = harness();
  const a = h.open(1), b = h.open(1); h.emitted.length = 0;
  a.emit('set_away', { away: true });
  assert.deepEqual(h.emitted, []);
  b.emit('set_away', { away: true });
  assert.deepEqual(h.emitted, [['user_away', { user_id: 1, away: true }]]);
  b.emit('set_away', { away: true });
  a.emit('set_away', { away: false });
  assert.deepEqual(h.emitted.slice(1), [['user_away', { user_id: 1, away: false }]]);
  a.emit('set_away', { away: 'yes' }); a.emit('set_away'); // ignored, no throw
  assert.equal(h.emitted.length, 2);
});

test('attachPresence: a new tab while away announces away:false; closing the active tab announces away:true', () => {
  const h = harness();
  const a = h.open(1); a.emit('set_away', { away: true }); h.emitted.length = 0;
  const b = h.open(1);
  assert.deepEqual(h.emitted, [['user_away', { user_id: 1, away: false }]]);
  b.emit('disconnect', 'transport close');
  assert.deepEqual(h.emitted.slice(1), [['user_away', { user_id: 1, away: true }]]);
});

test('attachPresence: last tab closed → user_offline after the grace + last_seen_at upsert', async () => {
  const h = harness();
  const a = h.open(1); await flush(); h.emitted.length = 0; h.queries.length = 0;
  a.emit('disconnect', 'transport close');
  assert.deepEqual(h.emitted, []);
  assert.equal(h.queries.length, 0, 'nothing written during the grace');
  h.timers.run(); await flush();
  assert.deepEqual(h.emitted, [['user_offline', { user_id: 1 }]]);
  const q = h.queries.find((x) => /chat\.user_presence/.test(x.sql));
  assert.ok(q, 'last_seen_at written');
  assert.match(q.sql, /ON CONFLICT \(user_id\) DO UPDATE SET last_seen_at = now\(\)/);
  assert.deepEqual(q.params, [1]);
});

test('attachPresence: reconnect within the grace sends neither user_offline nor a second user_online', async () => {
  const h = harness();
  const a = h.open(1); await flush(); h.emitted.length = 0; h.queries.length = 0;
  a.emit('disconnect', 'transport close');
  h.open(1);
  h.timers.run(); await flush();
  assert.deepEqual(h.emitted, []);
  assert.equal(h.queries.length, 0, 'not first, not offline: no write');
});

test('attachPresence: a failing last_seen_at write is logged, never thrown', async () => {
  const h = harness({ dbFails: true });
  const logged = []; const orig = console.error; console.error = (...a2) => logged.push(a2.join(' '));
  try {
    const a = h.open(1); await flush(); await flush(); // the connect-time write fails too
    h.emitted.length = 0; logged.length = 0;
    a.emit('disconnect', 'transport close');
    h.timers.run(); await flush(); await flush();
  } finally { console.error = orig; }
  assert.deepEqual(h.emitted, [['user_offline', { user_id: 1 }]]);
  assert.ok(logged.some((l) => /db down/.test(l)), 'offline-time error logged');
});
