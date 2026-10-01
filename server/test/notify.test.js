// Web Push notifier on real Postgres (PGlite) with a fake web-push and a fake presence registry:
// the recipient rule, the exact payloads, dead-subscription cleanup and "never rejects".
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './pg-helper.js';
import { createNotifier } from '../src/services/notifications/notifier.js';

// Users: 1 Meg Manager, 2 Ann Agent, 3 Bob Sales, 4 Gone (inactive), 5 Cy Sales. #general = 1,2,3,5.
const MEG = 1,
  ANN = 2,
  BOB = 3,
  GONE = 4,
  CY = 5;
const config = { vapidPublic: 'BPUB', vapidPrivate: 'PRIV', vapidSubject: 'mailto:test@example.com' };
const ep = (id) => `https://push.example/u${id}`;

let t, db, general, dm, gdm;
before(async () => {
  t = await createTestDb();
  db = t.db;
  general = (await db.query(`SELECT id FROM chat.channels WHERE name = 'general'`)).rows[0].id;
  dm = (
    await db.query(
      `INSERT INTO chat.channels (name, display_name, type, created_by) VALUES ('dm-1-2', 'Meg Manager, Ann Agent', 'dm', 1) RETURNING id`,
    )
  ).rows[0].id;
  gdm = (
    await db.query(
      `INSERT INTO chat.channels (name, display_name, type, created_by) VALUES ('gdm', 'Meg, Ann, Bob', 'group_dm', 1) RETURNING id`,
    )
  ).rows[0].id;
  for (const [c, u] of [
    [dm, MEG],
    [dm, ANN],
    [gdm, MEG],
    [gdm, ANN],
    [gdm, BOB],
    [general, GONE],
  ]) {
    await db.query(`INSERT INTO chat.channel_members (channel_id, user_id) VALUES ($1, $2)`, [c, u]);
  }
});
after(async () => {
  await t.close();
});
beforeEach(async () => {
  await db.query(`DELETE FROM chat.push_subscriptions`);
  await db.query(`DELETE FROM chat.user_preferences`);
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'default'`);
  for (const u of [MEG, ANN, BOB, GONE, CY]) {
    await db.query(`INSERT INTO chat.push_subscriptions (user_id, endpoint, keys) VALUES ($1, $2, $3)`, [
      u,
      ep(u),
      JSON.stringify({ p256dh: `p${u}`, auth: `a${u}` }),
    ]);
  }
});

function fakeWebpush(fail = () => null) {
  const sends = [];
  return {
    sends,
    async sendNotification(subscription, payload, options) {
      sends.push({ subscription, payload: JSON.parse(payload), raw: payload, options });
      const err = fail(subscription.endpoint);
      if (err) throw err;
      return { statusCode: 201 };
    },
  };
}
const presenceOf = (connected = []) => ({ isConnected: (id) => connected.includes(id) });
const msg = (over = {}) => ({ id: 'm1', type: 'message', content: 'hello', threadId: null, files: [], ...over });

// ---------------------------------------------------------------- recipient rule
const ruleCases = [
  // channel type, channel notify_pref, user desktop_notif (null = no preferences row), mentioned, @all, connected, pushed?
  ['public', 'default', null, false, false, false, false],
  ['public', 'default', null, true, false, false, true],
  ['public', 'default', null, false, true, false, true],
  ['public', 'default', 'mentions', false, false, false, false],
  ['public', 'default', 'all', false, false, false, true],
  ['public', 'default', 'nothing', true, false, false, false],
  ['public', 'default', 'nothing', false, true, false, false],
  ['public', 'all', 'nothing', false, false, false, true],
  ['public', 'mentions', 'all', false, false, false, false],
  ['public', 'mentions', 'all', true, false, false, true],
  ['public', 'mentions', 'nothing', false, true, false, true],
  ['public', 'nothing', 'all', true, false, false, false],
  ['public', 'nothing', null, false, true, false, false],
  ['public', 'default', 'all', false, false, true, false],
  ['public', 'all', null, true, false, true, false],
  ['dm', 'default', null, false, false, false, true],
  ['dm', 'default', 'mentions', false, false, false, true],
  ['dm', 'default', 'nothing', false, false, false, false],
  ['dm', 'mentions', null, false, false, false, true],
  ['dm', 'nothing', 'all', false, false, false, false],
  ['dm', 'default', null, false, false, true, false],
  ['group_dm', 'default', null, false, false, false, true],
  ['group_dm', 'nothing', null, false, false, false, false],
];

for (const [type, chanPref, userPref, mentioned, mentionAll, connected, expected] of ruleCases) {
  const name = `rule: ${type} channel=${chanPref} user=${userPref ?? '(none)'}${mentioned ? ' mentioned' : ''}${mentionAll ? ' @all' : ''}${connected ? ' connected' : ''} -> ${expected ? 'push' : 'no push'}`;
  test(name, async () => {
    const channelId = type === 'public' ? general : type === 'dm' ? dm : gdm;
    await db.query(`UPDATE chat.channel_members SET notify_pref = $3 WHERE channel_id = $1 AND user_id = $2`, [
      channelId,
      ANN,
      chanPref,
    ]);
    if (userPref)
      await db.query(`INSERT INTO chat.user_preferences (user_id, desktop_notif) VALUES ($1, $2)`, [ANN, userPref]);
    const webpush = fakeWebpush();
    const n = createNotifier({ db, presence: presenceOf(connected ? [ANN] : []), config, webpush });
    await n.onMessage({
      message: msg(),
      channelId,
      senderId: MEG,
      senderName: 'Meg Manager',
      mentionedUserIds: mentioned ? [ANN] : [],
      mentionAll,
    });
    const toAnn = webpush.sends.filter((s) => s.subscription.endpoint === ep(ANN));
    assert.equal(toAnn.length, expected ? 1 : 0);
    assert.ok(!webpush.sends.some((s) => s.subscription.endpoint === ep(MEG)), 'never the sender');
  });
}

test('the sender, inactive and unapproved members are never pushed; everyone else whose level allows is', async () => {
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'all' WHERE channel_id = $1`, [general]);
  await db.query(`UPDATE users SET is_approved = false WHERE id = $1`, [CY]);
  try {
    const webpush = fakeWebpush();
    const n = createNotifier({ db, presence: presenceOf([]), config, webpush });
    await n.onMessage({
      message: msg(),
      channelId: general,
      senderId: MEG,
      senderName: 'Meg Manager',
      mentionedUserIds: [],
      mentionAll: false,
    });
    assert.deepEqual(webpush.sends.map((s) => s.subscription.endpoint).sort(), [ep(ANN), ep(BOB)]);
    assert.deepEqual(webpush.sends[0].subscription.keys, {
      p256dh: `p${webpush.sends[0].subscription.endpoint.slice(-1)}`,
      auth: `a${webpush.sends[0].subscription.endpoint.slice(-1)}`,
    });
  } finally {
    await db.query(`UPDATE users SET is_approved = true WHERE id = $1`, [CY]);
  }
});

