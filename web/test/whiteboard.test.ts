// The whiteboard's drawing model: what is shown at once, what is sent, and what others' changes do.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERASER_FACTOR, Whiteboard, type BoardChange, type BoardOp } from '../src/services/whiteboard.ts';

function setup(myUserId = 2) {
  const sent: BoardOp[] = [];
  const changes: BoardChange[] = [];
  let pending: (() => void) | null = null;
  let n = 0;
  const board = new Whiteboard({
    myUserId,
    send: (op) => sent.push(op),
    newId: () => `stroke-${++n}`,
    timers: {
      setTimeout: ((fn: () => void) => {
        pending = fn;
        return 1;
      }) as unknown as typeof setTimeout,
      clearTimeout: (() => {
        pending = null;
      }) as unknown as typeof clearTimeout,
    },
  });
  board.subscribe((c) => changes.push(c));
  return { board, sent, changes, tick: () => pending?.() };
}
const pen = { color: '#6C4DE6', size: 6, eraser: false };

test('drawing shows at once and is sent in batches: the first batch describes the stroke, later ones only add points', () => {
  const { board, sent, changes, tick } = setup();
  board.begin(pen, [0.1, 0.1]);
  board.extend([0.2, 0.2]);
  assert.equal(board.list()[0].points.length, 2, 'on my screen immediately');
  assert.equal(changes.length, 2);
  assert.equal(sent.length, 0, 'nothing sent until the batch timer');
  tick();
  assert.deepEqual(sent, [
    {
      type: 'stroke',
      id: 'stroke-1',
      points: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
      color: '#6C4DE6',
      size: 6,
      eraser: false,
    },
  ]);
  board.extend([0.3, 0.3]);
  board.end();
  assert.deepEqual(sent[1], { type: 'stroke', id: 'stroke-1', points: [[0.3, 0.3]] }, 'lifting the pen sends the rest');
  assert.equal(board.isDrawing, false);
  board.extend([0.9, 0.9]);
  assert.equal(board.list()[0].points.length, 3, 'moving with the pen up draws nothing');
});

test('the eraser is a thick stroke that rubs out', () => {
  const { board, sent } = setup();
  board.begin({ ...pen, eraser: true }, [0.5, 0.5]);
  board.end();
  assert.equal((sent[0] as any).eraser, true);
  assert.equal((sent[0] as any).size, 6 * ERASER_FACTOR);
});

test('other people’s strokes arrive whole or in parts, and the listener hears who is drawing', () => {
  const { board, changes } = setup();
  const heard: number[] = [];
  board.onRemote((id) => heard.push(id));
  board.applyRemote({ type: 'stroke', id: 'theirs', userId: 1, points: [[0, 0]], color: '#1b1f3a', size: 3 }, 1);
  board.applyRemote({ type: 'stroke', id: 'theirs', points: [[0.1, 0.1]] }, 1);
  assert.deepEqual(board.list()[0], {
    id: 'theirs',
    userId: 1,
    points: [
      [0, 0],
      [0.1, 0.1],
    ],
    color: '#1b1f3a',
    size: 3,
    eraser: false,
  });
  assert.deepEqual(heard, [1, 1]);
  assert.deepEqual(changes.at(-1), { kind: 'segment', stroke: board.list()[0], from: 0 });
  // More points for a stroke this tab never saw start are ignored.
  board.applyRemote({ type: 'stroke', id: 'unknown', points: [[0.5, 0.5]] }, 1);
  assert.equal(board.list().length, 1);
});

test('undo takes back my latest stroke, never someone else’s', () => {
  const { board, sent } = setup(2);
  board.applyRemote({ type: 'stroke', id: 'megs', userId: 1, points: [[0, 0]], color: '#1b1f3a', size: 3 }, 1);
  assert.equal(board.undoMine(), false, 'I have drawn nothing');
  board.begin(pen, [0.1, 0.1]);
  board.end();
  board.applyRemote({ type: 'stroke', id: 'megs-2', userId: 1, points: [[0, 0]], color: '#1b1f3a', size: 3 }, 1);
  assert.equal(board.undoMine(), true);
  assert.deepEqual(sent.at(-1), { type: 'undo', stroke_id: 'stroke-1' });
  assert.deepEqual(
    board.list().map((s) => s.id),
    ['megs', 'megs-2'],
  );
});

