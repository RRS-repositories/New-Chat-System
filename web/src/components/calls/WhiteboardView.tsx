import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { Eraser, Trash2, Undo2, X } from 'lucide-react';
import {
  PEN_COLOURS,
  PEN_SIZES,
  type Pen,
  type Point,
  type Stroke,
  type Whiteboard,
} from '../../services/whiteboard.ts';

type Props = {
  board: Whiteboard;
  /** Only the host can wipe the board. */
  isHost: boolean;
  onClose: () => void;
};

/** A stroke's thickness is given for a board 1100 px wide and scales with the board, so it covers the same part of the drawing on every screen. */
const widthOf = (stroke: Stroke, boardWidth: number) => Math.max(1, (stroke.size * boardWidth) / 1100);

function drawSegment(ctx: CanvasRenderingContext2D, stroke: Stroke, from: number, w: number, h: number) {
  const points = stroke.points;
  if (!points.length) return;
  ctx.globalCompositeOperation = stroke.eraser ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.lineWidth = widthOf(stroke, w);
  ctx.beginPath();
  const start = Math.max(0, Math.min(from, points.length - 1));
  ctx.moveTo(points[start][0] * w, points[start][1] * h);
  if (points.length - start === 1) ctx.lineTo(points[start][0] * w + 0.4, points[start][1] * h + 0.4);
  for (let i = start + 1; i < points.length; i++) ctx.lineTo(points[i][0] * w, points[i][1] * h);
  ctx.stroke();
  ctx.globalCompositeOperation = 'source-over';
}

/** The whiteboard everyone in the call can draw on: five colours, three thicknesses, an eraser, undo, and (for the host) clear. */
export function WhiteboardView({ board, isHost, onClose }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0 });
  const [pen, setPen] = useState<Pen>({ color: PEN_COLOURS[1], size: PEN_SIZES[1], eraser: false });
  const penRef = useRef(pen);
  penRef.current = pen;
  const [, setTick] = useState(0);

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const redraw = () => {
      const { w, h } = size.current;
      ctx.clearRect(0, 0, w, h);
      for (const stroke of board.list()) drawSegment(ctx, stroke, 0, w, h);
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
        setTick((n) => n + 1); // the "board is full" line, and whether Undo has anything to take back
      } else drawSegment(ctx, change.stroke, change.from, size.current.w, size.current.h);
    });
    return () => {
      observer.disconnect();
      stop();
      board.end();
    };
  }, [board]);

  const pointOf = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    return [
      Math.min(1, Math.max(0, (e.clientX - box.left) / (box.width || 1))),
      Math.min(1, Math.max(0, (e.clientY - box.top) / (box.height || 1))),
    ];
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* drawing works without it */
    }
    board.begin(penRef.current, pointOf(e));
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (board.isDrawing) board.extend(pointOf(e));
  };
  const up = () => board.end();

  return (
    <div className="wb" data-testid="call-whiteboard">
      <div className="wb-top">
        <div className="wb-grp" role="group" aria-label="Pen colour">
          {PEN_COLOURS.map((colour) => (
            <button
              key={colour}
              className={`wb-sw${!pen.eraser && pen.color === colour ? ' sel' : ''}`}
              style={{ '--c': colour } as CSSProperties}
              aria-label={`Pen colour ${colour}`}
              aria-pressed={!pen.eraser && pen.color === colour}
              data-testid="wb-colour"
              onClick={() => setPen({ ...pen, color: colour, eraser: false })}
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
              onClick={() => setPen({ ...pen, size: s, eraser: false })}
            >
              <i style={{ width: s + 3, height: s + 3 }} />
            </button>
          ))}
        </div>
        <div className="wb-grp">
          <button
            className={`wb-tl${pen.eraser ? ' sel' : ''}`}
            title="Eraser"
            aria-label="Eraser"
            aria-pressed={pen.eraser}
            data-testid="wb-eraser"
            onClick={() => setPen({ ...pen, eraser: !pen.eraser })}
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
            title={isHost ? 'Clear the board for everyone' : 'Only the host can clear the board'}
            aria-label="Clear the board for everyone"
            data-testid="wb-clear"
            disabled={!isHost}
            onClick={() => board.clear()}
          >
            <Trash2 size={15} />
          </button>
        </div>
        {board.full && (
          <span className="wb-full" role="status">
            The board is full. Undo or clear to draw more.
          </span>
        )}
        <span className="sp" />
        <button className="wb-close" data-testid="wb-close" onClick={onClose}>
          <X size={13} />
          <span>Close board</span>
        </button>
      </div>
      <div className="wb-wrap" ref={wrap}>
        <canvas
          ref={canvas}
          aria-label="Whiteboard. Draw with the mouse or a finger."
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
