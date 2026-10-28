/**
 * The shared whiteboard of the call this tab is in (no React, no canvas: the drawing itself).
 *
 * A drawing is a list of strokes. A freehand stroke (pen, highlighter, eraser) is a list of points,
 * each between 0 and 1 across and down, so it lands in the same place on every screen size; a
 * shape (line, arrow, rectangle, ellipse) is its two corners; text is one point and the words.
 * What this person draws is shown at once and sent to the others in small batches (a shape or
 * text goes whole, when it is finished); what the others draw arrives the same way.
 */
import {
  HIGHLIGHT_FACTOR,
  KINDS,
  cleanText,
  textSizeOf,
  type Point,
  type ShapeKind,
  type StrokeKind,
  type Tool,
} from '../utils/boardTools.ts';
export type { Point, ShapeKind, StrokeKind, Tool };

export type Stroke = {
  id: string;
  userId: number;
  points: Point[];
  color: string;
  size: number;
  eraser: boolean;
  /** Missing means a pen stroke. */
  kind?: StrokeKind;
  /** The words, for `text`. */
  text?: string;
};
/** What the host has in hand: the colour and thickness, and the tool. */
export type Pen = { color: string; size: number; tool: Tool };
/** A change to the board, as sent and received (`call_wb`). */
export type BoardOp =
  | {
      type: 'stroke';
      id: string;
      points: Point[];
      color?: string;
      size?: number;
      eraser?: boolean;
      kind?: StrokeKind;
      text?: string;
      userId?: number;
    }
  | { type: 'undo'; stroke_id: string }
  | { type: 'clear' }
  | { type: 'full'; stroke_id: string }
  | { type: 'view'; x: number; y: number; zoom: number };
/** Where on the board the screen is looking (its top-left corner, in screenfuls) and how far zoomed in. */
export type View = { x: number; y: number; zoom: number };
export const HOME_VIEW: View = { x: 0, y: 0, zoom: 1 };
export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 4;
/** How far the view can travel from the first screenful, in screenfuls. */
const VIEW_MIN = -9;
const VIEW_MAX = 9;
const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export const cleanView = (v: View): View => ({
  x: clamp(v.x, VIEW_MIN, VIEW_MAX),
  y: clamp(v.y, VIEW_MIN, VIEW_MAX),
  zoom: clamp(v.zoom, ZOOM_MIN, ZOOM_MAX),
});
/** What changed, for whoever is drawing the board on a canvas. */
export type BoardChange =
  | { kind: 'segment'; stroke: Stroke; from: number } // points from index `from` were added: draw just those
  | { kind: 'redraw' }; // strokes were removed or replaced, or the view moved: draw everything again

export const PEN_COLOURS = ['#1B1F3A', '#6C4DE6', '#1E6FE8', '#1FA75A', '#F2C319', '#E8930C', '#E0507A', '#D7263D'];
export const PEN_SIZES = [3, 6, 10];
export const ERASER_FACTOR = 6;
export const SEND_EVERY_MS = 100;
const MAX_BATCH = 300;
/** How many undone strokes can be put back. */
const MAX_REDO = 50;

type Deps = {
  myUserId: number;
  send: (op: BoardOp) => void;
  /** Injected for tests. */
  timers?: { setTimeout: typeof setTimeout; clearTimeout: typeof clearTimeout };
  newId?: () => string;
};

const randomId = (userId: number) =>
  `${userId}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`.slice(0, 40);

/** The stroke as first sent: everything about it. */
const describe = (stroke: Stroke, points: Point[]): BoardOp => ({
  type: 'stroke',
  id: stroke.id,
  points,
  color: stroke.color,
  size: stroke.size,
  eraser: stroke.eraser,
  ...(stroke.kind ? { kind: stroke.kind } : {}),
  ...(stroke.text != null ? { text: stroke.text } : {}),
});

