// The three quick reactions on the hover bar: most used on this device, the usual ones filling in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_QUICK, pickQuick } from '../src/utils/quickEmojis.ts';

test('nothing used yet: the defaults', () => {
  assert.deepEqual(pickQuick({}), DEFAULT_QUICK);
});

test('the most used come first, the defaults fill the rest without repeats', () => {
  assert.deepEqual(pickQuick({ '🎉': 5, '👍': 2 }), ['🎉', '👍', '❤️']);
  assert.deepEqual(pickQuick({ '🔥': 3, '🎉': 3, '✅': 9 }), ['✅', '🎉', '🔥'], 'ties break the same way every time');
  assert.deepEqual(pickQuick({ '': 4, '😂': 0 }), DEFAULT_QUICK, 'empty names and zero counts are ignored');
});
