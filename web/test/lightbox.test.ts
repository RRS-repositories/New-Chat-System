// The picture viewer: how wide a picture is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { viewerWidth } from '../src/utils/viewer.ts';

test('a big picture is left to fit the window; a small one is scaled up to read, at most three times, never past the window', () => {
  assert.equal(viewerWidth(1600, 1600), null, 'as wide as the window: fit by CSS');
  assert.equal(viewerWidth(1000, 1600), null, 'over 60% of the window: fit by CSS');
  assert.equal(viewerWidth(360, 1600), 1080, 'a 360px crop is shown three times its size');
  assert.equal(
    viewerWidth(600, 1600),
    1472,
    'a 600px picture would pass the window at three times: capped at 92% of it',
  );
  assert.equal(viewerWidth(0, 1600), null);
  assert.equal(viewerWidth(360, 0), null);
});
