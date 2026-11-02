// Voice notes against stand-ins for the microphone and MediaRecorder: the file type chosen, the
// name and clock, recording to a note, cancel (also during the permission prompt), the microphone
// being refused, the time ceiling, and the sound level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canRecordVoice,
  formatClock,
  microphoneProblem,
  pickVoiceType,
  VoiceRecorder,
  voiceNoteName,
  type RecorderLike,
  type StreamLike,
} from '../src/services/voiceNote.ts';

class FakeRecorder implements RecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  slice: number | undefined;
  private listeners = new Map<string, Array<(e: any) => void>>();
  stream: StreamLike;
  opts: { mimeType?: string; audioBitsPerSecond: number };
  constructor(stream: StreamLike, opts: { mimeType?: string; audioBitsPerSecond: number }) {
    this.stream = stream;
    this.opts = opts;
  }
  start(ms?: number) {
    this.state = 'recording';
    this.slice = ms;
  }
  stop() {
    this.state = 'inactive';
    this.emit('dataavailable', { data: new Blob(['tail']) });
    this.emit('stop', {});
  }
  addEventListener(type: string, fn: (e: any) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(type: string, e: any) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
}
const fakeStream = () => {
  const tracks = [
    {
      stopped: 0,
      stop() {
        this.stopped++;
      },
    },
  ];
  return { getTracks: () => tracks, tracks };
};
const opus = (t: string) => t === 'audio/webm;codecs=opus' || t === 'audio/webm';

function harness({
  now = () => 0,
  maxSecs = 600,
  getStream,
}: { now?: () => number; maxSecs?: number; getStream?: () => Promise<StreamLike> } = {}) {
  const made: FakeRecorder[] = [];
  const stream = fakeStream();
  const meter = {
    closed: 0,
    level: () => 0.5,
    close() {
      this.closed++;
    },
  };
  let limits = 0;
  const rec = new VoiceRecorder({
    getStream: getStream ?? (async () => stream),
    makeRecorder: (s, o) => {
      const r = new FakeRecorder(s, o);
      made.push(r);
      return r;
    },
    isTypeSupported: opus,
    makeMeter: () => meter,
    now,
    maxSecs,
    onLimit: () => limits++,
  });
  return { rec, made, stream, meter, limits: () => limits };
}

test('pickVoiceType: the first type the browser can write, with the ending the chat uses', () => {
  assert.deepEqual(pickVoiceType(opus), { mimeType: 'audio/webm;codecs=opus', type: 'audio/webm', ext: 'webm' });
  assert.deepEqual(
    pickVoiceType((t) => t === 'audio/mp4'),
    { mimeType: 'audio/mp4', type: 'audio/mp4', ext: 'm4a' },
  );
  assert.deepEqual(
    pickVoiceType((t) => t === 'audio/ogg'),
    { mimeType: 'audio/ogg', type: 'audio/ogg', ext: 'ogg' },
  );
  assert.deepEqual(
    pickVoiceType(() => false),
    { mimeType: '', type: 'audio/webm', ext: 'webm' },
    'the browser picks',
  );
});

test('the name carries the day and time; the clock reads m:ss', () => {
  assert.equal(voiceNoteName(new Date(2026, 10, 2, 9, 5), 'webm'), 'Voice note 2026-11-02 09.05.webm');
  assert.equal(voiceNoteName(new Date(2026, 0, 31, 17, 40), 'm4a'), 'Voice note 2026-01-31 17.40.m4a');
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(7), '0:07');
  assert.equal(formatClock(90), '1:30');
  assert.equal(formatClock(725), '12:05');
});

test('what a microphone problem means; whether the browser can record at all', () => {
  assert.match(microphoneProblem({ name: 'NotAllowedError' }), /refused/);
  assert.match(microphoneProblem({ name: 'NotFoundError' }), /No microphone/);
  assert.match(microphoneProblem({ name: 'NotReadableError' }), /in use/);
  assert.equal(microphoneProblem(new Error('odd')), 'odd');
  assert.equal(canRecordVoice({}), false);
  assert.equal(canRecordVoice({ MediaRecorder: class {}, navigator: { mediaDevices: { getUserMedia() {} } } }), true);
  assert.equal(canRecordVoice({ MediaRecorder: class {}, navigator: {} }), false);
});