test('system, join, leave and call messages are never pushed; a thread reply is', async () => {
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'all' WHERE channel_id = $1`, [general]);
  for (const type of ['system', 'join', 'leave', 'call']) {
    const webpush = fakeWebpush();
    await createNotifier({ db, presence: presenceOf([]), config, webpush }).onMessage({
      message: msg({ type }),
      channelId: general,
      senderId: MEG,
      senderName: 'Meg Manager',
      mentionedUserIds: [],
      mentionAll: true,
    });
    assert.equal(webpush.sends.length, 0, type);
  }
  const webpush = fakeWebpush();
  await createNotifier({ db, presence: presenceOf([]), config, webpush }).onMessage({
    message: msg({ threadId: 'root' }),
    channelId: general,
    senderId: MEG,
    senderName: 'Meg Manager',
    mentionedUserIds: [],
    mentionAll: false,
  });
  assert.equal(webpush.sends.length, 3);
});

// ---------------------------------------------------------------- payloads
async function sendOne(message, channelId = general) {
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'all' WHERE channel_id = $1 AND user_id = $2`, [
    channelId,
    ANN,
  ]);
  const webpush = fakeWebpush();
  await createNotifier({ db, presence: presenceOf([BOB, CY]), config, webpush }).onMessage({
    message,
    channelId,
    senderId: MEG,
    senderName: 'Meg Manager',
    mentionedUserIds: [],
    mentionAll: false,
  });
  assert.equal(webpush.sends.length, 1);
  return webpush.sends[0];
}

