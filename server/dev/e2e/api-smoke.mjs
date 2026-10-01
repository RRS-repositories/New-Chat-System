// End-to-end smoke of the merged server against the local harness (node server/dev/local.mjs).
// Real HTTP + real sockets: presence, preferences, push key, a three-person call with signalling,
// one person dropping out, screen share, and the call ending.   node server/dev/e2e/api-smoke.mjs
import { io } from 'socket.io-client';
import assert from 'node:assert/strict';

const BASE = process.env.BASE || 'http://localhost:5021';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', `${name} — ${e.message}`]); } };

async function login(email) {
  const r = await fetch(`${BASE}/api/chat/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'local' }) });
  const d = await r.json(); assert.ok(d.token, `login ${email}: ${JSON.stringify(d)}`);
  const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/chat${path}`, { method, headers: { Authorization: `Bearer ${d.token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  return { user: d.user, token: d.token, api };
}
function connect(token) {
  return new Promise((resolve, reject) => {
    const s = io(`${BASE}/chat`, { auth: { token }, transports: ['websocket'], forceNew: true });
    const events = []; s.onAny((ev, p) => events.push([ev, p]));
    s.events = events; s.has = (ev, pred = () => true) => events.some(([e, p]) => e === ev && pred(p));
    s.once('ready', () => resolve(s)); s.once('connect_error', (e) => reject(new Error(`socket: ${e.message}`)));
  });
}
const until = async (cond, what, ms = 4000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return; await sleep(50); } throw new Error(`timed out: ${what}`); };

const meg = await login('m@x'), ann = await login('a@x'), bob = await login('b@x');
const sm = await connect(meg.token), sa = await connect(ann.token), sb = await connect(bob.token);
const general = (await meg.api('GET', '/channels')).body.channels.find((c) => c.name === 'general');

await step('presence: all three show online', async () => {
  await until(async () => { const o = (await meg.api('GET', '/users/online')).body.online || []; return [meg, ann, bob].every((u) => o.includes(u.user.id)); }, 'three online');
});
await step('presence: away is broadcast and listed', async () => {
  sa.emit('set_away', { away: true });
  await until(() => sm.has('user_away', (p) => p.user_id === ann.user.id && p.away === true), 'user_away event');
  assert.ok((await meg.api('GET', '/users/online')).body.away.includes(ann.user.id));
  sa.emit('set_away', { away: false });
  await until(() => sm.has('user_away', (p) => p.user_id === ann.user.id && p.away === false), 'back event');
});
await step('preferences: defaults, save, bad value refused', async () => {
  assert.equal((await ann.api('GET', '/users/me/preferences')).body.preferences.desktopNotif, 'mentions');
  assert.equal((await ann.api('PATCH', '/users/me/preferences', { desktopNotif: 'all', soundEnabled: false })).body.preferences.soundEnabled, false);
  assert.equal((await ann.api('PATCH', '/users/me/preferences', { desktopNotif: 'loud' })).status, 400);
});
await step('status: saved and broadcast', async () => {
  assert.equal((await bob.api('PATCH', '/users/me/status', { statusText: 'On a call', statusEmoji: '📞' })).status, 200);
  await until(() => sm.has('user_status', (p) => p.user_id === bob.user.id && p.text === 'On a call'), 'user_status');
});
await step('channel mute: saved per person and shown in the list', async () => {
  assert.equal((await ann.api('PATCH', `/channels/${general.id}/notify`, { pref: 'nothing' })).body.notifyPref, 'nothing');
  assert.equal((await ann.api('GET', '/channels')).body.channels.find((c) => c.id === general.id).notifyPref, 'nothing');
  assert.equal((await meg.api('GET', '/channels')).body.channels.find((c) => c.id === general.id).notifyPref, 'default');
  await ann.api('PATCH', `/channels/${general.id}/notify`, { pref: 'default' });
});
await step('push: key offered, subscribe validated', async () => {
  assert.ok((await meg.api('GET', '/push/key')).body.key);
  assert.equal((await meg.api('POST', '/push/subscribe', { endpoint: 'https://192.168.1.58/x', keys: { p256dh: 'a', auth: 'b' } })).status, 400);
  assert.equal((await meg.api('POST', '/push/subscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/local-test', keys: { p256dh: 'a', auth: 'b' } })).status, 200);
});

let callId;
await step('call: start rings the channel; second start is refused', async () => {
  assert.ok(Array.isArray((await meg.api('GET', '/calls/ice')).body.iceServers));
  const r = await meg.api('POST', `/channels/${general.id}/calls`, { socketId: sm.id });
  assert.equal(r.status, 201, JSON.stringify(r.body)); callId = r.body.call.id; assert.equal(r.body.call.status, 'ringing');
  await until(() => sa.has('call_started', (p) => p.call_id === callId) && sb.has('call_started', (p) => p.call_id === callId), 'call_started to members');
  assert.equal((await ann.api('POST', `/channels/${general.id}/calls`, { socketId: sa.id })).status, 409);
});
await step('call: two more join (three-way mesh) and the call is active', async () => {
  const ja = await ann.api('POST', `/calls/${callId}/join`, { socketId: sa.id }); assert.equal(ja.status, 200, JSON.stringify(ja.body));
  const jb = await bob.api('POST', `/calls/${callId}/join`, { socketId: sb.id }); assert.equal(jb.status, 200);
  assert.equal(jb.body.participants.length, 3); assert.equal(jb.body.call.status, 'active');
});
await step('call: signalling goes only to the addressed person', async () => {
  sb.emit('webrtc_signal', { call_id: callId, to_user_id: meg.user.id, signal_data: { type: 'offer', sdp: 'x' } });
  await until(() => sm.has('webrtc_signal', (p) => p.from_user_id === bob.user.id && p.signal_data.sdp === 'x'), 'signal at Meg');
  await sleep(200); assert.ok(!sa.has('webrtc_signal'), 'Ann must not see a signal addressed to Meg');
});
await step('call: screen share — one at a time, only from the call device', async () => {
  assert.equal((await ann.api('POST', `/calls/${callId}/screen-share`, { on: true, socketId: sa.id })).status, 200);
  await until(() => sm.has('call_screen_share_started', (p) => p.user_id === ann.user.id), 'share started');
  assert.equal((await bob.api('POST', `/calls/${callId}/screen-share`, { on: true, socketId: sb.id })).status, 409);
  assert.equal((await ann.api('POST', `/calls/${callId}/screen-share`, { on: false, socketId: sa.id })).status, 200);
});
await step('call: one person leaving does not end it for the other two', async () => {
  assert.equal((await bob.api('POST', `/calls/${callId}/leave`)).status, 200);
  await until(() => sm.has('call_participant_left', (p) => p.user_id === bob.user.id), 'left event');
  const c = (await meg.api('GET', `/calls/${callId}`)).body; assert.equal(c.call.status, 'active'); assert.equal(c.participants.length, 2);
  sa.emit('webrtc_signal', { call_id: callId, to_user_id: meg.user.id, signal_data: { candidate: 'still-talking' } });
  await until(() => sm.has('webrtc_signal', (p) => p.signal_data.candidate === 'still-talking'), 'the remaining two still signal');
});
await step('call: last people leave → ended, with a summary message in the channel', async () => {
  await ann.api('POST', `/calls/${callId}/leave`); await meg.api('POST', `/calls/${callId}/leave`);
  await until(() => sb.has('call_ended', (p) => p.call_id === callId && p.status === 'ended'), 'call_ended');
  const msgs = (await meg.api('GET', `/channels/${general.id}/messages`)).body.messages;
  assert.ok(msgs.some((m) => m.type === 'call' && /^Voice call — /.test(m.content)), 'summary message');
  assert.equal((await meg.api('GET', `/channels/${general.id}/calls/active`)).body.call, null);
});
await step('presence: closing the last tab shows offline after the grace', async () => {
  sb.close();
  await until(() => sm.has('user_offline', (p) => p.user_id === bob.user.id), 'user_offline', 9000);
});

sm.close(); sa.close();
for (const [s, n] of results) console.log(`${s}  ${n}`);
const failed = results.filter(([s]) => s === 'FAIL').length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
