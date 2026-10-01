import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snippetParts } from '../src/utils/snippet.ts';
test('splits on the Postgres <b> markers only; other angle brackets stay text', () => {
  assert.deepEqual(snippetParts('the <b>invoice</b> for 3 < 5 <script>'), [
    { text: 'the ', hit: false },
    { text: 'invoice', hit: true },
    { text: ' for 3 < 5 <script>', hit: false },
  ]);
  assert.deepEqual(snippetParts(''), []);
});
