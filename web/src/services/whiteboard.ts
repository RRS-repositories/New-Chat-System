/**
 * The shared whiteboard of the call this tab is in (no React, no canvas: the drawing itself).
 *
 * A drawing is a list of strokes; a stroke is a list of points, each between 0 and 1 across and
 * down, so it lands in the same place on every screen size. What this person draws is shown at
 * once and sent to the others in small batches; what the others draw arrives the same way.
 */
export type Point = [number, number];
export type Stroke = { id: string; userId: number; points: Point[]; color: string; size: number; eraser: boolean };
export type Pen = { color: string; size: number; eraser: boolean };
/** A change to the board, as sent and received (`call_wb`). */
export type BoardOp =
  | { type: 'stroke'; id: string; points: Point[]; color?: string; size?: number; eraser?: boolean; userId?: number }
  | { type: 'undo'; stroke_id: string }
  | { type: 'clear' }
  | { type: 'full'; stroke_id: string };
/** What changed, for whoever is drawing the board on a canvas. */
export type BoardChange =
  | { kind: 'segment'; stroke: Stroke; from: number } // points from index `from` were added: draw just those
  | { kind: 'redraw' }; // strokes were removed or replaced: draw everything again

export const PEN_COLOURS = ['#1B1F3A', '#6C4DE6', '#E0507A', '#1FA75A', '#E8930C'];
export const PEN_SIZES = [3, 6, 10];
export const ERASER_FACTOR = 6;
export const SEND_EVERY_MS = 100;
const MAX_BATCH = 300;

type Deps = {
  myUserId: number;
  send: (op: BoardOp) => void;
  /** Injected for tests. */
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  newId?: () => string;
};

