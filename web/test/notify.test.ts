import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldNotify, notificationContent, isLookedAt, parseSwOpen, SW_OPEN } from '../src/utils/notify.ts';
import { urlBase64ToUint8Array } from '../src/services/push.ts';
import { computeAway, presenceOf, AWAY_AFTER_MS } from '../src/utils/presence.ts';

const ME = 9;
const msg = (extra: any = {}) => ({ id: 'm1', channelId: 'c1', userId: 2, userName: 'Bob Smith', content: 'hello', type: 'message', mentionsMe: false, files: [], ...extra }) as any;
const chan = (type: string, notifyPref = 'default', displayName = 'general') => ({ id: 'c1', type, notifyPref, displayName }) as any;
const prefs = (desktopNotif: string) => ({ desktopNotif, mobileNotif: 'mentions', soundEnabled: true, sendOnEnter: true, statusText: '', statusEmoji: '' }) as any;

test('shouldNotify follows the server rule (table)', () => {
  const rows: Array<[string, any, boolean]> = [
    // [label, input, expected]
    ['own message never', { message: msg({ userId: ME }), channel: chan('public', 'all'), prefs: prefs('all') }, false],
    ['system message never', { message: msg({ type: 'system' }), channel: chan('public', 'all'), prefs: prefs('all') }, false],
    ['join never', { message: msg({ type: 'join' }), channel: chan('public', 'all'), prefs: prefs('all') }, false],
    ['leave never', { message: msg({ type: 'leave' }), channel: chan('public', 'all'), prefs: prefs('all') }, false],
    ['call never', { message: msg({ type: 'call' }), channel: chan('dm', 'all'), prefs: prefs('all') }, false],
    ['file message counts like a message', { message: msg({ type: 'file' }), channel: chan('public', 'all'), prefs: prefs('nothing') }, true],
    ['user all → any message', { message: msg(), channel: chan('public'), prefs: prefs('all') }, true],
    ['user mentions, plain message in a channel', { message: msg(), channel: chan('public'), prefs: prefs('mentions') }, false],
    ['user mentions, mention', { message: msg({ mentionsMe: true }), channel: chan('private'), prefs: prefs('mentions') }, true],
    ['user mentions, dm', { message: msg(), channel: chan('dm'), prefs: prefs('mentions') }, true],
    ['user mentions, group dm', { message: msg(), channel: chan('group_dm'), prefs: prefs('mentions') }, true],
    ['user nothing', { message: msg({ mentionsMe: true }), channel: chan('dm'), prefs: prefs('nothing') }, false],
    ['channel all overrides user nothing', { message: msg(), channel: chan('public', 'all'), prefs: prefs('nothing') }, true],
    ['channel mentions overrides user all', { message: msg(), channel: chan('public', 'mentions'), prefs: prefs('all') }, false],
    ['channel muted overrides a mention', { message: msg({ mentionsMe: true }), channel: chan('public', 'nothing'), prefs: prefs('all') }, false],
    ['missing notifyPref = default', { message: msg(), channel: { id: 'c1', type: 'public', displayName: 'g' }, prefs: prefs('all') }, true],
    ['unknown channel uses user level', { message: msg({ mentionsMe: true }), channel: undefined, prefs: prefs('mentions') }, true],
    ['viewing the channel suppresses', { message: msg(), channel: chan('dm'), prefs: prefs('all'), viewing: true }, false],
  ];
  for (const [label, input, expected] of rows) assert.equal(shouldNotify({ me: ME, viewing: false, ...input }), expected, label);
});

test('notification title/body follow the push payload rules', () => {
  assert.deepEqual(notificationContent(msg(), chan('public', 'default', 'general')), { title: '#general', body: 'Bob Smith: hello' });
  assert.deepEqual(notificationContent(msg(), chan('dm', 'default', 'x')), { title: 'Bob Smith', body: 'Bob Smith: hello' });
  assert.deepEqual(notificationContent(msg({ type: 'file', content: '' }), chan('private', 'default', 'ops')), { title: '#ops', body: 'Bob Smith sent a file' });
  const long = 'a'.repeat(300);
  assert.equal(notificationContent(msg({ content: long }), chan('public')).body, `Bob Smith: ${'a'.repeat(140)}`);
  assert.deepEqual(notificationContent(msg(), undefined), { title: 'Bob Smith', body: 'Bob Smith: hello' });
});

test('looked at = visible document and focused', () => {
  assert.equal(isLookedAt({ hidden: false, focused: true }), true);
  assert.equal(isLookedAt({ hidden: true, focused: true }), false, 'another tab');
  assert.equal(isLookedAt({ hidden: false, focused: false }), false, 'another window has focus');
});

test('service worker open message: channel id or null', () => {
  assert.equal(parseSwOpen({ type: SW_OPEN, channelId: 'abc-123' }), 'abc-123');
  assert.equal(parseSwOpen({ type: SW_OPEN, channelId: '' }), null);
  assert.equal(parseSwOpen({ type: SW_OPEN, channelId: '../x' }), null);
  assert.equal(parseSwOpen({ type: 'other', channelId: 'abc' }), null);
  assert.equal(parseSwOpen(null), null);
});

test('urlBase64ToUint8Array decodes a VAPID key', () => {
  assert.deepEqual([...urlBase64ToUint8Array('AQID_-8')], [1, 2, 3, 255, 239]);
  assert.deepEqual([...urlBase64ToUint8Array('aGk')], [104, 105]);
});

test('away after 5 min without input, or 5 min not looked at', () => {
  const now = 10 * AWAY_AFTER_MS;
  assert.equal(AWAY_AFTER_MS, 5 * 60 * 1000);
  assert.equal(computeAway({ now, lastInputAt: now - 1000, notLookingSince: null }), false);
  assert.equal(computeAway({ now, lastInputAt: now - AWAY_AFTER_MS, notLookingSince: null }), true);
  assert.equal(computeAway({ now, lastInputAt: now - 1000, notLookingSince: now - AWAY_AFTER_MS }), true);
  assert.equal(computeAway({ now, lastInputAt: now - 1000, notLookingSince: now - 60_000 }), false);
});

test('presenceOf: online, away or offline', () => {
  const p = { online: { 1: true, 2: true }, away: { 2: true }, statuses: {} } as any;
  assert.equal(presenceOf(p, 1), 'online');
  assert.equal(presenceOf(p, 2), 'away');
  assert.equal(presenceOf(p, 3), 'offline');
  assert.equal(presenceOf(p, null), 'offline');
});