test('someone takes a stroke back, the host clears, the server says the board is full', () => {
  const { board, changes } = setup();
  board.load([
    { id: 'a', userId: 1, points: [[0, 0]], color: '#1b1f3a', size: 3, eraser: false },
    { id: 'b', userId: 3, points: [[0, 0]], color: '#1b1f3a', size: 3, eraser: false },
  ]);
  board.applyRemote({ type: 'undo', stroke_id: 'a' }, 1);
  assert.deepEqual(
    board.list().map((s) => s.id),
    ['b'],
  );
  board.begin(pen, [0.1, 0.1]);
  board.applyRemote({ type: 'full', stroke_id: 'stroke-1' }, null);
  assert.equal(board.full, true);
  assert.equal(board.isDrawing, false);
  assert.deepEqual(
    board.list().map((s) => s.id),
    ['b'],
    'my refused stroke is taken off my screen too',
  );
  board.applyRemote({ type: 'clear' }, 1);
  assert.equal(board.isEmpty, true);
  assert.equal(board.full, false);
  assert.equal(changes.at(-1)?.kind, 'redraw');
});

test('clearing sends one message and empties my board; leaving the call empties it without sending', () => {
  const { board, sent } = setup();
  board.begin(pen, [0.1, 0.1]);
  board.end();
  sent.length = 0;
  board.clear();
  assert.deepEqual(sent, [{ type: 'clear' }]);
  assert.equal(board.isEmpty, true);
  board.begin(pen, [0.1, 0.1]);
  sent.length = 0;
  board.reset();
  assert.equal(board.isEmpty, true);
  assert.equal(sent.length, 0);
});

test('the view: the host’s moves are shared a few times a second; a watcher’s own moves are not; everyone follows the host', () => {
  const { board, sent, changes, tick } = setup();
  board.setView({ x: 0, y: 0.5, zoom: 1 }, { share: true });
  board.setView({ x: 0, y: 1, zoom: 2 }, { share: true });
  assert.deepEqual(board.view, { x: 0, y: 1, zoom: 2 }, 'on my screen at once');
  assert.equal(sent.length, 0);
  tick();
  assert.deepEqual(sent, [{ type: 'view', x: 0, y: 1, zoom: 2 }], 'only the latest position is sent');
  sent.length = 0;
  board.setView({ x: 0.2, y: 1, zoom: 2 }); // looking around without sharing: no timer is set, nothing is sent
  assert.equal(sent.length, 0);
  board.applyRemote({ type: 'view', x: 0, y: 3, zoom: 0.5 }, 1);
  assert.deepEqual(board.view, { x: 0, y: 3, zoom: 0.5 });
  assert.equal(changes.at(-1)?.kind, 'redraw');
});

test('the view stays within the board and the zoom limits; clearing and leaving put it back', () => {
  const { board } = setup();
  board.setView({ x: -500, y: 500, zoom: 99 });
  assert.deepEqual(board.view, { x: -9, y: 9, zoom: 4 });
  board.setView({ x: 0, y: 0, zoom: 0.01 });
  assert.equal(board.view.zoom, 0.25);
  board.applyRemote({ type: 'clear' }, 1);
  assert.deepEqual(board.view, { x: 0, y: 0, zoom: 1 });
  board.load([], { x: 0, y: 2, zoom: 1.5 });
  assert.deepEqual(board.view, { x: 0, y: 2, zoom: 1.5 }, 'a late joiner starts where the host is looking');
  board.reset();
  assert.deepEqual(board.view, { x: 0, y: 0, zoom: 1 });
});
