// Dictation text: results split into settled and guessed words, spoken marks, joining, and the span splice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dictationProblem, heard, joinSpeech, spliceSpoken, spokenMarks, spokenText } from '../src/utils/speechText.ts';

const result = (transcript: string, isFinal: boolean) => ({ isFinal, 0: { transcript } });

test('heard: settled words from the index given, guessed words joined', () => {
  const results = [result('old final', true), result('new final', true), result('guess ', false), result('ing', false)];
  assert.deepEqual(heard(results, 1), { finals: ['new final'], interim: 'guess ing' });
  assert.deepEqual(heard(results, 0).finals, ['old final', 'new final']);
  assert.deepEqual(heard([], 0), { finals: [], interim: '' });
  assert.deepEqual(heard([{ isFinal: true }], 0), { finals: [''], interim: '' }, 'a result with no alternative');
});

test('spoken marks become marks, with typist spacing', () => {
  assert.equal(
    spokenMarks('hello team comma see the file full stop new line thanks'),
    'hello team, see the file.\nthanks',
  );
  assert.equal(spokenMarks('is that right question mark'), 'is that right?');
  assert.equal(spokenMarks('great news exclamation mark'), 'great news!');
  assert.equal(spokenMarks('one new paragraph two'), 'one\n\ntwo');
  assert.equal(spokenMarks('Full Stop'), '.', 'case does not matter');
  assert.equal(spokenMarks('the commander stopped'), 'the commander stopped', 'only whole words');
  assert.equal(spokenMarks('done full stop next'), 'done. next', 'one space after a mark');
});

test('joinSpeech: a space between words, none after a line break or before a mark, a capital to start a sentence', () => {
  assert.equal(joinSpeech('', 'hello'), 'Hello');
  assert.equal(joinSpeech('Hello', 'team'), 'Hello team');
  assert.equal(joinSpeech('Hello.', 'next'), 'Hello. Next');
  assert.equal(joinSpeech('Really?', 'yes'), 'Really? Yes');
  assert.equal(joinSpeech('line\n', 'next'), 'line\nNext');
  assert.equal(joinSpeech('Hello', ', and'), 'Hello, and');
  assert.equal(joinSpeech('x ', 'y'), 'x y', 'a space already there is enough');
  assert.equal(joinSpeech('x', '   '), 'x', 'nothing to add');
  assert.equal(joinSpeech('see @Ann', 'please'), 'see @Ann please');
});

test('spokenText: the settled words then the guess, through the same rules', () => {
  assert.equal(spokenText('Hello team', 'comma how are'), 'Hello team, how are');
  assert.equal(spokenText('', 'hello'), 'Hello');
  assert.equal(spokenText('Done.', ''), 'Done.');
});

test('spliceSpoken keeps what was typed before and after the dictated span', () => {
  let r = spliceSpoken('ab', { start: 2, end: 2 }, 'cd');
  assert.deepEqual(r, { text: 'abcd', range: { start: 2, end: 4 } });
  r = spliceSpoken(r.text, r.range, 'xyz');
  assert.deepEqual(r, { text: 'abxyz', range: { start: 2, end: 5 } });
  assert.deepEqual(spliceSpoken('abcd!', { start: 2, end: 4 }, 'q'), { text: 'abq!', range: { start: 2, end: 3 } });
  assert.deepEqual(
    spliceSpoken('ab', { start: 9, end: 12 }, 'z'),
    { text: 'abz', range: { start: 2, end: 3 } },
    'clamped',
  );
  assert.deepEqual(spliceSpoken('abcd', { start: 1, end: 3 }, ''), { text: 'ad', range: { start: 1, end: 1 } });
});

test('dictationProblem: silence and our own stop are nothing; the rest is said plainly', () => {
  assert.equal(dictationProblem('no-speech'), null);
  assert.equal(dictationProblem('aborted'), null);
  assert.match(dictationProblem('not-allowed')!, /refused/);
  assert.match(dictationProblem('service-not-allowed')!, /refused/);
  assert.match(dictationProblem('audio-capture')!, /No microphone/);
  assert.match(dictationProblem('network')!, /internet/);
  assert.equal(dictationProblem('weird'), 'Dictation stopped (weird).');
  assert.equal(dictationProblem(undefined), 'Dictation stopped.');
});
