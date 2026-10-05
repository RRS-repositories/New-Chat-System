// The call whiteboard: strokes are relayed to the others in the call, kept for late joiners,
// taken back only by their author, wiped only by the host, and never leave the call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { MAX_POINTS_PER_BATCH, MAX_STROKES, cleanPoints, createCallBoard } from '../src/services/calls/call.board.js';
import { attachCallSignalling } from '../src/sockets/calls.socket.js';

function setup(options = {}) {
  const sent = [];
  // Call k1: Meg (1) on s1, Ann (2) on s2, Bob (3) on s3. Call k2: Cy (5) on s5.
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
const ann = { callId: 'k1', userId: 2, socketId: 's2' };
const meg = { callId: 'k1', userId: 1, socketId: 's1' };

test('cleanPoints: pairs of numbers, kept inside the board', () => {
  assert.deepEqual(
    cleanPoints([
      [0.5, 0.25],
      [-3, 7],
    ]),
    [
      [0.5, 0.25],
      [0, 1],
    ],
  );
  assert.deepEqual(cleanPoints([[0.123456789, 0.5]]), [[0.1235, 0.5]]);
  for (const bad of [null, [], 'x', [[1]], [[1, 2, 3]], [['a', 1]], [[NaN, 0]], [[Infinity, 0]], [{ x: 1, y: 1 }]])
    assert.equal(cleanPoints(bad), null, JSON.stringify(bad));
  assert.equal(cleanPoints(Array.from({ length: MAX_POINTS_PER_BATCH + 1 }, () => [0, 0])), null);
});

test('a stroke goes to the others in the call (not back to the drawer, not to another call) and is kept', () => {
  const { board, sent } = setup();
  assert.equal(board.apply({ ...ann, op: stroke('stroke-1') }), true);
  assert.deepEqual(sent.map((e) => e.socketId).sort(), ['s1', 's3']);
  assert.deepEqual(sent[0].payload, {
    call_id: 'k1',
    from_user_id: 2,
    op: {
      type: 'stroke',
      id: 'stroke-1',
      userId: 2,
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

test('more points for a stroke being drawn are added to it; nobody can add to another person’s stroke', () => {
  const { board, sent } = setup();
  board.apply({ ...ann, op: stroke('stroke-1') });
  sent.length = 0;
  assert.equal(board.apply({ ...ann, op: { type: 'stroke', id: 'stroke-1', points: [[0.2, 0.3]] } }), true);
  assert.deepEqual(sent[0].payload.op, { type: 'stroke', id: 'stroke-1', points: [[0.2, 0.3]] });
  assert.equal(board.snapshot('k1').whiteboard[0].points.length, 3);
  assert.equal(board.apply({ ...meg, op: { type: 'stroke', id: 'stroke-1', points: [[0.9, 0.9]] } }), false);
  assert.equal(board.snapshot('k1').whiteboard[0].points.length, 3);
});

test('only the call device of someone in the call can draw, and only a well-formed stroke is taken', () => {
  const { board, sent } = setup();
  assert.equal(board.apply({ callId: 'k1', userId: 2, socketId: 's2-other-tab', op: stroke('stroke-1') }), false);
  assert.equal(board.apply({ callId: 'k1', userId: 5, socketId: 's5', op: stroke('stroke-1') }), false);
  assert.equal(board.apply({ callId: 'nope', userId: 2, socketId: 's2', op: stroke('stroke-1') }), false);
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
  ])
    assert.equal(board.apply({ ...ann, op: bad }), false, JSON.stringify(bad));
  assert.equal(sent.length, 0);
  assert.deepEqual(board.snapshot('k1').whiteboard, []);
});

test('undo takes back your own stroke only', () => {
  const { board, sent } = setup();
  board.apply({ ...ann, op: stroke('ann-stroke') });
  board.apply({ ...meg, op: stroke('meg-stroke') });
  sent.length = 0;
  assert.equal(board.apply({ ...meg, op: { type: 'undo', stroke_id: 'ann-stroke' } }), false, 'not even the host');
  assert.equal(board.apply({ ...ann, op: { type: 'undo', stroke_id: 'nothing' } }), false);
  assert.equal(sent.length, 0);
  assert.equal(board.apply({ ...ann, op: { type: 'undo', stroke_id: 'ann-stroke' } }), true);
  assert.deepEqual(sent.map((e) => e.socketId).sort(), ['s1', 's3']);
  assert.deepEqual(sent[0].payload.op, { type: 'undo', stroke_id: 'ann-stroke' });
  assert.deepEqual(
    board.snapshot('k1').whiteboard.map((s) => s.id),
    ['meg-stroke'],
  );
});

test('clear wipes the board for everyone, and only the host can', () => {
  const { board, sent } = setup();
  board.apply({ ...ann, op: stroke('ann-stroke') });
  sent.length = 0;
  assert.equal(board.apply({ ...ann, op: { type: 'clear' } }), false);
  assert.equal(board.snapshot('k1').whiteboard.length, 1);
  assert.equal(board.apply({ ...meg, op: { type: 'clear' }, isHost: true }), true);
  assert.deepEqual(sent.map((e) => [e.socketId, e.payload.op.type]).sort(), [
    ['s2', 'clear'],
    ['s3', 'clear'],
  ]);
  assert.deepEqual(board.snapshot('k1').whiteboard, []);
});

test('a full board takes no more strokes, and tells the drawer to take theirs back', () => {
  const { board, sent } = setup();
  for (let i = 0; i < MAX_STROKES; i++) board.apply({ ...ann, op: stroke(`stroke-${i}`) });
  sent.length = 0;
  assert.equal(board.apply({ ...ann, op: stroke('one-too-many') }), false);
  assert.deepEqual(sent, [
    {
      socketId: 's2',
      event: 'call_wb',
      payload: { call_id: 'k1', from_user_id: null, op: { type: 'full', stroke_id: 'one-too-many' } },
    },
  ]);
  assert.equal(board.snapshot('k1').whiteboard.length, MAX_STROKES);
});

test('the board is gone when the call ends, and waits while it is paused', () => {
  const { board } = setup();
  board.apply({ ...ann, op: stroke('stroke-1') });
  board.forget('k1');
  assert.deepEqual(board.snapshot('k1').whiteboard, []);
  const paused = setup({ isPaused: (callId) => callId === 'k1' });
  assert.equal(paused.board.apply({ ...ann, op: stroke('stroke-1') }), false);
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
