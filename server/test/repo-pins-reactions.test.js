import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addReaction, removeReaction, EMOJI_MAX } from '../src/repo/reactions.js';
import { pinMessage } from '../src/repo/pins.js';

const stub = (rows = {}) => { const calls = []; return { calls, async query(sql, p) { calls.push({ sql, p }); for (const [re, r] of Object.entries(rows)) if (new RegExp(re).test(sql)) return { rows: r, rowCount: r.length }; return { rows: [], rowCount: 0 }; } }; };

test('reactions: emoji validated; add is idempotent via ON CONFLICT DO NOTHING; remove reports whether a row went', async () => {
  await assert.rejects(() => addReaction(stub(), { messageId: 'm1', userId: 1, emoji: '<img>' }), { code: 'bad_emoji' });
  await assert.rejects(() => addReaction(stub(), { messageId: 'm1', userId: 1, emoji: 'x'.repeat(EMOJI_MAX + 1) }), { code: 'bad_emoji' });
  const db = stub({ 'INSERT INTO chat\\.reactions': [{ ok: 1 }] });
  assert.equal(await addReaction(db, { messageId: 'm1', userId: 1, emoji: '👍' }), true);
  assert.match(db.calls[0].sql, /ON CONFLICT DO NOTHING/);
  assert.equal(await addReaction(stub(), { messageId: 'm1', userId: 1, emoji: '👍' }), false);
  assert.equal(await removeReaction(stub({ 'DELETE FROM chat\\.reactions': [{ ok: 1 }] }), { messageId: 'm1', userId: 1, emoji: '👍' }), true);
});

test('pinMessage refuses the 51st pin', async () => {
  const db = stub({ 'FROM chat\\.messages WHERE id = \\$1': [{ id: 'm1', channel_id: 'c1', pinned: false }], 'count\\(\\*\\)[\\s\\S]*pinned = true': [{ n: '50' }] });
  await assert.rejects(() => pinMessage(db, { messageId: 'm1', userId: 1 }), { code: 'pin_limit' });
});
