// The call whiteboard: only the host draws; strokes are relayed to the others in the call and kept
// for late joiners; the host's view (where they are looking, how far zoomed) is followed by everyone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  BOARD_MAX,
  BOARD_MIN,
  MAX_POINTS_PER_BATCH,
  MAX_STROKES,
  cleanPoints,
  createCallBoard,
} from '../src/services/calls/call.board.js';
import { attachCallSignalling } from '../src/sockets/calls.socket.js';

function setup(options = {}) {
  const sent = [];
  // Call k1: Meg (1, host) on s1, Ann (2) on s2, Bob (3) on s3. Call k2: Cy (5) on s5.
  const devices = new Map([
    [
      'k1',
      new Map([
        [1, 's1'],
        [2, 's2'],
        [3, 's3'],
      ]),
    ],
    ['k2', new Map([[5, 's5']])],
  ]);
  const toSocket = (socketId, event, payload) => sent.push({ socketId, event, payload });
  const board = createCallBoard({ devices, toSocket, ...options });
  return { board, sent, devices };
}
const stroke = (id, extra = {}) => ({
  type: 'stroke',
  id,
  points: [
    [0.1, 0.2],
    [0.15, 0.25],
  ],
  color: '#6C4DE6',
  size: 6,
  eraser: false,
  ...extra,
});
const meg = { callId: 'k1', userId: 1, socketId: 's1', isHost: true };
const ann = { callId: 'k1', userId: 2, socketId: 's2', isHost: false };

test('cleanPoints: pairs of numbers, kept inside the board (which reaches beyond the first screenful)', () => {
  assert.deepEqual(
    cleanPoints([
      [0.5, 0.25],
      [-3, 7],
      [-99, 99],
    ]),
    [
      [0.5, 0.25],
      [-3, 7],
      [BOARD_MIN, BOARD_MAX],
    ],
  );
  assert.deepEqual(cleanPoints([[0.123456789, 0.5]]), [[0.1235, 0.5]]);
  for (const bad of [null, [], 'x', [[1]], [[1, 2, 3]], [['a', 1]], [[NaN, 0]], [[Infinity, 0]], [{ x: 1, y: 1 }]])
    assert.equal(cleanPoints(bad), null, JSON.stringify(bad));
  assert.equal(cleanPoints(Array.from({ length: MAX_POINTS_PER_BATCH + 1 }, () => [0, 0])), null);
});

test('the host’s stroke goes to the others in the call (not back, not to another call) and is kept', () => {
  const { board, sent } = setup();
  assert.equal(board.apply({ ...meg, op: stroke('stroke-1') }), true);
  assert.deepEqual(sent.map((e) => e.socketId).sort(), ['s2', 's3']);
  assert.deepEqual(sent[0].payload, {
    call_id: 'k1',
    from_user_id: 1,
    op: {
      type: 'stroke',
      id: 'stroke-1',
      userId: 1,
      points: [
        [0.1, 0.2],
        [0.15, 0.25],
      ],
      color: '#6c4de6',
      size: 6,
      eraser: false,
    },
  });
  assert.equal(board.snapshot('k1').whiteboard.length, 1);
  assert.deepEqual(board.snapshot('k2').whiteboard, []);
});

test('only the host can change the board: nobody else can draw, undo, clear or move the view', () => {
  const { board, sent } = setup();
  board.apply({ ...meg, op: stroke('megs-stroke') });
  sent.length = 0;
  for (const op of [
    stroke('anns-stroke'),
    { type: 'stroke', id: 'megs-stroke', points: [[0.9, 0.9]] },
    { type: 'undo', stroke_id: 'megs-stroke' },
    { type: 'clear' },
    { type: 'view', x: 0, y: 1, zoom: 2 },
  ])
    assert.equal(board.apply({ ...ann, op }), false, op.type);
  assert.equal(sent.length, 0);
  assert.deepEqual(
    board.snapshot('k1').whiteboard.map((s) => [s.id, s.points.length]),
    [['megs-stroke', 2]],
  );
  assert.equal(board.snapshot('k1').whiteboardView, null);
});

test('more points for a stroke being drawn are added to it', () => {
  const { board, sent } = setup();
  board.apply({ ...meg, op: stroke('stroke-1') });
  sent.length = 0;
  assert.equal(board.apply({ ...meg, op: { type: 'stroke', id: 'stroke-1', points: [[0.2, 1.6]] } }), true);
  assert.deepEqual(sent[0].payload.op, { type: 'stroke', id: 'stroke-1', points: [[0.2, 1.6]] });
  assert.equal(board.snapshot('k1').whiteboard[0].points.length, 3);
});

