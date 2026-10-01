import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TERMS, excerpt, likePattern, searchTerms } from '../src/utils/searchText.js';

test('searchTerms: separate words, no duplicates, a ceiling on how many', () => {
  assert.deepEqual(searchTerms('  System   Administrator '), ['System', 'Administrator']);
  assert.deepEqual(searchTerms('ann Ann ANN bob'), ['ann', 'bob']);
  assert.deepEqual(searchTerms('   '), []);
  assert.deepEqual(searchTerms(null), []);
  assert.equal(searchTerms('a b c d e f g h i j k').length, MAX_TERMS);
  assert.equal(searchTerms('x'.repeat(500))[0].length, 64);
});

test('likePattern: the text is matched literally, wildcards in it included', () => {
  assert.equal(likePattern('inv'), '%inv%');
  assert.equal(likePattern('100%'), '%100\\%%');
  assert.equal(likePattern('a_b'), '%a\\_b%');
  assert.equal(likePattern('a\\b'), '%a\\\\b%');
});

test('excerpt: marks every appearance, whatever the letter case, and survives regex characters', () => {
  assert.equal(excerpt('The Invoice is late', ['inv']), 'The <b>Inv</b>oice is late');
  assert.equal(excerpt('pay (now) or later', ['(now)']), 'pay <b>(now)</b> or later');
  assert.equal(excerpt('ann and annie', ['ann', 'annie']), '<b>ann</b> and <b>annie</b>');
  assert.equal(excerpt('nothing here', ['zzz']), null, 'no word in the text: the caller falls back');
  assert.equal(excerpt('anything', []), null);
});

test('excerpt: a long message is cut around the first match, on word boundaries', () => {
  const long = `${'word '.repeat(60)}the overdue invoice ${'tail '.repeat(60)}`;
  const s = excerpt(long, ['invoice']);
  assert.ok(s.startsWith('… '), 'says there is text before');
  assert.ok(s.endsWith(' …'), 'says there is text after');
  assert.match(s, /overdue <b>invoice<\/b> tail/);
  assert.ok(s.length < 200, `short (${s.length})`);
});