test('record, then stop: a sound file of the chosen type, timed, with the microphone let go', async () => {
  let t = 1000;
  const h = harness({ now: () => t });
  assert.equal(h.rec.state, 'idle');
  await h.rec.start();
  assert.equal(h.rec.state, 'recording');
  const r = h.made[0]!;
  assert.deepEqual(r.opts, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32_000 });
  assert.equal(r.slice, 1000, 'a chunk a second');
  assert.equal(h.rec.level(), 0.5);
  t += 3400;
  assert.equal(h.rec.elapsedSecs(), 3);
  r.emit('dataavailable', { data: new Blob(['abc']) });
  r.emit('dataavailable', { data: { size: 0 } });
  const note = await h.rec.stop();
  assert.ok(note);
  assert.equal(note.type, 'audio/webm');
  assert.equal(note.ext, 'webm');
  assert.equal(note.durationSecs, 3);
  assert.equal(note.hitLimit, false);
  assert.equal(note.blob.type, 'audio/webm');
  assert.equal(note.blob.size, 'abc'.length + 'tail'.length, 'all chunks, empty ones left out');
  assert.equal(h.stream.tracks[0]!.stopped, 1, 'the microphone light goes off');
  assert.equal(h.meter.closed, 1);
  assert.equal(h.rec.level(), 0);
  assert.equal(h.rec.state, 'done');
  assert.equal(await h.rec.stop(), note, 'stopping again hands back the same note');
});

test('cancel throws the recording away and lets the microphone go', async () => {
  const h = harness();
  await h.rec.start();
  h.rec.cancel();
  assert.equal(await h.rec.stop(), null, 'nothing to hand back');
  assert.equal(h.stream.tracks[0]!.stopped, 1);
  assert.equal(h.meter.closed, 1);
  assert.equal(h.rec.state, 'done');
  h.rec.cancel();
  assert.equal(h.stream.tracks[0]!.stopped, 1, 'cancelling again does nothing more');
});

test('cancel while the permission prompt is still up: nothing is recorded and the microphone is released', async () => {
  const stream = fakeStream();
  let give: ((s: StreamLike) => void) | null = null;
  const h = harness({ getStream: () => new Promise<StreamLike>((resolve) => (give = resolve)) });
  const starting = h.rec.start();
  h.rec.cancel();
  give!(stream);
  await starting;
  assert.equal(h.made.length, 0, 'no recorder was made');
  assert.equal(stream.tracks[0]!.stopped, 1);
  assert.equal(h.rec.state, 'idle');
  // A fresh start afterwards works as usual.
  const again = harness();
  await again.rec.start();
  assert.equal(again.rec.state, 'recording');
});

test('the microphone refused: start throws the plain message and nothing is held', async () => {
  const h = harness({ getStream: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) });
  await assert.rejects(() => h.rec.start(), /refused/);
  assert.equal(h.rec.state, 'idle');
  assert.equal(h.made.length, 0);
});

test('the time ceiling stops the recording by itself and keeps what there is', async () => {
  let t = 0;
  const h = harness({ now: () => t, maxSecs: 2 });
  await h.rec.start();
  const r = h.made[0]!;
  t = 1500;
  r.emit('dataavailable', { data: new Blob(['a']) });
  assert.equal(r.state, 'recording', 'under the ceiling: carries on');
  t = 2100;
  r.emit('dataavailable', { data: new Blob(['b']) });
  assert.equal(r.state, 'inactive', 'at the ceiling: stopped');
  assert.equal(h.limits(), 1);
  const note = await h.rec.stop();
  assert.ok(note);
  assert.equal(note.hitLimit, true);
  assert.equal(note.durationSecs, 2);
  assert.equal(note.blob.size, 'a'.length + 'b'.length + 'tail'.length);
});

test('a recorder that cannot be made: the stream is released and start throws', async () => {
  const stream = fakeStream();
  const rec = new VoiceRecorder({
    getStream: async () => stream,
    makeRecorder: () => {
      throw new Error('no such codec');
    },
    isTypeSupported: () => false,
    makeMeter: () => null,
  });
  await assert.rejects(() => rec.start(), /no such codec/);
  assert.equal(stream.tracks[0]!.stopped, 1);
  assert.equal(rec.level(), 0, 'no meter is fine');
});
