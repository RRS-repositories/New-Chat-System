// The whiteboard's tools: text sizes and cleaning, shape geometry, and the keys that pick a tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_TEXT,
  arrowHead,
  boxOf,
  cleanText,
  isFreehand,
  isShape,
  isTyping,
  textLines,
  textSizeOf,
  toolForKey,
} from '../src/utils/boardTools.ts';

test('text has three sizes, one per pen thickness', () => {
  assert.deepEqual([3, 6, 10].map(textSizeOf), [16, 22, 30]);
});

test('text is kept trimmed, without control characters, and no longer than the limit', () => {
  assert.equal(cleanText('  Hello\r\nworld\u0000 '), 'Hello\nworld');
  assert.equal(cleanText('a\tb'), 'a\tb', 'a tab stays');
  assert.equal(cleanText('   '), null);
  assert.equal(cleanText(''), null);
  assert.equal(cleanText('x'.repeat(MAX_TEXT + 50))?.length, MAX_TEXT);
  assert.deepEqual(textLines('one\ntwo'), ['one', 'two']);
});

test('a box is the same whichever way it was dragged', () => {
  const close = (a: { x: number; y: number; w: number; h: number }, b: number[]) =>
    [a.x, a.y, a.w, a.h].every((n, i) => Math.abs(n - b[i]) < 1e-9);
  assert.ok(close(boxOf([0.1, 0.2], [0.4, 0.6]), [0.1, 0.2, 0.3, 0.4]));
  assert.ok(close(boxOf([0.4, 0.6], [0.1, 0.2]), [0.1, 0.2, 0.3, 0.4]), 'dragged up and to the left');
});

test('an arrow head: two wings behind the tip, either side of the line', () => {
  const [a, b] = arrowHead([0, 0], [10, 0], 5);
  assert.ok(a[0] > 5 && a[0] < 10 && b[0] > 5 && b[0] < 10, 'behind the tip, in front of the middle');
  assert.ok(Math.abs(a[1] + b[1]) < 1e-9 && a[1] !== 0, 'mirror images across the line');
});

test('each tool has a key; other keys pick nothing', () => {
  assert.equal(toolForKey('p'), 'pen');
  assert.equal(toolForKey('T'), 'text');
  assert.equal(toolForKey('v'), 'move');
  assert.equal(toolForKey('o'), 'ellipse');
  assert.equal(toolForKey('x'), null);
  assert.equal(toolForKey(''), null);
  assert.equal(toolForKey('Enter'), null);
});

test('what kind of tool each is', () => {
  assert.ok(isFreehand('pen') && isFreehand('highlighter') && isFreehand('eraser'));
  assert.ok(!isFreehand('text') && !isFreehand('rect') && !isFreehand('move'));
  assert.ok(isShape('line') && isShape('arrow') && isShape('rect') && isShape('ellipse'));
  assert.ok(!isShape('pen') && !isShape('text'));
});

test('a key pressed in a typing box is left alone', () => {
  const el = (tagName: string, editable = false) =>
    ({ tagName, isContentEditable: editable }) as unknown as EventTarget;
  assert.equal(isTyping(el('INPUT')), true);
  assert.equal(isTyping(el('textarea')), true);
  assert.equal(isTyping(el('DIV', true)), true);
  assert.equal(isTyping(el('CANVAS')), false);
  assert.equal(isTyping(null), false);
});
