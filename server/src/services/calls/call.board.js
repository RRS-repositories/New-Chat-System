/**
 * The shared whiteboard of a live call.
 *
 * Only the host draws; everyone in the call sees it. A drawing is a list of strokes; a stroke is
 * a list of points with a colour and a thickness. A point is a fraction of the board's width and
 * height (0 to 1 is the first screenful), so it lands in the same place on every screen size; the
 * board goes on beyond that first screenful, and the host can move and zoom the view. Everyone
 * else's view follows the host's. The strokes are kept in memory for the life of the call, so a
 * person who joins late sees the board as it is, and they are gone when the call ends: nothing
 * is stored in the database.
 *
 * A request is honoured only from the sender's own call device, like reactions and raised hands.
 */
export const MAX_STROKES = 2000;
export const MAX_POINTS_PER_BATCH = 400;
export const MAX_POINTS_PER_STROKE = 6000;
const MAX_SIZE = 80; // the eraser is a thick stroke
/** How far the board reaches beyond the first screenful, in screenfuls. */
export const BOARD_MIN = -10;
export const BOARD_MAX = 10;
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
const ID = /^[A-Za-z0-9_-]{6,40}$/;
const COLOUR = /^#[0-9a-fA-F]{6}$/;

const round = (n) => Math.round(n * 10000) / 10000;
/** The usable points of a batch, or null when the batch is not a list of [x, y] pairs. */
export function cleanPoints(points) {
  if (!Array.isArray(points) || points.length === 0 || points.length > MAX_POINTS_PER_BATCH) return null;
  const out = [];
  for (const p of points) {
    if (!Array.isArray(p) || p.length !== 2) return null;
    const [x, y] = p;
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    out.push([round(Math.min(BOARD_MAX, Math.max(BOARD_MIN, x))), round(Math.min(BOARD_MAX, Math.max(BOARD_MIN, y)))]);
  }
  return out;
}

export function createCallBoard({ devices, toSocket, isPaused = () => false }) {
  const views = new Map(); // callId -> { x, y, zoom }: where the host is looking
  const boards = new Map(); // callId -> Map(strokeId -> { id, userId, points, color, size, eraser }), in drawing order

  const fromCallDevice = (callId, userId, socketId) =>
    typeof socketId === 'string' && devices.get(callId)?.get(userId) === socketId;
  /** To everyone else in the call. */
  const toOthers = (callId, userId, op) => {
    for (const [otherId, socketId] of devices.get(callId) || [])
      if (otherId !== userId) toSocket(socketId, 'call_wb', { call_id: callId, from_user_id: userId, op });
  };
  const back = (socketId, callId, op) => toSocket(socketId, 'call_wb', { call_id: callId, from_user_id: null, op });

  return {
    /** The whole board, for a person joining the call. */
    snapshot(callId) {
      return { whiteboard: [...(boards.get(callId)?.values() || [])], whiteboardView: views.get(callId) || null };
    },

    /**
     * One change to the board, from the host: a new stroke or more points for one being drawn
     * (`stroke`), taking back one of their own strokes (`undo`), wiping the board (`clear`), or where
     * they are looking (`view`). `isHost` says whether the sender is the host of the call; nobody
     * else can change the board. Returns false when the change was dropped.
     */
    apply({ callId, userId, socketId, op, isHost = false }) {
      if (!fromCallDevice(callId, userId, socketId) || !op || typeof op !== 'object') return false;
      if (!isHost) return false;
      if (isPaused(callId)) return false; // breakout groups are running: the board waits
      const board = boards.get(callId) || new Map();

      if (op.type === 'stroke') {
        const points = cleanPoints(op.points);
        if (!points || typeof op.id !== 'string' || !ID.test(op.id)) return false;
        const existing = board.get(op.id);
        if (existing) {
          if (existing.userId !== userId) return false;
          if (existing.points.length + points.length > MAX_POINTS_PER_STROKE) return false;
          existing.points.push(...points);
          toOthers(callId, userId, { type: 'stroke', id: op.id, points });
          return true;
        }
        const size = Number(op.size);
        if (typeof op.color !== 'string' || !COLOUR.test(op.color) || !(size >= 1 && size <= MAX_SIZE)) return false;
        if (board.size >= MAX_STROKES) {
          // The board is full: the sender's own copy of the stroke is taken back, so every screen stays the same.
          back(socketId, callId, { type: 'full', stroke_id: op.id });
          return false;
        }
        const stroke = { id: op.id, userId, points, color: op.color.toLowerCase(), size, eraser: op.eraser === true };
        board.set(op.id, stroke);
        boards.set(callId, board);
        toOthers(callId, userId, { type: 'stroke', ...stroke });
        return true;
      }

      if (op.type === 'undo') {
        const stroke = typeof op.stroke_id === 'string' ? board.get(op.stroke_id) : null;
        if (!stroke || stroke.userId !== userId) return false;
        board.delete(stroke.id);
        toOthers(callId, userId, { type: 'undo', stroke_id: stroke.id });
        return true;
      }

      if (op.type === 'view') {
        const { x, y, zoom } = op;
        if (![x, y, zoom].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
        const view = {
          x: round(Math.min(BOARD_MAX, Math.max(BOARD_MIN, x))),
          y: round(Math.min(BOARD_MAX, Math.max(BOARD_MIN, y))),
          zoom: round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))),
        };
        views.set(callId, view);
        toOthers(callId, userId, { type: 'view', ...view });
        return true;
      }

      if (op.type === 'clear') {
        boards.delete(callId);
        views.delete(callId);
        toOthers(callId, userId, { type: 'clear' });
        return true;
      }
      return false;
    },

    /** The call is over. */
    forget(callId) {
      boards.delete(callId);
      views.delete(callId);
    },
  };
}
