import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Eraser, Hand, Minus, Plus, Trash2, Undo2, X } from 'lucide-react';
import {
  HOME_VIEW,
  PEN_COLOURS,
  PEN_SIZES,
  ZOOM_MAX,
  ZOOM_MIN,
  type Pen,
  type Point,
  type Stroke,
  type View,
  type Whiteboard,
} from '../../services/whiteboard.ts';

type Props = {
  board: Whiteboard;
  /** Only the host draws. Everyone else sees the board, and their view follows the host's. */
  isHost: boolean;
  hostName: string;
  onClose: () => void;
};

const GRID = 22;
const ZOOM_STEP = 1.25;
type Size = { w: number; h: number };

/** A stroke's thickness is given for a board 1100 px wide and scales with the board and the zoom, so it covers the same part of the drawing on every screen. */
const widthOf = (stroke: Stroke, size: Size, view: View) => Math.max(1, ((stroke.size * size.w) / 1100) * view.zoom);
const toScreen = (p: Point, size: Size, view: View): [number, number] => [
  (p[0] - view.x) * view.zoom * size.w,
  (p[1] - view.y) * view.zoom * size.h,
];

function drawSegment(ctx: CanvasRenderingContext2D, stroke: Stroke, from: number, size: Size, view: View) {
  const points = stroke.points;
  if (!points.length) return;
  ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = widthOf(stroke, size, view);
  ctx.beginPath();
  const start = Math.max(0, Math.min(from, points.length - 1));
  const [x0, y0] = toScreen(points[start], size, view);
  ctx.moveTo(x0, y0);
  if (points.length - start === 1) ctx.lineTo(x0 + 0.4, y0 + 0.4);
  for (let i = start + 1; i < points.length; i++) {
    const [x, y] = toScreen(points[i], size, view);
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

/** The view zoomed to `zoom`, keeping the point of the board under (sx, sy) on the screen where it is. */
export function zoomAt(view: View, zoom: number, sx: number, sy: number, size: Size): View {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const bx = view.x + sx / (size.w * view.zoom);
  const by = view.y + sy / (size.h * view.zoom);
  return { zoom: next, x: bx - sx / (size.w * next), y: by - sy / (size.h * next) };
}

/**
 * The call's whiteboard. The host draws: five colours, three thicknesses, an eraser, undo and clear.
 * The board is bigger than the screen: hold Ctrl and drag (or use the hand) to move it, Ctrl and
 * scroll (or the + and − buttons) to zoom. Everyone else watches, and their view follows the host's.
 */
export function WhiteboardView({ board, isHost, hostName, onClose }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef<Size>({ w: 0, h: 0 });
  const [pen, setPen] = useState<Pen>({ color: PEN_COLOURS[1], size: PEN_SIZES[1], eraser: false });
  const penRef = useRef(pen);
  penRef.current = pen;
  const [moving, setMoving] = useState(false);
  const movingRef = useRef(moving);
  movingRef.current = moving;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  /** A drag that moves the board: where the pointer was last. */
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [ctrlDown, setCtrlDown] = useState(false);
  const [, setTick] = useState(0);

  const moveView = (view: View) => board.setView(view, { share: isHostRef.current });

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const redraw = () => {
      const { w, h } = size.current;
      const view = board.view;
      ctx.clearRect(0, 0, w, h);
      for (const stroke of board.list()) drawSegment(ctx, stroke, 0, size.current, view);
      // The dotted paper moves and grows with the board.
      el.style.backgroundSize = `${GRID * view.zoom}px ${GRID * view.zoom}px`;
      el.style.backgroundPosition = `${-view.x * w * view.zoom}px ${-view.y * h * view.zoom}px`;
    };
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      size.current = { w, h };
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = `${w}px`;
      cv.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      redraw();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    const stop = board.subscribe((change) => {
      if (change.kind === 'redraw') {
        redraw();
        setTick((n) => n + 1); // the zoom figure, and the "board is full" line
      } else drawSegment(ctx, change.stroke, change.from, size.current, board.view);
    });

    // Ctrl + scroll zooms where the pointer is; a plain scroll moves the board (down for more room).
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { w, h } = size.current;
      if (!w || !h) return;
      const view = board.view;
      if (e.ctrlKey || e.metaKey) {
        const box = cv.getBoundingClientRect();
        const factor = Math.exp(-e.deltaY * 0.0022);
        moveView(zoomAt(view, view.zoom * factor, e.clientX - box.left, e.clientY - box.top, size.current));
      } else {
        const dx = e.shiftKey ? e.deltaY : e.deltaX;
        const dy = e.shiftKey ? 0 : e.deltaY;
        moveView({ ...view, x: view.x + dx / (w * view.zoom), y: view.y + dy / (h * view.zoom) });
      }
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const key = (e: KeyboardEvent) => setCtrlDown(e.ctrlKey || e.metaKey);
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', key);
    const blur = () => setCtrlDown(false);
    window.addEventListener('blur', blur);
    return () => {
      observer.disconnect();
      stop();
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', blur);
      board.end();
    };
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps

  const pointOf = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    const view = board.view;
    return [
      view.x + (e.clientX - box.left) / ((box.width || 1) * view.zoom),
      view.y + (e.clientY - box.top) / ((box.height || 1) * view.zoom),
    ];
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const middle = e.pointerType === 'mouse' && e.button === 1;
    if (e.pointerType === 'mouse' && e.button !== 0 && !middle) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* it works without it */
    }
    // Moving the board: Ctrl held, the hand chosen, the middle button, or anyone who is only watching.
    if (!isHost || movingRef.current || e.ctrlKey || e.metaKey || middle) {
      e.preventDefault();
      drag.current = { x: e.clientX, y: e.clientY };
      return;
    }
    board.begin(penRef.current, pointOf(e));
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const from = drag.current;
    if (from) {
      const { w, h } = size.current;
      const view = board.view;
      drag.current = { x: e.clientX, y: e.clientY };
      if (w && h)
        moveView({
          ...view,
          x: view.x - (e.clientX - from.x) / (w * view.zoom),
          y: view.y - (e.clientY - from.y) / (h * view.zoom),
        });
      return;
    }
    if (board.isDrawing) board.extend(pointOf(e));
  };
  const up = () => {
    drag.current = null;
    board.end();
  };
  const zoomBy = (factor: number) =>
    moveView(zoomAt(board.view, board.view.zoom * factor, size.current.w / 2, size.current.h / 2, size.current));

  const hand = !isHost || moving || ctrlDown;
  return (
    <div className="wb" data-testid="call-whiteboard">
      <div className="wb-top">
        {isHost ? (
          <>
            <div className="wb-grp" role="group" aria-label="Pen colour">
              {PEN_COLOURS.map((colour) => (
                <button
                  key={colour}
                  className={`wb-sw${!pen.eraser && !moving && pen.color === colour ? ' sel' : ''}`}
                  style={{ '--c': colour } as CSSProperties}
                  aria-label={`Pen colour ${colour}`}
                  aria-pressed={!pen.eraser && pen.color === colour}
                  data-testid="wb-colour"
                  onClick={() => {
                    setPen({ ...pen, color: colour, eraser: false });
                    setMoving(false);
                  }}
                />
              ))}
            </div>
            <div className="wb-grp" role="group" aria-label="Pen size">
              {PEN_SIZES.map((s) => (
                <button
                  key={s}
                  className={`wb-sz${!pen.eraser && pen.size === s ? ' sel' : ''}`}
                  aria-label={`Pen size ${s}`}
                  aria-pressed={!pen.eraser && pen.size === s}
                  data-testid="wb-size"
                  onClick={() => {
                    setPen({ ...pen, size: s, eraser: false });
                    setMoving(false);
                  }}
                >
                  <i style={{ width: s + 3, height: s + 3 }} />
                </button>
              ))}
            </div>
            <div className="wb-grp">
              <button
                className={`wb-tl${pen.eraser && !moving ? ' sel' : ''}`}
                title="Eraser"
                aria-label="Eraser"
                aria-pressed={pen.eraser}
                data-testid="wb-eraser"
                onClick={() => {
                  setPen({ ...pen, eraser: !pen.eraser });
                  setMoving(false);
                }}
              >
                <Eraser size={15} />
              </button>
              <button
                className="wb-tl"
                title="Undo your last stroke"
                aria-label="Undo your last stroke"
                data-testid="wb-undo"
                onClick={() => board.undoMine()}
              >
                <Undo2 size={15} />
              </button>
              <button
                className="wb-tl"
                title="Clear the board for everyone"
                aria-label="Clear the board for everyone"
                data-testid="wb-clear"
                onClick={() => board.clear()}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </>
        ) : (
          <span className="wb-note" data-testid="wb-view-only">
            Only the host can draw. You see what {hostName.split(' ')[0] || 'the host'} draws, and your view follows
            theirs.
          </span>
        )}
        <div className="wb-grp" role="group" aria-label="Move and zoom">
          {isHost && (
            <button
              className={`wb-tl${moving ? ' sel' : ''}`}
              title="Move the board (or hold Ctrl and drag)"
              aria-label="Move the board"
              aria-pressed={moving}
              data-testid="wb-move"
              onClick={() => setMoving(!moving)}
            >
              <Hand size={15} />
            </button>
          )}
          <button
            className="wb-tl"
            title="Zoom out (or Ctrl and scroll)"
            aria-label="Zoom out"
            data-testid="wb-zoom-out"
            disabled={board.view.zoom <= ZOOM_MIN}
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            <Minus size={15} />
          </button>
          <button
            className="wb-zoom"
            title="Back to the start, at normal size"
            aria-label="Back to the start, at normal size"
            data-testid="wb-zoom-level"
            onClick={() => moveView(HOME_VIEW)}
          >
            {Math.round(board.view.zoom * 100)}%
          </button>
          <button
            className="wb-tl"
            title="Zoom in (or Ctrl and scroll)"
            aria-label="Zoom in"
            data-testid="wb-zoom-in"
            disabled={board.view.zoom >= ZOOM_MAX}
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            <Plus size={15} />
          </button>
        </div>
        {board.full && (
          <span className="wb-full" role="status">
            The board is full. Undo or clear to draw more.
          </span>
        )}
        <span className="sp" />
        {isHost && <span className="wb-tip">Ctrl + drag to move · scroll for more room · Ctrl + scroll to zoom</span>}
        <button className="wb-close" data-testid="wb-close" onClick={onClose}>
          <X size={13} />
          <span>Close board</span>
        </button>
      </div>
      <div className={`wb-wrap${hand ? ' hand' : ''}`} ref={wrap}>
        <canvas
          ref={canvas}
          aria-label={
            isHost ? 'Whiteboard. Draw with the mouse or a finger.' : 'Whiteboard. Only the host can draw on it.'
          }
          data-testid="wb-canvas"
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
        />
      </div>
    </div>
  );
}
