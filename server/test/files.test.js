import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { mkdtempSync, readdirSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import { requireAuth } from '../src/middleware/auth.js';
import { createFileRoutes } from '../src/routes/files.routes.js';
import { safeFilename, ALLOWED_MIME, MAX_FILE_BYTES } from '../src/services/files/storage.js';
import { perUserLimiter } from '../src/middleware/rate-limit.js';

const secret = 's'.repeat(40),
  aud = 'rrs-crm-session';
const token = (id) => `Bearer ${jwt.sign({ sub: id, aud }, secret, { expiresIn: '1h' })}`;
const user = { id: 7, email: 'a@b.c', full_name: 'Ann', role: 'cs_agent', is_approved: true, is_active: true };
const uploadsDir = mkdtempSync(join(tmpdir(), 'chat-up-'));
mkdirSync(join(uploadsDir, 'c1'));
after(() => rmSync(uploadsDir, { recursive: true, force: true }));
const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#2563EB' } })
  .png()
  .toBuffer();
const msgRow = {
  id: 'm1',
  channel_id: 'c1',
  user_id: 7,
  user_name: 'Ann',
  content: '',
  type: 'file',
  created_at: '2026-09-29T10:00:00.000Z',
  edited_at: null,
  reply_to_id: null,
  thread_id: null,
  pinned: false,
  reactions: [],
  files: [],
};

function makeDb({ member = true } = {}) {
  const calls = [];
  const inserted = [];
  return {
    calls,
    inserted,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/LEFT JOIN account_locks/.test(sql)) return { rows: [user], rowCount: 1 };
      if (/FROM chat\.channel_members WHERE channel_id = \$1 AND user_id = \$2/.test(sql))
        return { rows: member ? [{ ok: 1 }] : [], rowCount: member ? 1 : 0 };
      if (/INSERT INTO chat\.messages/.test(sql)) return { rows: [{ id: 'm1' }], rowCount: 1 };
      if (/WHERE x\.id = \$1/.test(sql)) return { rows: [msgRow], rowCount: 1 };
      if (/INSERT INTO chat\.files/.test(sql)) {
        const row = {
          id: `f${inserted.length + 1}`,
          channel_id: params[1],
          filename: params[3],
          mime_type: params[4],
          size_bytes: params[5],
          file_path: params[6],
          thumbnail_path: params[7],
        };
        inserted.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/FROM chat\.files f JOIN chat\.messages m ON m\.id = f\.message_id WHERE f\.id = \$1/.test(sql)) {
        const f = inserted.find((x) => x.id === params[0]);
        return { rows: f ? [f] : [], rowCount: f ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}
function app(db, emitted = []) {
  const a = express();
  a.use(
    '/api/chat',
    requireAuth({ db, secret, aud }),
    createFileRoutes({
      db,
      emit: { toChannel: (c, e, p) => emitted.push({ c, e, p }), toUser() {} },
      uploadsDir,
      limiter: perUserLimiter({ windowMs: 60_000, max: 5 }),
    }),
  );
  return a;
}
const countOnDisk = () => readdirSync(join(uploadsDir, 'c1')).length;

test('safeFilename strips paths and control characters', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'passwd');
  assert.equal(safeFilename('C:\\x\\y\\Report Q3.pdf'), 'Report Q3.pdf');
  assert.equal(safeFilename('a\u0000b.txt'), 'ab.txt');
  assert.equal(safeFilename(''), 'file');
  assert.ok(
    ALLOWED_MIME.has('image/png') &&
      ALLOWED_MIME.has('application/pdf') &&
      !ALLOWED_MIME.has('application/x-msdownload'),
  );
  assert.equal(MAX_FILE_BYTES, 20 * 1024 * 1024);
});

test('a PNG upload stores the file, makes a 200px thumbnail, creates a file message and broadcasts it', async () => {
  const emitted = [];
  const db = makeDb();
  const r = await request(app(db, emitted))
    .post('/api/chat/channels/c1/upload')
    .set('Authorization', token(7))
    .field('content', 'look at this')
    .attach('files', png, { filename: 'shot.png', contentType: 'image/png' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(db.inserted.length, 1);
  assert.equal(db.inserted[0].mime_type, 'image/png');
  assert.match(db.inserted[0].file_path, /^c1\/[0-9a-f-]{36}-shot\.png$/);
  assert.ok(db.inserted[0].thumbnail_path && existsSync(join(uploadsDir, db.inserted[0].thumbnail_path)));
  const meta = await sharp(join(uploadsDir, db.inserted[0].thumbnail_path)).metadata();
  assert.equal(meta.width, 200);
  const msgIns = db.calls.find((c) => /INSERT INTO chat\.messages/.test(c.sql));
  assert.equal(msgIns.params[2], 'look at this');
  assert.equal(msgIns.params[3], 'file');
  assert.equal(emitted[0].e, 'new_message');
});

test('too large, disallowed type, and no file are refused and leave nothing on disk', async () => {
  const before = countOnDisk();
  const a = app(makeDb());
  const big = Buffer.alloc(MAX_FILE_BYTES + 1, 1);
  let r = await request(a)
    .post('/api/chat/channels/c1/upload')
    .set('Authorization', token(7))
    .attach('files', big, { filename: 'big.bin', contentType: 'application/pdf' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'file_too_large');
  r = await request(a)
    .post('/api/chat/channels/c1/upload')
    .set('Authorization', token(7))
    .attach('files', Buffer.from('MZ'), { filename: 'x.exe', contentType: 'application/x-msdownload' });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'file_type');
  r = await request(a)
    .post('/api/chat/channels/c1/upload')
    .set('Authorization', token(7))
    .field('content', 'nothing attached');
  assert.equal(r.status, 400);
  assert.equal(r.body.code, 'no_files');
  assert.equal(countOnDisk(), before, 'nothing new on disk');
});

test('download: member streams the file as an attachment; non-member gets 403 and no bytes; svg is never inline', async () => {
  const db = makeDb();
  const a = app(db);
  await request(a)
    .post('/api/chat/channels/c1/upload')
    .set('Authorization', token(7))
    .attach('files', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), {
      filename: 'logo.svg',
      contentType: 'image/svg+xml',
    });
  const id = db.inserted.at(-1).id;
  const ok = await request(a).get(`/api/chat/files/${id}/download`).set('Authorization', token(7));
  assert.equal(ok.status, 200);
  assert.match(ok.headers['content-disposition'], /attachment; filename="logo\.svg"/);
  assert.equal(ok.headers['content-type'].split(';')[0], 'application/octet-stream');
  const nonMember = makeDb({ member: false });
  nonMember.inserted.push(db.inserted.at(-1));
  const no = await request(app(nonMember)).get(`/api/chat/files/${id}/download`).set('Authorization', token(7));
  assert.equal(no.status, 403);
  assert.equal(no.text.includes('svg'), false);
});

test('a UTF-8 filename survives the multipart upload and the download header carries it safely', async () => {
  const db = makeDb();
  const a = app(db);
  const name = 'Client’s letter é.pdf';
  const r = await request(a)
    .post('/api/chat/channels/c1/upload')
    .set('Authorization', token(7))
    .attach('files', Buffer.from('%PDF-1.4'), { filename: name, contentType: 'application/pdf' });
  assert.equal(r.status, 201);
  assert.equal(db.inserted.at(-1).filename, name);
  const dl = await request(a)
    .get(`/api/chat/files/${db.inserted.at(-1).id}/download`)
    .set('Authorization', token(7));
  assert.equal(dl.status, 200);
  assert.match(
    dl.headers['content-disposition'],
    /^attachment; filename="Client_s letter _\.pdf"; filename\*=UTF-8''Client%E2%80%99s%20letter%20%C3%A9\.pdf$/,
  );
});
