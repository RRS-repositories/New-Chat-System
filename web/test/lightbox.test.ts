// The picture viewer: the size a picture opens at, and how zooming moves from there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_UPSCALE,
  MAX_ZOOM,
  MIN_ZOOM,
  fitScale,
  openingScale,
  percent,
  toggledScale,
  zoomed,
} from '../src/utils/viewer.ts';

const space = { width: 1600, height: 900 };

test('a picture opens whole: a big one is shrunk to fit the window in BOTH directions', () => {
  assert.equal(openingScale({ width: 1600, height: 900 }, space), 1, 'exactly the window: as it is');
  assert.equal(openingScale({ width: 3200, height: 900 }, space), 0.5, 'twice as wide: halved');
  assert.equal(openingScale({ width: 800, height: 1800 }, space), 0.5, 'twice as tall: halved, not cut off');
  assert.equal(openingScale({ width: 1200, height: 800 }, space), 1, 'fits already: never enlarged');
});

test('a small picture is enlarged to read, at most twice, and never past the window', () => {
  assert.equal(openingScale({ width: 360, height: 200 }, space), MAX_UPSCALE, 'a 360px crop: doubled');
  // The bug of 26 Oct: 420 wide by 480 tall, tripled, ran off the bottom of a 900px window.
  assert.equal(openingScale({ width: 420, height: 480 }, space), 1.88, 'a tall crop stops at the window height');
  assert.equal(openingScale({ width: 1000, height: 300 }, space), 1, 'wide enough already: not touched');
});

test('odd sizes fall back to actual size', () => {
  assert.equal(openingScale({ width: 0, height: 0 }, space), 1);
  assert.equal(openingScale({ width: 400, height: 300 }, { width: 0, height: 0 }), 1);
  assert.equal(fitScale({ width: 0, height: 0 }, space), 1);
});

test('zoom steps in and out by a quarter and stops at the limits', () => {
  assert.equal(zoomed(1, 1), 1.25);
  assert.equal(zoomed(1.25, -1), 1);
  assert.equal(zoomed(MAX_ZOOM, 1), MAX_ZOOM);
  assert.equal(zoomed(MIN_ZOOM, -1), MIN_ZOOM);
  assert.equal(zoomed(4.5, 1), MAX_ZOOM, 'a step that would pass the limit lands on it');
});

test('a double-click goes to actual size and back to the opening size', () => {
  assert.equal(toggledScale(0.5, 0.5), 1);
  assert.equal(toggledScale(1, 0.5), 0.5);
  assert.equal(toggledScale(2.3, 0.5), 1, 'from any zoom: actual size first');
});

test('the zoom label', () => {
  assert.equal(percent(1), '100%');
  assert.equal(percent(0.5), '50%');
  assert.equal(percent(1.81), '181%');
});
