// Security items from the 1 October 2026 checklist review:
// per-person IP restriction, upload content checks, security headers, the general request ceiling.
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';
import { parseIpEntry, ipAllowedBy, accessIp } from '../src/utils/ipRestriction.js';
import { contentMatchesType, CHECKED_TYPES } from '../src/utils/fileSignature.js';
import { ALLOWED_MIME } from '../src/services/files/storage.js';
import { checkUploads } from '../src/services/files/upload.service.js';
import { sessionUser, IP_REFUSED_MESSAGE } from '../src/services/session.service.js';
import { requireAuth, socketAuth } from '../src/middleware/auth.js';
import { securityHeaders, CONTENT_SECURITY_POLICY } from '../src/middleware/securityHeaders.js';
import { loadConfig } from '../src/config/index.js';
import { createApp } from '../src/app.js';
import { createTestDb } from './pg-helper.js';

const OFFICE = '203.0.113.17'; // documentation ranges only
const HOME = '198.51.100.44';
const secret = 'test-secret-'.padEnd(40, 'x');
const aud = 'rrs-crm-session';
const tokenFor = (userId) => jwt.sign({ sub: userId, aud }, secret, { expiresIn: 3600 });
const quiet = () => {};

// ── IP restriction: the pure rules ─────────────────────────────────────────────

test('an entry is a single address or a range; anything else is not an entry', () => {
  assert.deepEqual(parseIpEntry(' 203.0.113.0/24 '), { address: '203.0.113.0', prefix: 24, family: 'ipv4' });
  assert.deepEqual(parseIpEntry('2001:db8::/32'), { address: '2001:db8::', prefix: 32, family: 'ipv6' });
  for (const bad of ['office', '203.0.113', '203.0.113.17/33', '203.0.113.*', '', null, 7])
    assert.equal(parseIpEntry(bad), null);
});

test('an empty list, or one with no usable entry, restricts nothing', () => {
  assert.equal(ipAllowedBy([], HOME), true);
  assert.equal(ipAllowedBy(undefined, HOME), true);
  assert.equal(ipAllowedBy(['the office'], HOME), true);
});

test('a listed address or range is let in; anything else, or an unknown address, is not', () => {
  assert.equal(ipAllowedBy([OFFICE], OFFICE), true);
  assert.equal(ipAllowedBy(['203.0.113.0/24'], '203.0.113.200'), true);
  assert.equal(ipAllowedBy([OFFICE], HOME), false);
  assert.equal(ipAllowedBy([OFFICE], ''), false);
  assert.equal(ipAllowedBy([OFFICE], '2001:db8::1'), false);
});

test("the address used is Cloudflare's, never the forgeable forwarded chain", () => {
  assert.equal(accessIp({ 'cf-connecting-ip': HOME, 'x-forwarded-for': OFFICE }, '127.0.0.1'), HOME);
  assert.equal(accessIp({ 'x-forwarded-for': OFFICE }, '::ffff:192.0.2.9'), '192.0.2.9');
  assert.equal(accessIp({ 'cf-connecting-ip': 'let me in' }, '192.0.2.9'), '192.0.2.9');
  assert.equal(accessIp({}, undefined), '');
});

// ── IP restriction: against a real (in-process) database ──────────────────────

test('a restricted person is refused from elsewhere and let in from a listed address', async () => {
  const { db, pg, close } = await createTestDb();
  try {
    await pg.exec(`UPDATE users SET ip_restriction = ARRAY['${OFFICE}'] WHERE id = 3`);
    const claims = { userId: 3, iat: Math.floor(Date.now() / 1000) };

    const inside = await sessionUser({ db, claims, ip: OFFICE, log: quiet });
    assert.equal(inside.id, 3);
    assert.equal('ipRestriction' in inside, false, 'the list never travels with the person');

    await assert.rejects(sessionUser({ db, claims, ip: HOME, log: quiet }), {
      code: 'ip_not_allowed',
      message: IP_REFUSED_MESSAGE,
    });

    // Someone with no restriction is unaffected.
    assert.equal((await sessionUser({ db, claims: { userId: 2, iat: claims.iat }, ip: HOME, log: quiet })).id, 2);
  } finally {
    await close();
  }
});

