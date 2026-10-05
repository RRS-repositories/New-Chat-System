// Real Postgres (PGlite) for the preferences / status / channel-mute SQL.
import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import {
  getPreferences,
  updatePreferences,
  setStatus,
  listStatuses,
  setChannelNotifyPref,
  DEFAULT_PREFERENCES,
} from '../src/models/prefs.model.js';
import { listChannelsForUser, createChannel, getChannel, openDm } from '../src/models/channels.model.js';

// One database (PGlite start-up is slow); the tables these tests write are reset before each.
let t, db;
before(async () => {
  t = await createTestDb();
  db = t.db;
});
beforeEach(async () => {
  await db.query(`DELETE FROM chat.user_preferences`);
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'default'`);
});
after(async () => {
  await t.close();
});

const defaults = {
  desktopNotif: 'mentions',
  mobileNotif: 'mentions',
  soundEnabled: true,
  sendOnEnter: true,
  statusText: '',
  statusEmoji: '',
  theme: null,
};

test('defaults when the user has no preferences row (and none is created by reading)', async () => {
  assert.deepEqual(DEFAULT_PREFERENCES, defaults);
  assert.deepEqual(await getPreferences(db, 2), defaults);
  const { rows } = await db.query(`SELECT 1 FROM chat.user_preferences WHERE user_id = 2`);
  assert.equal(rows.length, 0);
});

test('updatePreferences creates the row lazily, then updates only the given keys', async () => {
  const p1 = await updatePreferences(db, 2, { desktopNotif: 'all', soundEnabled: false });
  assert.deepEqual(p1, { ...defaults, desktopNotif: 'all', soundEnabled: false });
  const p2 = await updatePreferences(db, 2, { mobileNotif: 'nothing', sendOnEnter: false, bogus: 1 });
  assert.deepEqual(p2, {
    ...defaults,
    desktopNotif: 'all',
    soundEnabled: false,
    mobileNotif: 'nothing',
    sendOnEnter: false,
  });
  assert.deepEqual(await getPreferences(db, 2), p2);
  assert.deepEqual(await getPreferences(db, 3), defaults, 'other users untouched');
});

test('updatePreferences with no known keys changes nothing and returns the current values', async () => {
  assert.deepEqual(await updatePreferences(db, 2, { colour: 'dark' }), defaults);
});

test('updatePreferences refuses invalid values with bad_preference and writes nothing', async () => {
  for (const bad of [
    { desktopNotif: 'loud' },
    { mobileNotif: 1 },
    { soundEnabled: 'yes' },
    { sendOnEnter: null },
    { desktopNotif: 'all', soundEnabled: 0 },
  ]) {
    await assert.rejects(
      () => updatePreferences(db, 2, bad),
      { code: 'bad_preference', status: 400 },
      JSON.stringify(bad),
    );
  }
  assert.deepEqual(await getPreferences(db, 2), defaults);
});

test('setStatus trims, saves, and shows in preferences and listStatuses; clearing removes it from the list', async () => {
  assert.deepEqual(await setStatus(db, 2, { statusText: '  In a meeting  ', statusEmoji: ' 📅 ' }), {
    text: 'In a meeting',
    emoji: '📅',
  });
  await setStatus(db, 3, { statusText: '', statusEmoji: '🏖️' });
  const p = await getPreferences(db, 2);
  assert.equal(p.statusText, 'In a meeting');
  assert.equal(p.statusEmoji, '📅');
  assert.deepEqual(await listStatuses(db), { 2: { text: 'In a meeting', emoji: '📅' }, 3: { text: '', emoji: '🏖️' } });
  await setStatus(db, 2, { statusText: '', statusEmoji: '' });
  assert.deepEqual(await listStatuses(db), { 3: { text: '', emoji: '🏖️' } });
  // A preferences row with no status (created by a prefs PATCH) is not listed.
  await updatePreferences(db, 5, { soundEnabled: false });
  assert.deepEqual(Object.keys(await listStatuses(db)), ['3']);
});

test('listStatuses leaves out inactive and unapproved users', async () => {
  await setStatus(db, 2, { statusText: 'Here' });
  await setStatus(db, 4, { statusText: 'Left the company' }); // seeded inactive
  await setStatus(db, 5, { statusEmoji: '🙂' });
  await db.query(`UPDATE users SET is_approved = false WHERE id = 5`);
  try {
    assert.deepEqual(await listStatuses(db), { 2: { text: 'Here', emoji: '' } });
  } finally {
    await db.query(`UPDATE users SET is_approved = true WHERE id = 5`);
  }
});

test('setStatus keeps a key that was not sent; enforces 100 / 16 character limits', async () => {
  await setStatus(db, 2, { statusText: 'Lunch', statusEmoji: '🍔' });
  assert.deepEqual(await setStatus(db, 2, { statusText: 'Back at 2' }), { text: 'Back at 2', emoji: '🍔' });
  assert.deepEqual(await setStatus(db, 2, { statusText: 'x'.repeat(100), statusEmoji: '👨‍👩‍👧‍👦' }), {
    text: 'x'.repeat(100),
    emoji: '👨‍👩‍👧‍👦',
  });
  await assert.rejects(() => setStatus(db, 2, { statusText: 'x'.repeat(101) }), {
    code: 'bad_preference',
    status: 400,
  });
  await assert.rejects(() => setStatus(db, 2, { statusEmoji: 'e'.repeat(17) }), {
    code: 'bad_preference',
    status: 400,
  });
  await assert.rejects(() => setStatus(db, 2, { statusText: 5 }), { code: 'bad_preference', status: 400 });
  assert.equal((await getPreferences(db, 2)).statusText, 'x'.repeat(100), 'refused writes change nothing');
});

test('setChannelNotifyPref sets the member row; null for a non-member; listChannelsForUser carries notifyPref', async () => {
  const {
    rows: [g],
  } = await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`);
  let list = await listChannelsForUser(db, 2);
  assert.equal(list.find((c) => c.id === g.id).notifyPref, 'default');
  assert.equal(await setChannelNotifyPref(db, g.id, 2, 'nothing'), 'nothing');
  list = await listChannelsForUser(db, 2);
  assert.equal(list.find((c) => c.id === g.id).notifyPref, 'nothing');
  assert.equal((await listChannelsForUser(db, 3)).find((c) => c.id === g.id).notifyPref, 'default', 'per member');
  assert.equal(await setChannelNotifyPref(db, g.id, 4, 'all'), null, 'user 4 is not a member');
});

