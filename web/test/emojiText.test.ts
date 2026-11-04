import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emojiOnlyCount, splitEmoji, isEmoji, JUMBO_MAX } from '../src/utils/emojiText.ts';

test('emojiOnlyCount: a message of nothing but emoji, counted by emoji, not by code unit', () => {
  assert.equal(emojiOnlyCount('👍'), 1);
  assert.equal(emojiOnlyCount(' 👍 '), 1);
  assert.equal(emojiOnlyCount('🎉🎉🎉'), 3);
  assert.equal(emojiOnlyCount('👍 ❤️ 😂'), 3);
  assert.equal(emojiOnlyCount('👨‍👩‍👧'), 1, 'a family joined by ZWJ is one emoji');
  assert.equal(emojiOnlyCount('👍🏽'), 1, 'a skin tone is part of the emoji');
  assert.equal(emojiOnlyCount('🇬🇧'), 1, 'a flag is one emoji');
  assert.equal(emojiOnlyCount('❤️'), 1, 'a heart with its variation selector');
});

test('emojiOnlyCount: 0 for words, for emoji among words, for too many, and for nothing', () => {
  assert.equal(emojiOnlyCount('ok 👍'), 0);
  assert.equal(emojiOnlyCount('👍 ok'), 0);
  assert.equal(emojiOnlyCount('hello'), 0);
  assert.equal(emojiOnlyCount(''), 0);
  assert.equal(emojiOnlyCount('   '), 0);
  assert.equal(emojiOnlyCount('123'), 0, 'digits are not emoji');
  assert.equal(emojiOnlyCount('#'), 0);
  assert.equal(emojiOnlyCount('🎉'.repeat(JUMBO_MAX)), JUMBO_MAX);
  assert.equal(emojiOnlyCount('🎉'.repeat(JUMBO_MAX + 1)), 0, 'a wall of emoji stays ordinary text');
});

test('splitEmoji keeps the text whole and marks the emoji runs', () => {
  assert.deepEqual(splitEmoji('well done 👍👍 team 🎉'), [
    { text: 'well done ', emoji: false },
    { text: '👍👍', emoji: true },
    { text: ' team ', emoji: false },
    { text: '🎉', emoji: true },
  ]);
  assert.deepEqual(splitEmoji('plain'), [{ text: 'plain', emoji: false }]);
  assert.deepEqual(splitEmoji(''), []);
  assert.equal(
    splitEmoji('a 👨‍👩‍👧 b')
      .map((p) => p.text)
      .join(''),
    'a 👨‍👩‍👧 b',
  );
  assert.equal(isEmoji('©'), true, 'the copyright sign counts as a pictograph (as browsers draw it)');
  assert.equal(isEmoji('a'), false);
});