test('with enforcement off it only logs what it would refuse', async () => {
  const { db, pg, close } = await createTestDb();
  try {
    await pg.exec(`UPDATE users SET ip_restriction = ARRAY['${OFFICE}'] WHERE id = 3`);
    const lines = [];
    const user = await sessionUser({
      db,
      claims: { userId: 3, iat: null },
      ip: HOME,
      enforceIp: false,
      log: (l) => lines.push(l),
    });
    assert.equal(user.id, 3);
    assert.match(lines[0], /would refuse user #3 from 198\.51\.100\.44/);
  } finally {
    await close();
  }
});

test('every API request applies it: 401 with the reason from outside, 200 from inside', async () => {
  const { db, pg, close } = await createTestDb();
  const origWarn = console.warn;
  console.warn = quiet;
  try {
    await pg.exec(`UPDATE users SET ip_restriction = ARRAY['${OFFICE}'] WHERE id = 3`);
    const app = express();
    app.use(requireAuth({ db, secret, aud }));
    app.get('/me', (req, res) => res.json({ id: req.user.id, hasList: 'ipRestriction' in req.user }));

    const outside = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${tokenFor(3)}`)
      .set('CF-Connecting-IP', HOME);
    assert.equal(outside.status, 401);
    assert.equal(outside.body.tokenError, 'ip_not_allowed');
    assert.equal(outside.body.message, IP_REFUSED_MESSAGE);

    const inside = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${tokenFor(3)}`)
      .set('CF-Connecting-IP', OFFICE);
    assert.equal(inside.status, 200);
    assert.deepEqual(inside.body, { id: 3, hasList: false });

    // A forged forwarded header does not help.
    const forged = await request(app)
      .get('/me')
      .set('Authorization', `Bearer ${tokenFor(3)}`)
      .set('CF-Connecting-IP', HOME)
      .set('X-Forwarded-For', OFFICE);
    assert.equal(forged.status, 401);
  } finally {
    console.warn = origWarn;
    await close();
  }
});

test('a live connection applies it at the handshake', async () => {
  const { db, pg, close } = await createTestDb();
  const origWarn = console.warn;
  console.warn = quiet;
  try {
    await pg.exec(`UPDATE users SET ip_restriction = ARRAY['${OFFICE}'] WHERE id = 3`);
    const connect = (ip) =>
      new Promise((resolve) => {
        const socket = {
          handshake: { auth: { token: tokenFor(3) }, headers: { 'cf-connecting-ip': ip }, address: '127.0.0.1' },
          data: {},
        };
        socketAuth({ db, secret, aud })(socket, (err) => resolve({ err, socket }));
      });
    const refused = await connect(HOME);
    assert.equal(refused.err?.message, 'ip_not_allowed');
    const accepted = await connect(OFFICE);
    assert.equal(accepted.err, undefined);
    assert.equal(accepted.socket.data.user.id, 3);
    assert.equal(accepted.socket.data.ip, OFFICE, 'remembered for the once-a-minute re-check');
  } finally {
    console.warn = origWarn;
    await close();
  }
});

test('the setting is on unless IP_RESTRICTION_ENFORCE is "false"', () => {
  const base = { SESSION_JWT_SECRET: secret };
  assert.equal(loadConfig(base).enforceIpRestriction, true);
  assert.equal(loadConfig({ ...base, IP_RESTRICTION_ENFORCE: 'true' }).enforceIpRestriction, true);
  assert.equal(loadConfig({ ...base, IP_RESTRICTION_ENFORCE: 'false' }).enforceIpRestriction, false);
});

// ── uploads: the content must be what the type says ──────────────────────────

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n');
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(16)]);
const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]);

test('every allowed file type has a content check', () => {
  assert.deepEqual([...ALLOWED_MIME.keys()].sort(), [...CHECKED_TYPES].sort());
});

