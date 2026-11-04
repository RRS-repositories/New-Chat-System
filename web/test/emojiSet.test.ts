import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMOJI_SET } from '../src/utils/emojiSet.ts';
import { DEFAULT_QUICK } from '../src/utils/quickEmojis.ts';

test('the picker offers plenty of emoji, each once, each a single emoji', () => {
  assert.ok(EMOJI_SET.length >= 60, `only ${EMOJI_SET.length}`);
  assert.equal(new Set(EMOJI_SET).size, EMOJI_SET.length, 'no emoji twice');
  const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
  for (const e of EMOJI_SET) {
    assert.equal([...seg.segment(e)].length, 1, `${e} is more than one character`);
    assert.match(e, /\p{Extended_Pictographic}/u, `${e} is not an emoji`);
  }
});

test('the usual reactions come first, and the hover-bar defaults are among them', () => {
  assert.deepEqual(EMOJI_SET.slice(0, 6), ['👍', '❤️', '😂', '🎉', '👀', '✅']);
  for (const e of DEFAULT_QUICK) assert.ok(EMOJI_SET.includes(e), e);
});
