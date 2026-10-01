// Code typed in a message is stored exactly as typed; everything else is still tidied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessageContent } from '../src/utils/sanitize.js';

const FENCE = '```';

test('a fenced block keeps its indentation, its spacing and anything that looks like a tag', () => {
  const code = `${FENCE}\nSELECT *\n  FROM claims   -- two    gaps\n<div class="x">kept</div>\n${FENCE}`;
  assert.equal(cleanMessageContent(code), code);
});

test('text around a block is still tidied', () => {
  const typed = `look   at <b>this</b>:\n${FENCE}\n  a   b\n${FENCE}\nand   <i>that</i>`;
  assert.equal(cleanMessageContent(typed), `look at this:\n${FENCE}\n  a   b\n${FENCE}\nand that`);
});

test('inline code is kept exactly; the same text outside code is tidied', () => {
  assert.equal(cleanMessageContent('use `<br>  twice` here'), 'use `<br>  twice` here');
  assert.equal(cleanMessageContent('use <br>  twice here'), 'use twice here');
});

test('a block that is never closed is code to the end of the message', () => {
  assert.equal(cleanMessageContent(`${FENCE}\n  <x>  y`), `${FENCE}\n  <x>  y`);
});

test('a lone backtick does not switch tidying off', () => {
  assert.equal(cleanMessageContent('it`s   <b>fine</b>'), 'it`s fine');
});

test('a message that is only an empty tag is still refused, and length is still checked', () => {
  assert.throws(() => cleanMessageContent('<br>'), { code: 'empty' });
  assert.throws(() => cleanMessageContent(`${FENCE}${'x'.repeat(4000)}${FENCE}`), { code: 'too_long' });
});

test('Windows line endings inside code become plain line breaks', () => {
  assert.equal(cleanMessageContent(`${FENCE}\r\n  a\r\n${FENCE}`), `${FENCE}\n  a\n${FENCE}`);
});