const randomId = (userId: number) =>
  `${userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.slice(0, 40);

export class Whiteboard {
  private strokes = new Map<string, Stroke>();
  private listeners = new Set<(change: BoardChange) => void>();
  private remoteListeners = new Set<(userId: number) => void>();
  private drawing: Stroke | null = null;
  /** Points of the stroke being drawn that the others have not been sent yet. */
  private unsent: Point[] = [];
  private announced = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly timers: NonNullable<Deps['timers']>;
  private readonly deps: Deps;
  /** Set when the server refused a stroke because the board is full. */
  full = false;

  constructor(deps: Deps) {
    this.deps = deps;
    // Wrapped: the browser's timers must be called on the window, not on this object.
    this.timers = deps.timers ?? {
      setTimeout: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as typeof setTimeout,
      clearTimeout: ((handle: ReturnType<typeof setTimeout>) => clearTimeout(handle)) as typeof clearTimeout,
    };
  }

  list(): Stroke[] {
    return [...this.strokes.values()];
  }
  get isEmpty(): boolean {
    return this.strokes.size === 0;
  }

  /** Told about every change to the drawing. Returns the way to stop listening. */
  subscribe(listener: (change: BoardChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** Told when someone else draws (so a closed board can say "Ann is drawing"). */
  onRemote(listener: (userId: number) => void): () => void {
    this.remoteListeners.add(listener);
    return () => this.remoteListeners.delete(listener);
  }
  private tell(change: BoardChange) {
    for (const listener of this.listeners) listener(change);
  }

  /** The board as the server holds it, on joining the call. */
  load(strokes: Stroke[] | undefined): void {
    this.strokes.clear();
    for (const s of strokes || []) this.strokes.set(s.id, { ...s, points: [...s.points] });
    this.full = false;
    this.tell({ kind: 'redraw' });
  }

  /** The call is over. */
  reset(): void {
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    this.drawing = null;
    this.unsent = [];
    this.strokes.clear();
    this.full = false;
    this.tell({ kind: 'redraw' });
  }

  /** A change made by someone else in the call. */
  applyRemote(op: BoardOp, fromUserId: number | null): void {
    if (!op || typeof op !== 'object') return;
    if (op.type === 'stroke') {
      if (!Array.isArray(op.points)) return;
      const existing = this.strokes.get(op.id);
      if (existing) {
        const from = existing.points.length;
        existing.points.push(...op.points);
        this.tell({ kind: 'segment', stroke: existing, from: Math.max(0, from - 1) });
      } else if (typeof op.color === 'string' && typeof op.size === 'number') {
        const stroke: Stroke = {
          id: op.id,
          userId: Number(op.userId ?? fromUserId ?? 0),
          points: [...op.points],
          color: op.color,
          size: op.size,
          eraser: op.eraser === true,
        };
        this.strokes.set(stroke.id, stroke);
        this.tell({ kind: 'segment', stroke, from: 0 });
      } else return;
      if (fromUserId != null) for (const listener of this.remoteListeners) listener(fromUserId);
      return;
    }
    if (op.type === 'undo' || op.type === 'full') {
      if (op.type === 'full') this.full = true;
      if (this.drawing?.id === op.stroke_id) this.drawing = null;
      if (this.strokes.delete(op.stroke_id) || op.type === 'full') this.tell({ kind: 'redraw' });
      return;
    }
    if (op.type === 'clear') {
      this.strokes.clear();
      this.drawing = null;
      this.unsent = [];
      this.full = false;
      this.tell({ kind: 'redraw' });
    }
  }

  /** This person puts the pen down. */
  begin(pen: Pen, point: Point): void {
    this.end();
    const stroke: Stroke = {
      id: (this.deps.newId ?? (() => randomId(this.deps.myUserId)))(),
      userId: this.deps.myUserId,
      points: [point],
      color: pen.color,
      size: pen.eraser ? pen.size * ERASER_FACTOR : pen.size,
      eraser: pen.eraser,
    };
    this.strokes.set(stroke.id, stroke);
    this.drawing = stroke;
    this.unsent = [point];
    this.announced = false;
    this.tell({ kind: 'segment', stroke, from: 0 });
    this.schedule();
  }

  /** The pen moves. */
  extend(point: Point): void {
    const stroke = this.drawing;
    if (!stroke) return;
    stroke.points.push(point);
    this.unsent.push(point);
    this.tell({ kind: 'segment', stroke, from: stroke.points.length - 2 });
    if (this.unsent.length >= MAX_BATCH) this.flush();
    else this.schedule();
  }

  /** The pen lifts: whatever was not sent yet goes now. */
  end(): void {
    if (!this.drawing) return;
    this.flush();
    this.drawing = null;
  }

  get isDrawing(): boolean {
    return !!this.drawing;
  }

  private schedule() {
    if (this.timer) return;
    this.timer = this.timers.setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SEND_EVERY_MS);
  }

  private flush() {
    if (this.timer) this.timers.clearTimeout(this.timer);
    this.timer = null;
    const stroke = this.drawing;
    if (!stroke || !this.unsent.length) return;
    const points = this.unsent;
    this.unsent = [];
    if (this.announced) this.deps.send({ type: 'stroke', id: stroke.id, points });
    else
      this.deps.send({
        type: 'stroke',
        id: stroke.id,
        points,
        color: stroke.color,
        size: stroke.size,
        eraser: stroke.eraser,
      });
    this.announced = true;
  }

  /** Takes back this person's latest stroke. False when they have none. */
  undoMine(): boolean {
    this.end();
    const mine = this.list()
      .reverse()
      .find((s) => s.userId === this.deps.myUserId);
    if (!mine) return false;
    this.strokes.delete(mine.id);
    this.full = false;
    this.deps.send({ type: 'undo', stroke_id: mine.id });
    this.tell({ kind: 'redraw' });
    return true;
  }

  /** Wipes the board for everyone (the server lets only the host). */
  clear(): void {
    this.drawing = null;
    this.unsent = [];
    this.strokes.clear();
    this.full = false;
    this.deps.send({ type: 'clear' });
    this.tell({ kind: 'redraw' });
  }
}
