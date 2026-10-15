// The ringtones on offer: a sensible catalogue, and the chosen one falls back to the first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RINGTONE, RINGTONES, RING_GAIN, ringtoneById } from '../src/utils/ringtone.ts';

test('a handful of distinct tones, each with notes that fit within its repeat period', () => {
  assert.ok(RINGTONES.length >= 4);
  assert.equal(new Set(RINGTONES.map((r) => r.id)).size, RINGTONES.length, 'ids are unique');
  for (const r of RINGTONES) {
    assert.ok(r.name && r.description, r.id);
    assert.ok(r.notes.length > 0, `${r.id} has notes`);
    const last = Math.max(...r.notes.map((n) => n.at + n.len));
    assert.ok(last * 1000 <= r.periodMs, `${r.id}: notes (${last}s) fit in ${r.periodMs} ms`);
    for (const n of r.notes) assert.ok((n.gain ?? RING_GAIN) <= 0.5, `${r.id}: one note never clips`);
  }
});

test('an unknown or missing choice falls back to the first tone', () => {
  assert.equal(ringtoneById('nope').id, DEFAULT_RINGTONE);
  assert.equal(ringtoneById(null).id, DEFAULT_RINGTONE);
  assert.equal(ringtoneById('bell').id, 'bell');
});
