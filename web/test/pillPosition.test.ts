// The minimised call pill can be dragged anywhere, stays inside the window, and comes back where it was left.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAG_THRESHOLD,
  EDGE_MARGIN,
  clampToViewport,
  hasMoved,
  readPillPosition,
  rememberPillPosition,
} from '../src/utils/pillPosition.ts';
import { STORAGE_KEYS } from '../src/config/constants.ts';

const pill = { width: 300, height: 60 };
const screen = { width: 1200, height: 800 };

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
};

test('a spot inside the window is kept as it is, rounded to whole pixels', () => {
  assert.deepEqual(clampToViewport({ x: 100.4, y: 200.6 }, pill, screen), { x: 100, y: 201 });
});

test('the pill never leaves the window: it stops a margin short of every edge', () => {
  assert.deepEqual(clampToViewport({ x: -50, y: -50 }, pill, screen), { x: EDGE_MARGIN, y: EDGE_MARGIN });
  assert.deepEqual(clampToViewport({ x: 5000, y: 5000 }, pill, screen), {
    x: screen.width - pill.width - EDGE_MARGIN,
    y: screen.height - pill.height - EDGE_MARGIN,
  });
});

test('a window narrower than the pill pins it to the left margin rather than off-screen', () => {
  const phone = { width: 240, height: 500 };
  assert.deepEqual(clampToViewport({ x: 100, y: 100 }, pill, phone), { x: EDGE_MARGIN, y: 100 });
});

test('a few pixels of wobble is a click, further is a drag', () => {
  const down = { x: 50, y: 50 };
  assert.equal(hasMoved(down, { x: 50 + DRAG_THRESHOLD - 1, y: 50 }), false);
  assert.equal(hasMoved(down, { x: 50, y: 50 - DRAG_THRESHOLD + 1 }), false);
  assert.equal(hasMoved(down, { x: 50 + DRAG_THRESHOLD, y: 50 }), true);
  assert.equal(hasMoved(down, { x: 50, y: 50 - DRAG_THRESHOLD }), true);
});

test('where the pill was left is remembered and read back', () => {
  const storage = fakeStorage();
  assert.equal(readPillPosition(storage), null, 'never moved: the CSS corner');
  rememberPillPosition({ x: 320, y: 40 }, storage);
  assert.deepEqual(readPillPosition(storage), { x: 320, y: 40 });
  assert.ok(storage.data.has(STORAGE_KEYS.callPillPosition));
});

test('rubbish in storage, or no storage at all, means the default corner and never an error', () => {
  const storage = fakeStorage();
  storage.setItem(STORAGE_KEYS.callPillPosition, 'not json');
  assert.equal(readPillPosition(storage), null);
  storage.setItem(STORAGE_KEYS.callPillPosition, JSON.stringify({ x: 'a', y: 2 }));
  assert.equal(readPillPosition(storage), null);
  assert.equal(readPillPosition(null), null);
  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(readPillPosition(broken), null);
  assert.doesNotThrow(() => rememberPillPosition({ x: 1, y: 1 }, broken));
});