test('payload: channel message (whitespace collapsed), options TTL 86400 normal, VAPID details', async () => {
  const s = await sendOne(msg({ content: '  hello\n\n   world\tagain ' }));
  assert.equal(
    s.raw,
    JSON.stringify({
      kind: 'message',
      title: '#General',
      body: 'Meg Manager: hello world again',
      channelId: general,
      tag: general,
    }),
  );
  assert.equal(s.options.TTL, 86400);
  assert.equal(s.options.urgency, 'normal');
  assert.deepEqual(s.options.vapidDetails, {
    subject: 'mailto:test@example.com',
    publicKey: 'BPUB',
    privateKey: 'PRIV',
  });
});

test('payload: long message is cut to its first 140 characters plus an ellipsis', async () => {
  const s = await sendOne(msg({ content: 'x'.repeat(200) }));
  assert.equal(s.payload.body, `Meg Manager: ${'x'.repeat(140)}…`);
  const exact = await sendOne(msg({ content: 'y'.repeat(140) }));
  assert.equal(exact.payload.body, `Meg Manager: ${'y'.repeat(140)}`);
});

test("payload: DM title is the sender's name", async () => {
  const s = await sendOne(msg({ content: 'hi' }), dm);
  assert.equal(
    s.raw,
    JSON.stringify({ kind: 'message', title: 'Meg Manager', body: 'Meg Manager: hi', channelId: dm, tag: dm }),
  );
});

test('payload: file message', async () => {
  const s = await sendOne(msg({ type: 'file', content: 'caption', files: [{ id: 'f1' }] }));
  assert.equal(
    s.raw,
    JSON.stringify({
      kind: 'message',
      title: '#General',
      body: 'Meg Manager sent a file',
      channelId: general,
      tag: general,
    }),
  );
});

const call = { id: 'c1', channelId: null, status: 'ringing' };
test('payload: incoming call in a channel and in a DM (TTL 30, urgency high)', async () => {
  let webpush = fakeWebpush();
  await createNotifier({ db, presence: presenceOf([]), config, webpush }).onIncomingCall({
    call,
    channel: { id: general, type: 'public', displayName: 'General' },
    fromName: 'Meg Manager',
    userIds: [ANN],
  });
  assert.equal(webpush.sends.length, 1);
  assert.equal(
    webpush.sends[0].raw,
    JSON.stringify({
      kind: 'call',
      title: 'Incoming call',
      body: 'Meg Manager is calling in #General',
      channelId: general,
      tag: general,
    }),
  );
  assert.equal(webpush.sends[0].options.TTL, 30);
  assert.equal(webpush.sends[0].options.urgency, 'high');
  webpush = fakeWebpush();
  await createNotifier({ db, presence: presenceOf([]), config, webpush }).onIncomingCall({
    call,
    channel: { id: dm, type: 'dm', displayName: 'x' },
    fromName: 'Meg Manager',
    userIds: [ANN],
  });
  assert.equal(
    webpush.sends[0].raw,
    JSON.stringify({
      kind: 'call',
      title: 'Incoming call',
      body: 'Meg Manager is calling you',
      channelId: dm,
      tag: dm,
    }),
  );
});

test('payload: missed call in a channel and in a DM', async () => {
  let webpush = fakeWebpush();
  await createNotifier({ db, presence: presenceOf([]), config, webpush }).onMissedCall({
    call,
    channel: { id: general, type: 'public', displayName: 'General' },
    fromName: 'Meg Manager',
    userIds: [ANN],
  });
  assert.equal(
    webpush.sends[0].raw,
    JSON.stringify({
      kind: 'missed_call',
      title: 'Missed call',
      body: 'Meg Manager called in #General',
      channelId: general,
      tag: general,
    }),
  );
  assert.equal(webpush.sends[0].options.TTL, 86400);
  assert.equal(webpush.sends[0].options.urgency, 'normal');
  webpush = fakeWebpush();
  await createNotifier({ db, presence: presenceOf([]), config, webpush }).onMissedCall({
    call,
    channel: { id: dm, type: 'dm', displayName: 'x' },
    fromName: 'Meg Manager',
    userIds: [ANN],
  });
  assert.equal(
    webpush.sends[0].raw,
    JSON.stringify({
      kind: 'missed_call',
      title: 'Missed call',
      body: 'Meg Manager called you',
      channelId: dm,
      tag: dm,
    }),
  );
});

