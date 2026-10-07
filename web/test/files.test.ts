import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatBytes, validateFiles, isImage, isAudio, fileKind } from '../src/utils/files.ts';

const f = (name: string, size: number, type = '') => ({ name, size, type }) as unknown as File;
test('formatBytes', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(2.5 * 1024 * 1024), '2.5 MB');
});
test('validateFiles: size, count and extension rules with readable errors', () => {
  const r = validateFiles([f('a.png', 10), f('b.exe', 10), f('c.pdf', 21 * 1024 * 1024)]);
  assert.deepEqual(
    r.ok.map((x) => x.name),
    ['a.png'],
  );
  assert.equal(r.errors.length, 2);
  assert.match(r.errors[0]!, /b\.exe/);
  assert.match(r.errors[1]!, /20 MB/);
  const six = validateFiles(Array.from({ length: 6 }, (_, i) => f(`${i}.txt`, 1)));
  assert.equal(six.ok.length, 5);
  assert.match(six.errors[0]!, /5 files/);
});
test('sound files (call recordings) are allowed and known as Audio', () => {
  const r = validateFiles([f('call-2026-10-07.mp3', 10), f('note.wav', 10), f('voice.m4a', 10), f('x.ogg', 10)]);
  assert.equal(r.errors.length, 0);
  assert.equal(r.ok.length, 4);
  assert.equal(isAudio('audio/mpeg'), true);
  assert.equal(isAudio('video/webm'), false);
  assert.equal(fileKind('audio/mpeg', 'call.mp3'), 'Audio');
});
test('isImage', () => {
  assert.equal(isImage('image/png'), true);
  assert.equal(isImage('image/svg+xml'), false);
  assert.equal(isImage('application/pdf'), false);
});