export class Whiteboard {
  private strokes = new Map<string, Stroke>();
  private listeners = new Set<(change: BoardChange) => void>();
  private remoteListeners = new Set<(userId: number) => void>();
  private drawing: Stroke | null = null;
  /** Points of the stroke being drawn that the others have not been sent yet. */
  private unsent: Point[] = [];
  private announced = false;
  /** This person's undone strokes, latest last, ready to be put back. */
  private undone: Stroke[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private viewTimer: ReturnType<typeof setTimeout> | null = null;
  /** Where this screen is looking. The host's view is sent to everyone, and theirs follow it. */
  view: View = HOME_VIEW;
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
  get canRedo(): boolean {
    return this.undone.length > 0;
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
  load(strokes: Stroke[] | undefined, view?: View | null): void {
    this.view = view ? cleanView(view) : HOME_VIEW;
    this.strokes.clear();
    for (const s of strokes || []) this.strokes.set(s.id, { ...s, points: [...s.points] });
    this.full = false;
    this.undone = [];
    this.tell({ kind: 'redraw' });
  }

  /** The call is over. */
  reset(): void {
    if (this.timer) this.timers.clearTimeout(this.timer);
    if (this.viewTimer) this.timers.clearTimeout(this.viewTimer);
    this.timer = null;
    this.viewTimer = null;
    this.drawing = null;
    this.unsent = [];
    this.strokes.clear();
    this.undone = [];
    this.full = false;
    this.view = HOME_VIEW;
    this.tell({ kind: 'redraw' });
  }

  /**
   * Moves or zooms this screen's view. With `share` (the host), everyone else's view follows:
   * the latest position is sent a few times a second while it is changing.
   */
  setView(view: View, { share = false }: { share?: boolean } = {}): void {
    const next = cleanView(view);
    if (next.x === this.view.x && next.y === this.view.y && next.zoom === this.view.zoom) return;
    this.view = next;
    this.tell({ kind: 'redraw' });
    if (!share || this.viewTimer) return;
    this.viewTimer = this.timers.setTimeout(() => {
      this.viewTimer = null;
      this.deps.send({ type: 'view', ...this.view });
    }, SEND_EVERY_MS);
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
        if (op.kind !== undefined && !KINDS.includes(op.kind)) return;
        const stroke: Stroke = {
          id: op.id,
          userId: Number(op.userId ?? fromUserId ?? 0),
          points: [...op.points],
          color: op.color,
          size: op.size,
          eraser: op.eraser === true,
        };
        if (op.kind && op.kind !== 'pen') stroke.kind = op.kind;
        if (op.kind === 'text') {
          const text = cleanText(op.text ?? '');
          if (!text) return;
          stroke.text = text;
        }
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
    if (op.type === 'view') {
      if (![op.x, op.y, op.zoom].every((n) => typeof n === 'number' && Number.isFinite(n))) return;
      this.view = cleanView({ x: op.x, y: op.y, zoom: op.zoom });
      this.tell({ kind: 'redraw' });
      return;
    }
    if (op.type === 'clear') {
      this.strokes.clear();
      this.drawing = null;
      this.unsent = [];
      this.undone = [];
      this.full = false;
      this.view = HOME_VIEW;
      this.tell({ kind: 'redraw' });
    }
  }

  private newStroke(pen: Pen, points: Point[]): Stroke {
    return {
      id: (this.deps.newId ?? (() => randomId(this.deps.myUserId)))(),
      userId: this.deps.myUserId,
      points,
      color: pen.color,
      size: pen.size,
      eraser: false,
    };
  }

  /** This person puts the pen, highlighter or eraser down. Any other tool draws nothing this way. */
  begin(pen: Pen, point: Point): void {
    this.end();
    if (pen.tool !== 'pen' && pen.tool !== 'highlighter' && pen.tool !== 'eraser') return;
    const stroke = this.newStroke(pen, [point]);
    if (pen.tool === 'eraser') {
      stroke.eraser = true;
      stroke.size = pen.size * ERASER_FACTOR;
    } else if (pen.tool === 'highlighter') {
      stroke.kind = 'highlighter';
      stroke.size = pen.size * HIGHLIGHT_FACTOR;
    }
    this.strokes.set(stroke.id, stroke);
    this.drawing = stroke;
    this.unsent = [point];
    this.announced = false;
    this.undone = [];
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

  /** A finished shape, from one corner to the other: shown at once and sent whole. */
  addShape(pen: Pen, kind: ShapeKind, from: Point, to: Point): Stroke {
    this.end();
    const stroke = this.newStroke(pen, [from, to]);
    stroke.kind = kind;
    return this.add(stroke);
  }

  /** Words put on the board at a point: shown at once and sent whole. Null when there are no words. */
  addText(pen: Pen, point: Point, text: string): Stroke | null {
    this.end();
    const words = cleanText(text);
    if (!words) return null;
    const stroke = this.newStroke(pen, [point]);
    stroke.kind = 'text';
    stroke.text = words;
    stroke.size = textSizeOf(pen.size);
    return this.add(stroke);
  }

  private add(stroke: Stroke): Stroke {
    this.strokes.set(stroke.id, stroke);
    this.undone = [];
    this.deps.send(describe(stroke, stroke.points));
    this.tell({ kind: 'segment', stroke, from: 0 });
    return stroke;
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
    else this.deps.send(describe(stroke, points));
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
    this.undone.push(mine);
    if (this.undone.length > MAX_REDO) this.undone.shift();
    this.full = false;
    this.deps.send({ type: 'undo', stroke_id: mine.id });
    this.tell({ kind: 'redraw' });
    return true;
  }

  /** Puts back the stroke undone last. False when there is none. */
  redoMine(): boolean {
    this.end();
    const stroke = this.undone.pop();
    if (!stroke) return false;
    this.strokes.set(stroke.id, stroke);
    this.deps.send(describe(stroke, stroke.points));
    this.tell({ kind: 'segment', stroke, from: 0 });
    return true;
  }

  /** Wipes the board for everyone (the server lets only the host). */
  clear(): void {
    this.drawing = null;
    this.unsent = [];
    this.strokes.clear();
    this.undone = [];
    this.full = false;
    this.view = HOME_VIEW;
    this.deps.send({ type: 'clear' });
    this.tell({ kind: 'redraw' });
  }
}