test('calls: only listed, not connected, active members; muted channel or user-level nothing skips; mentions-level still rings', async () => {
  await db.query(`INSERT INTO chat.user_preferences (user_id, desktop_notif) VALUES ($1, 'nothing'), ($2, 'nothing')`, [
    ANN,
    CY,
  ]);
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'mentions' WHERE channel_id = $1 AND user_id = $2`, [
    general,
    CY,
  ]); // channel pref beats user 'nothing'
  const webpush = fakeWebpush();
  const n = createNotifier({ db, presence: presenceOf([BOB]), config, webpush });
  await n.onIncomingCall({
    call,
    channel: { id: general, type: 'public', displayName: 'General' },
    fromName: 'Meg Manager',
    userIds: [ANN, BOB, CY, GONE],
  });
  assert.deepEqual(
    webpush.sends.map((s) => s.subscription.endpoint),
    [ep(CY)],
  );
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'nothing' WHERE channel_id = $1 AND user_id = $2`, [
    general,
    CY,
  ]);
  const w2 = fakeWebpush();
  await createNotifier({ db, presence: presenceOf([]), config, webpush: w2 }).onMissedCall({
    call,
    channel: { id: general, type: 'public', displayName: 'General' },
    fromName: 'Meg Manager',
    userIds: [CY, BOB],
  });
  assert.deepEqual(
    w2.sends.map((s) => s.subscription.endpoint),
    [ep(BOB)],
  );
});

// ---------------------------------------------------------------- failures
test('404 and 410 delete that subscription; other failures are logged and the subscription kept', async () => {
  await db.query(
    `INSERT INTO chat.push_subscriptions (user_id, endpoint, keys) VALUES ($1, 'https://push.example/gone404', '{"p256dh":"x","auth":"y"}'), ($1, 'https://push.example/flaky', '{"p256dh":"x","auth":"y"}')`,
    [ANN],
  );
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a);
  try {
    const webpush = fakeWebpush((endpoint) =>
      endpoint === ep(ANN)
        ? Object.assign(new Error('Gone'), { statusCode: 410 })
        : endpoint.endsWith('gone404')
          ? Object.assign(new Error('Not found'), { statusCode: 404 })
          : endpoint.endsWith('flaky')
            ? Object.assign(new Error('Server error'), { statusCode: 500 })
            : null,
    );
    await db.query(`UPDATE chat.channel_members SET notify_pref = 'all' WHERE channel_id = $1 AND user_id = $2`, [
      dm,
      ANN,
    ]);
    await createNotifier({ db, presence: presenceOf([]), config, webpush }).onMessage({
      message: msg(),
      channelId: dm,
      senderId: MEG,
      senderName: 'Meg Manager',
      mentionedUserIds: [],
      mentionAll: false,
    });
    assert.equal(webpush.sends.length, 3);
  } finally {
    console.error = orig;
  }
  const left = (await db.query(`SELECT endpoint FROM chat.push_subscriptions WHERE user_id = $1`, [ANN])).rows.map(
    (r) => r.endpoint,
  );
  assert.deepEqual(left, ['https://push.example/flaky']);
  assert.equal(errs.length, 1);
  assert.equal(errs[0][0], '[chat] push');
});

test('never rejects: db throws, webpush throws synchronously, bad arguments', async () => {
  const errs = [];
  const orig = console.error;
  console.error = (...a) => errs.push(a);
  try {
    const badDb = {
      async query() {
        throw new Error('db down');
      },
    };
    const n = createNotifier({ db: badDb, presence: presenceOf([]), config, webpush: fakeWebpush() });
    assert.equal(
      await n.onMessage({
        message: msg(),
        channelId: general,
        senderId: MEG,
        senderName: 'M',
        mentionedUserIds: [],
        mentionAll: false,
      }),
      undefined,
    );
    assert.equal(
      await n.onIncomingCall({
        call,
        channel: { id: general, type: 'public', displayName: 'General' },
        fromName: 'M',
        userIds: [ANN],
      }),
      undefined,
    );
    assert.equal(
      await n.onMissedCall({
        call,
        channel: { id: general, type: 'public', displayName: 'General' },
        fromName: 'M',
        userIds: [ANN],
      }),
      undefined,
    );
    const throwing = {
      sendNotification() {
        throw new Error('sync boom');
      },
    };
    await createNotifier({ db, presence: presenceOf([]), config, webpush: throwing }).onMessage({
      message: msg(),
      channelId: dm,
      senderId: MEG,
      senderName: 'M',
      mentionedUserIds: [],
      mentionAll: false,
    });
    const n2 = createNotifier({ db, presence: null, config, webpush: fakeWebpush() });
    await n2.onMessage(undefined);
    await n2.onIncomingCall(undefined);
    await n2.onMissedCall({});
  } finally {
    console.error = orig;
  }
  assert.ok(errs.length >= 1);
  assert.ok(errs.every((e) => e[0] === '[chat] push'));
});