test('real files pass; a file of another kind wearing the label does not', () => {
  assert.equal(contentMatchesType('image/png', PNG), true);
  assert.equal(contentMatchesType('image/jpeg', JPEG), true);
  assert.equal(contentMatchesType('application/pdf', PDF), true);
  assert.equal(
    contentMatchesType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', ZIP),
    true,
  );
  assert.equal(contentMatchesType('application/zip', ZIP), true);
  assert.equal(contentMatchesType('image/gif', Buffer.from('GIF89a........')), true);
  assert.equal(
    contentMatchesType(
      'image/webp',
      Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(8)]),
    ),
    true,
  );
  assert.equal(
    contentMatchesType('video/mp4', Buffer.concat([Buffer.alloc(4), Buffer.from('ftypisom'), Buffer.alloc(8)])),
    true,
  );
  assert.equal(
    contentMatchesType('video/webm', Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(8)])),
    true,
  );
  assert.equal(contentMatchesType('text/plain', Buffer.from('just some notes\nsecond line')), true);
  assert.equal(contentMatchesType('text/csv', Buffer.from('name,amount\nA,1\n')), true);
  assert.equal(
    contentMatchesType(
      'image/svg+xml',
      Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    ),
    true,
  );

  assert.equal(contentMatchesType('image/jpeg', EXE), false, 'a program renamed to a picture');
  assert.equal(contentMatchesType('image/png', JPEG), false);
  assert.equal(contentMatchesType('application/pdf', ZIP), false);
  assert.equal(contentMatchesType('text/plain', EXE), false, 'binary content is not text');
  assert.equal(contentMatchesType('image/svg+xml', Buffer.from('<html><script>1</script></html>')), false);
  assert.equal(contentMatchesType('image/png', Buffer.alloc(0)), false);
  assert.equal(contentMatchesType('application/x-msdownload', EXE), false, 'a type with no check is refused');
});

test('an upload whose content does not match its type is refused with its own code', () => {
  const file = (mimetype, buffer, originalname = 'photo.jpg') => ({ mimetype, buffer, originalname });
  assert.doesNotThrow(() => checkUploads([file('image/jpeg', JPEG)]));
  assert.throws(
    () => checkUploads([file('image/jpeg', EXE)]),
    (e) => e.status === 400 && e.code === 'file_content' && /does not match its type/.test(e.message),
  );
  assert.throws(
    () => checkUploads([file('application/x-msdownload', EXE, 'run.exe')]),
    (e) => e.code === 'file_type',
  );
  assert.throws(
    () => checkUploads([]),
    (e) => e.code === 'no_files',
  );
});

// ── headers and the request ceiling ──────────────────────────────────────────

test('every response carries the security headers', async () => {
  const app = express();
  app.use(securityHeaders);
  app.get('/x', (_req, res) => res.json({ ok: true }));
  const res = await request(app).get('/x');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.match(res.headers['strict-transport-security'], /max-age=31536000/);
  assert.match(res.headers['permissions-policy'], /camera=\(\)/);
  assert.match(res.headers['permissions-policy'], /microphone=\(self\)/, 'calls need the microphone');
  assert.match(res.headers['permissions-policy'], /display-capture=\(self\)/, 'screen sharing needs it');
  assert.equal(res.headers['content-security-policy'], CONTENT_SECURITY_POLICY);
});

test('the content policy allows only what the chat uses', () => {
  const csp = CONTENT_SECURITY_POLICY;
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/, 'no inline or third-party scripts');
  assert.match(csp, /connect-src 'self' ws: wss:/, 'the live connection');
  assert.match(csp, /img-src 'self' blob: data:/, 'attachments are shown from blobs');
  assert.match(csp, /media-src 'self' blob:/, 'call audio and shared screens');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.doesNotMatch(csp, /unsafe-eval/);
});

test('the whole app sends the headers, on API answers and on the page', async () => {
  const { db, close } = await createTestDb();
  try {
    const app = createApp({ config: { ...loadConfig({ SESSION_JWT_SECRET: secret }), uiDist: '/nonexistent' }, db });
    const health = await request(app).get('/health');
    assert.equal(health.status, 200);
    assert.ok(health.headers['content-security-policy']);
    assert.equal(health.headers['x-powered-by'], undefined);
    const api = await request(app).get('/api/chat/users/me');
    assert.equal(api.status, 401);
    assert.equal(api.headers['x-frame-options'], 'DENY');
  } finally {
    await close();
  }
});
