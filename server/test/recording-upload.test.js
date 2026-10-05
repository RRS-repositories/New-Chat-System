// What an upload may say about itself: only a call recording, and only in one exact shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordingMetadata } from '../src/services/files/upload.service.js';

const CALL = '0b0e6a9e-3f0f-4d6e-9a53-2f4d1f3c7a11';
const webm = [{ mimetype: 'video/webm' }];

test('a call recording carries the call and its length', () => {
  assert.deepEqual(recordingMetadata({ recordingCallId: CALL, recordingSecs: '127' }, webm), {
    kind: 'call_recording',
    call_id: CALL,
    duration_secs: 127,
  });
  assert.equal(recordingMetadata({ recordingCallId: CALL.toUpperCase(), recordingSecs: 5 }, webm).call_id, CALL);
});

test('anything else stores nothing extra', () => {
  assert.equal(recordingMetadata({}, webm), null);
  assert.equal(recordingMetadata(undefined, webm), null);
  assert.equal(recordingMetadata({ recordingCallId: 'not-a-call' }, webm), null);
  assert.equal(recordingMetadata({ recordingCallId: { $ne: 1 } }, webm), null);
  assert.equal(recordingMetadata({ recordingCallId: CALL }, [{ mimetype: 'image/png' }]), null, 'not a WebM file');
  assert.equal(recordingMetadata({ recordingCallId: CALL }, [...webm, ...webm]), null, 'one file only');
});

test('a nonsense length becomes 0, and a huge one is capped at a day', () => {
  for (const bad of [undefined, 'abc', -5, 0, NaN])
    assert.equal(recordingMetadata({ recordingCallId: CALL, recordingSecs: bad }, webm).duration_secs, 0, String(bad));
  assert.equal(recordingMetadata({ recordingCallId: CALL, recordingSecs: 9e9 }, webm).duration_secs, 86400);
});