test('inert without VAPID keys (or without config): no queries, no sends', async () => {
  const calls = [];
  const spyDb = {
    async query(sql, p) {
      calls.push(sql);
      return db.query(sql, p);
    },
  };
  const webpush = fakeWebpush();
  for (const cfg of [
    {},
    undefined,
    { vapidPublic: 'BPUB', vapidPrivate: '' },
    { vapidPublic: '', vapidPrivate: 'PRIV' },
  ]) {
    const n = createNotifier({ db: spyDb, presence: presenceOf([]), config: cfg, webpush });
    await n.onMessage({
      message: msg(),
      channelId: dm,
      senderId: MEG,
      senderName: 'M',
      mentionedUserIds: [],
      mentionAll: true,
    });
    await n.onIncomingCall({ call, channel: { id: dm, type: 'dm', displayName: 'x' }, fromName: 'M', userIds: [ANN] });
    await n.onMissedCall({ call, channel: { id: dm, type: 'dm', displayName: 'x' }, fromName: 'M', userIds: [ANN] });
  }
  assert.equal(calls.length, 0);
  assert.equal(webpush.sends.length, 0);
  const bare = createNotifier();
  assert.equal(await bare.onMessage({}), undefined);
});

// ---------------------------------------------------------------- hardening
test('every send carries a 10 s timeout (message, call, missed call)', async () => {
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'all' WHERE channel_id = $1 AND user_id = $2`, [
    dm,
    ANN,
  ]);
  const webpush = fakeWebpush();
  const n = createNotifier({ db, presence: presenceOf([]), config, webpush });
  await n.onMessage({
    message: msg(),
    channelId: dm,
    senderId: MEG,
    senderName: 'Meg Manager',
    mentionedUserIds: [],
    mentionAll: false,
  });
  await n.onIncomingCall({
    call,
    channel: { id: dm, type: 'dm', displayName: 'x' },
    fromName: 'Meg Manager',
    userIds: [ANN],
  });
  await n.onMissedCall({
    call,
    channel: { id: dm, type: 'dm', displayName: 'x' },
    fromName: 'Meg Manager',
    userIds: [ANN],
  });
  assert.deepEqual(
    webpush.sends.map((s) => s.payload.kind),
    ['message', 'call', 'missed_call'],
  );
  for (const s of webpush.sends) assert.equal(s.options.timeout, 10000, s.payload.kind);
});

test('preview cuts by code points, never splitting an emoji', async () => {
  const s = await sendOne(msg({ content: '😀'.repeat(141) }));
  assert.equal(s.payload.body, `Meg Manager: ${'😀'.repeat(140)}…`);
  assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(s.payload.body), 'no lone high surrogate');
});

test('an archived channel pushes nobody (messages and calls)', async () => {
  await db.query(`UPDATE chat.channel_members SET notify_pref = 'all' WHERE channel_id = $1 AND user_id = $2`, [
    dm,
    ANN,
  ]);
  await db.query(`UPDATE chat.channels SET archived_at = now() WHERE id = $1`, [dm]);
  try {
    const webpush = fakeWebpush();
    const n = createNotifier({ db, presence: presenceOf([]), config, webpush });
    await n.onMessage({
      message: msg(),
      channelId: dm,
      senderId: MEG,
      senderName: 'Meg Manager',
      mentionedUserIds: [],
      mentionAll: false,
    });
    await n.onIncomingCall({
      call,
      channel: { id: dm, type: 'dm', displayName: 'x' },
      fromName: 'Meg Manager',
      userIds: [ANN],
    });
    assert.equal(webpush.sends.length, 0);
  } finally {
    await db.query(`UPDATE chat.channels SET archived_at = NULL WHERE id = $1`, [dm]);
  }
});
