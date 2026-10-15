// The ringtones on offer, the chosen one, and the volume.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RINGTONE, RINGTONES, clampVolume, ringtoneById } from '../src/utils/ringtone.ts';

test('four tones: the classic synthesised ring and three recorded ones served from /sounds', () => {
  assert.equal(RINGTONES.length, 4);
  assert.equal(new Set(RINGTONES.map((r) => r.id)).size, 4, 'ids are unique');
  assert.equal(RINGTONES[0]!.id, 'classic');
  assert.equal(RINGTONES[0]!.file, undefined, 'the classic ring is made in the browser');
  for (const r of RINGTONES.slice(1)) assert.match(r.file || '', /^\/sounds\/[a-z-]+\.mp3$/, r.id);
  for (const r of RINGTONES) assert.ok(r.name && r.description, r.id);
});

test('an unknown or missing choice falls back to the classic ring', () => {
  assert.equal(ringtoneById('nope').id, DEFAULT_RINGTONE);
  assert.equal(ringtoneById(null).id, DEFAULT_RINGTONE);
  assert.equal(ringtoneById('rotary-phone').id, 'rotary-phone');
});

test('the volume is a fraction 0–1; anything odd is full', () => {
  assert.equal(clampVolume(0.5), 0.5);
  assert.equal(clampVolume('0.25'), 0.25);
  assert.equal(clampVolume(7), 1);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume('x'), 1);
  assert.equal(clampVolume(undefined), 1);
});