test('every channel object carries notifyPref (default "default")', async () => {
  const ch = await createChannel(db, { displayName: 'Team', type: 'private', createdBy: 1, memberIds: [2] });
  assert.equal(ch.notifyPref, 'default');
  assert.equal((await getChannel(db, ch.id)).notifyPref, 'default');
  assert.equal((await openDm(db, 1, 2)).notifyPref, 'default');
});

test('the colour theme is saved with the preferences and comes back as { mode, accent }', async () => {
  await db.query(`DELETE FROM chat.user_preferences WHERE user_id = 5`);
  assert.equal((await getPreferences(db, 5)).theme, null, 'not chosen yet');
  const saved = await updatePreferences(db, 5, { theme: { mode: 'dark', accent: 'ocean', extra: 'ignored' } });
  assert.deepEqual(saved.theme, { mode: 'dark', accent: 'ocean' });
  assert.deepEqual((await getPreferences(db, 5)).theme, { mode: 'dark', accent: 'ocean' });
  const {
    rows: [row],
  } = await db.query(`SELECT theme FROM chat.user_preferences WHERE user_id = 5`);
  assert.equal(row.theme, '{"mode":"dark","accent":"ocean"}', 'only the two known keys are stored');
  // Changing something else keeps it.
  assert.deepEqual((await updatePreferences(db, 5, { soundEnabled: false })).theme, { mode: 'dark', accent: 'ocean' });
});

test('a theme that is not one of the known modes and accents is refused', async () => {
  for (const theme of [
    'dark',
    null,
    {},
    { mode: 'dark' },
    { mode: 'neon', accent: 'ocean' },
    { mode: 'dark', accent: 'teal' },
  ])
    await assert.rejects(updatePreferences(db, 5, { theme }), { code: 'bad_preference' }, JSON.stringify(theme));
});

test('a row written before themes existed reads as "not chosen"', async () => {
  await db.query(`UPDATE chat.user_preferences SET theme = 'not json' WHERE user_id = 5`);
  assert.equal((await getPreferences(db, 5)).theme, null);
});
