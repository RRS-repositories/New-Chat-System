import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanMessageContent, MAX_MESSAGE_LENGTH } from '../src/sanitize.js';

test('strips HTML tags, keeps text, trims, collapses CRLF', () => {
  assert.equal(cleanMessageContent('  <b>hi</b> <script>x()</script> there\r\n'), 'hi x() there');
  assert.equal(cleanMessageContent('line1\r\nline2'), 'line1\nline2');
});
test('empty or whitespace-only is refused', () => {
  assert.throws(() => cleanMessageContent('   '), { code: 'empty' });
  assert.throws(() => cleanMessageContent('<br>'), { code: 'empty' });
});
test('over 4000 chars is refused', () => {
  assert.equal(MAX_MESSAGE_LENGTH, 4000);
  assert.throws(() => cleanMessageContent('a'.repeat(4001)), { code: 'too_long' });
});
test('emoji and angle brackets in prose survive', () => {
  assert.equal(cleanMessageContent('3 < 5 and 7 > 2 🎉'), '3 < 5 and 7 > 2 🎉');
});