test('the host must be on their own call device, and only a well-formed stroke is taken', () => {
  const { board, sent } = setup();
  assert.equal(board.apply({ ...meg, socketId: 's1-other-tab', op: stroke('stroke-1') }), false);
  assert.equal(board.apply({ callId: 'nope', userId: 1, socketId: 's1', isHost: true, op: stroke('stroke-1') }), false);
  for (const bad of [
    null,
    'draw',
    {},
    { type: 'paint' },
    stroke('x'), // id too short
    stroke('has spaces in it'),
    stroke('stroke-1', { color: 'red' }),
    stroke('stroke-1', { color: 'javascript:alert(1)' }),
    stroke('stroke-1', { size: 0 }),
    stroke('stroke-1', { size: 500 }),
    stroke('stroke-1', { points: 'lots' }),
    { type: 'view', x: 'left', y: 0, zoom: 1 },
    { type: 'view', x: 0, y: 0 },
  ])
    assert.equal(board.apply({ ...meg, op: bad }), false, JSON.stringify(bad));
  assert.equal(sent.length, 0);
  assert.deepEqual(board.snapshot('k1').whiteboard, []);
});

test('undo takes back a stroke of the host’s own; a new host cannot undo the earlier host’s strokes', () => {
  const { board, sent } = setup();
  board.apply({ ...meg, op: stroke('megs-stroke') });
  // Meg leaves; Ann stands in as host.
  const annAsHost = { ...ann, isHost: true };
  board.apply({ ...annAsHost, op: stroke('anns-stroke') });
  sent.length = 0;
  assert.equal(board.apply({ ...annAsHost, op: { type: 'undo', stroke_id: 'megs-stroke' } }), false);
  assert.equal(board.apply({ ...annAsHost, op: { type: 'undo', stroke_id: 'nothing' } }), false);
  assert.equal(sent.length, 0);
  assert.equal(board.apply({ ...annAsHost, op: { type: 'undo', stroke_id: 'anns-stroke' } }), true);
  assert.deepEqual(sent[0].payload.op, { type: 'undo', stroke_id: 'anns-stroke' });
  assert.deepEqual(
    board.snapshot('k1').whiteboard.map((s) => s.id),
    ['megs-stroke'],
  );
});

test('the host’s view is sent to the others, kept for late joiners, and held within limits', () => {
  const { board, sent } = setup();
  assert.equal(board.apply({ ...meg, op: { type: 'view', x: 0.25, y: 1.5, zoom: 2 } }), true);
  assert.deepEqual(sent.map((e) => e.socketId).sort(), ['s2', 's3']);
  assert.deepEqual(sent[0].payload.op, { type: 'view', x: 0.25, y: 1.5, zoom: 2 });
  assert.deepEqual(board.snapshot('k1').whiteboardView, { x: 0.25, y: 1.5, zoom: 2 });
  board.apply({ ...meg, op: { type: 'view', x: -500, y: 500, zoom: 99 } });
  assert.deepEqual(board.snapshot('k1').whiteboardView, { x: BOARD_MIN, y: BOARD_MAX, zoom: 4 });
});

test('clear wipes the board and puts the view back for everyone', () => {
  const { board, sent } = setup();
  board.apply({ ...meg, op: stroke('stroke-1') });
  board.apply({ ...meg, op: { type: 'view', x: 0, y: 2, zoom: 1 } });
  sent.length = 0;
  assert.equal(board.apply({ ...meg, op: { type: 'clear' } }), true);
  assert.deepEqual(sent.map((e) => [e.socketId, e.payload.op.type]).sort(), [
    ['s2', 'clear'],
    ['s3', 'clear'],
  ]);
  assert.deepEqual(board.snapshot('k1'), { whiteboard: [], whiteboardView: null });
});

test('a full board takes no more strokes, and tells the drawer to take theirs back', () => {
  const { board, sent } = setup();
  for (let i = 0; i < MAX_STROKES; i++) board.apply({ ...meg, op: stroke(`stroke-${i}`) });
  sent.length = 0;
  assert.equal(board.apply({ ...meg, op: stroke('one-too-many') }), false);
  assert.deepEqual(sent, [
    {
      socketId: 's1',
      event: 'call_wb',
      payload: { call_id: 'k1', from_user_id: null, op: { type: 'full', stroke_id: 'one-too-many' } },
    },
  ]);
  assert.equal(board.snapshot('k1').whiteboard.length, MAX_STROKES);
});

test('the board is gone when the call ends, and waits while it is paused', () => {
  const { board } = setup();
  board.apply({ ...meg, op: stroke('stroke-1') });
  board.apply({ ...meg, op: { type: 'view', x: 0, y: 1, zoom: 1 } });
  board.forget('k1');
  assert.deepEqual(board.snapshot('k1'), { whiteboard: [], whiteboardView: null });
  const paused = setup({ isPaused: (callId) => callId === 'k1' });
  assert.equal(paused.board.apply({ ...meg, op: stroke('stroke-1') }), false);
  assert.equal(paused.sent.length, 0);
});

test('the socket passes call_wb to the call service with who sent it', async () => {
  const socket = new EventEmitter();
  socket.id = 's2';
  const seen = [];
  const calls = { whiteboard: async (args) => seen.push(args), onSocketDisconnect() {}, relaySignal() {} };
  attachCallSignalling({ socket, user: { id: 2 }, calls });
  socket.emit('call_wb', { call_id: 'k1', op: { type: 'clear' } });
  socket.emit('call_wb', null);
  socket.emit('call_wb', { op: { type: 'clear' } });
  assert.deepEqual(seen, [{ callId: 'k1', userId: 2, socketId: 's2', op: { type: 'clear' } }]);
});
