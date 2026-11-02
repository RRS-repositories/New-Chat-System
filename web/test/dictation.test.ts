// Dictation against a stand-in for the browser's SpeechRecognition: set-up, words handed over,
// the quiet restart when the browser stops by itself, stop, errors, the ten-minute ceiling.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canDictate,
  Dictation,
  DICTATION_MAX_MS,
  recognitionMaker,
  type Recognition,
} from '../src/services/dictation.ts';

class FakeRecognition implements Recognition {
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((e: { resultIndex?: number; results: ArrayLike<any> }) => void) | null = null;
  onerror: ((e: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  start() {
    this.started++;
    this.onstart?.();
  }
  stop() {
    this.stopped++;
    this.onend?.();
  }
  abort() {}
}
const result = (transcript: string, isFinal: boolean) => ({ isFinal, 0: { transcript } });

function harness(now = () => 0) {
  const made: FakeRecognition[] = [];
  const texts: Array<[string | null, string]> = [];
  const listening: boolean[] = [];
  const problems: string[] = [];
  const d = new Dictation(
    {
      onText: (c, i) => texts.push([c, i]),
      onListening: (on) => listening.push(on),
      onProblem: (m) => problems.push(m),
    },
    {
      make: () => {
        const r = new FakeRecognition();
        made.push(r);
        return r;
      },
      now,
    },
  );
  return { d, made, texts, listening, problems };
}

test('start: continuous, with guesses, in British English; listening is reported', () => {
  const h = harness();
  h.d.start();
  assert.equal(h.made.length, 1);
  const r = h.made[0]!;
  assert.equal(r.lang, 'en-GB');
  assert.equal(r.continuous, true);
  assert.equal(r.interimResults, true);
  assert.equal(r.started, 1);
  assert.equal(h.d.listening, true);
  assert.deepEqual(h.listening, [true]);
  h.d.start();
  assert.equal(h.made.length, 1, 'starting twice does nothing');
});

test('results: settled words are handed over once, guesses every time', () => {
  const h = harness();
  h.d.start();
  const r = h.made[0]!;
  r.onresult!({ resultIndex: 0, results: [result('hello ', false)] });
  r.onresult!({ resultIndex: 0, results: [result('hello team', true)] });
  r.onresult!({ resultIndex: 1, results: [result('hello team', true), result('how', false)] });
  r.onresult!({ resultIndex: 1, results: [result('hello team', true), result('how are you', true)] });
  assert.deepEqual(h.texts, [
    [null, 'hello '],
    ['hello team', ''],
    [null, 'how'],
    ['how are you', ''],
  ]);
});

test('when the browser ends by itself while still wanted, listening quietly starts again', () => {
  const h = harness();
  h.d.start();
  h.made[0]!.onend!();
  assert.equal(h.made.length, 2, 'a second recognition was started');
  assert.equal(h.made[1]!.started, 1);
  assert.equal(h.d.restarted, 1);
  assert.equal(h.d.listening, true);
  assert.deepEqual(h.texts.at(-1), [null, ''], 'the guess in progress was cleared');
});

test('stop: the recognition is stopped, nothing restarts, listening is reported off', () => {
  const h = harness();
  h.d.start();
  h.d.stop();
  assert.equal(h.made[0]!.stopped, 1);
  assert.equal(h.made.length, 1);
  assert.equal(h.d.listening, false);
  assert.deepEqual(h.listening, [true, false]);
  h.d.stop();
  assert.deepEqual(h.listening, [true, false, false], 'stopping when idle still reports off (harmless)');
});

test('a silence is ignored; a refused microphone ends it with a message and no restart', () => {
  const h = harness();
  h.d.start();
  const r = h.made[0]!;
  r.onerror!({ error: 'no-speech' });
  assert.equal(h.problems.length, 0);
  assert.equal(h.d.listening, true);
  r.onerror!({ error: 'not-allowed' });
  assert.match(h.problems[0]!, /refused/);
  assert.equal(h.d.listening, false);
  r.onend!();
  assert.equal(h.made.length, 1, 'not started again');
  assert.deepEqual(h.listening, [true, false]);
});

test('the ceiling: after ten minutes the browser ending it is the end', () => {
  let t = 0;
  const h = harness(() => t);
  h.d.start();
  t = DICTATION_MAX_MS - 1;
  h.made[0]!.onend!();
  assert.equal(h.made.length, 2, 'just inside the ceiling: restarted');
  t = DICTATION_MAX_MS + 1;
  h.made[1]!.onend!();
  assert.equal(h.made.length, 2, 'past it: not restarted');
  assert.equal(h.d.listening, false);
});

test('a browser with no recognition: one problem, nothing else', () => {
  const problems: string[] = [];
  const d = new Dictation(
    {
      onText: () => assert.fail('no text'),
      onListening: () => assert.fail('never listening'),
      onProblem: (m) => problems.push(m),
    },
    { make: null },
  );
  d.start();
  assert.match(problems[0]!, /not available/);
  assert.equal(d.listening, false);
});

test('recognitionMaker finds the class under either name; canDictate says whether there is one', () => {
  assert.equal(recognitionMaker({}), null);
  assert.equal(canDictate({}), false);
  assert.ok(recognitionMaker({ webkitSpeechRecognition: FakeRecognition }));
  assert.ok(recognitionMaker({ SpeechRecognition: FakeRecognition }));
  assert.equal(canDictate({ webkitSpeechRecognition: FakeRecognition }), true);
  assert.ok(recognitionMaker({ SpeechRecognition: FakeRecognition })!() instanceof FakeRecognition);
});
