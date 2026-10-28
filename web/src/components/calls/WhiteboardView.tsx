import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  Minus,
  Pen as PenIcon,
  Plus,
  Redo2,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
  X,
} from 'lucide-react';
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
import {
  HIGHLIGHT_ALPHA,
  LINE_HEIGHT,
  TOOL_KEYS,
  arrowHead,
  boxOf,
  isFreehand,
  isShape,
  isTyping,
  textLines,
  textSizeOf,
  toolForKey,
  type ShapeKind,
  type Tool,
} from '../../utils/boardTools.ts';

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

const TOOLS: Array<{ tool: Tool; label: string; Icon: typeof PenIcon }> = [
  { tool: 'pen', label: 'Pen', Icon: PenIcon },
  { tool: 'highlighter', label: 'Highlighter', Icon: Highlighter },
  { tool: 'eraser', label: 'Eraser', Icon: Eraser },
  { tool: 'text', label: 'Text', Icon: Type },
  { tool: 'line', label: 'Line', Icon: Slash },
  { tool: 'arrow', label: 'Arrow', Icon: ArrowUpRight },
  { tool: 'rect', label: 'Rectangle', Icon: Square },
  { tool: 'ellipse', label: 'Ellipse', Icon: Circle },
];

/** A stroke's thickness (or a text's font size) is given for a board 1100 px wide and scales with the board and the zoom, so it covers the same part of the drawing on every screen. */
const widthOf = (stroke: Stroke, size: Size, view: View) => Math.max(1, ((stroke.size * size.w) / 1100) * view.zoom);
const toScreen = (p: Point, size: Size, view: View): [number, number] => [
  (p[0] - view.x) * view.zoom * size.w,
  (p[1] - view.y) * view.zoom * size.h,
];

/**
 * Puts a stroke on the canvas: a freehand stroke from its point `from` on (the rest is already
 * there), or a whole shape or text. `font` is the page's font family, for text.
 */
export function drawStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  from: number,
  size: Size,
  view: View,
  font = 'sans-serif',
) {
  const points = stroke.points;
  if (!points.length) return;
  const kind = stroke.kind ?? 'pen';
  const width = widthOf(stroke, size, view);
  const at = (i: number) => toScreen(points[i], size, view);
  ctx.save();
  ctx.globalCompositeOperation = stroke.eraser
    ? 'destination-out'
    : kind === 'highlighter'
      ? 'multiply'
      : 'source-over';
  if (kind === 'highlighter') {
    ctx.globalAlpha = HIGHLIGHT_ALPHA;
    ctx.lineCap = 'butt';
  }
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = width;
  if (kind === 'pen' || kind === 'highlighter') {
    ctx.beginPath();
    const start = Math.max(0, Math.min(from, points.length - 1));
    const [x0, y0] = at(start);
    ctx.moveTo(x0, y0);
    if (points.length - start === 1) ctx.lineTo(x0 + 0.4, y0 + 0.4);
    for (let i = start + 1; i < points.length; i++) {
      const [x, y] = at(i);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (kind === 'text') {
    ctx.font = `600 ${width}px ${font}`;
    ctx.textBaseline = 'top';
    const [x, y] = at(0);
    textLines(stroke.text ?? '').forEach((line, i) => ctx.fillText(line, x, y + i * width * LINE_HEIGHT));
  } else {
    const a = at(0);
    const b = at(points.length - 1);
    ctx.beginPath();
    if (kind === 'line' || kind === 'arrow') {
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      if (kind === 'arrow') {
        const [w1, w2] = arrowHead(a, b, Math.max(10, width * 3.5));
        ctx.beginPath();
        ctx.moveTo(w1[0], w1[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(w2[0], w2[1]);
        ctx.stroke();
      }
    } else {
      const r = boxOf(a, b);
      if (kind === 'rect') ctx.strokeRect(r.x, r.y, r.w, r.h);
      else {
        ctx.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

/** The view zoomed to `zoom`, keeping the point of the board under (sx, sy) on the screen where it is. */
export function zoomAt(view: View, zoom: number, sx: number, sy: number, size: Size): View {
  const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom));
  const bx = view.x + sx / (size.w * view.zoom);
  const by = view.y + sy / (size.h * view.zoom);
  return { zoom: next, x: bx - sx / (size.w * next), y: by - sy / (size.h * next) };
}

/** A shape being dragged out, before it is let go. */
type Dragging = { kind: ShapeKind; from: Point; to: Point; start: [number, number]; moved: boolean };

/**
 * The call's whiteboard. The host draws: a pen, a highlighter and an eraser, text, and four shapes
 * (line, arrow, rectangle, ellipse), in eight colours and three thicknesses, with undo, redo and
 * clear; each tool has a key (P, H, E, T, L, A, R, O; V for the hand). The board is bigger than
 * the screen: hold Ctrl and drag (or use the hand) to move it, Ctrl and scroll (or the + and −
 * buttons) to zoom. Everyone else watches, and their view follows the host's.
 */
export function WhiteboardView({ board, isHost, hostName, onClose }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  /** Over the drawing: the shape being dragged out, until it is let go. */
  const overlay = useRef<HTMLCanvasElement>(null);
  const size = useRef<Size>({ w: 0, h: 0 });
  const font = useRef('sans-serif');
  const [pen, setPen] = useState<Pen>({ color: PEN_COLOURS[1], size: PEN_SIZES[1], tool: 'pen' });
  const penRef = useRef(pen);
  penRef.current = pen;
  const isHostRef = useRef(isHost);
  isHostRef.current = isHost;
  /** A drag that moves the board: where the pointer was last. */
  const drag = useRef<{ x: number; y: number } | null>(null);
  const shape = useRef<Dragging | null>(null);
  /** The text box being typed into: where on the board it was placed. */
  const [editor, setEditor] = useState<{ point: Point } | null>(null);
  const editing = useRef<{ point: Point } | null>(null);
  const editorEl = useRef<HTMLDivElement>(null);
  const [ctrlDown, setCtrlDown] = useState(false);
  const [, setTick] = useState(0);

  const moveView = (view: View) => board.setView(view, { share: isHostRef.current });

  useEffect(() => {
    const el = wrap.current;
    const cv = canvas.current;
    const ov = overlay.current;
    if (!el || !cv || !ov) return;
    const ctx = cv.getContext('2d');
    const octx = ov.getContext('2d');
    if (!ctx || !octx) return;
    font.current = getComputedStyle(el).fontFamily || font.current;

    const redraw = () => {
      const { w, h } = size.current;
      const view = board.view;
      ctx.clearRect(0, 0, w, h);
      for (const stroke of board.list()) drawStroke(ctx, stroke, 0, size.current, view, font.current);
      // The dotted paper moves and grows with the board.
      el.style.backgroundSize = `${GRID * view.zoom}px ${GRID * view.zoom}px`;
      el.style.backgroundPosition = `${-view.x * w * view.zoom}px ${-view.y * h * view.zoom}px`;
    };
    let frame = 0;
    const redrawSoon = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        redraw();
      });
    };
    const fitOne = (c: HTMLCanvasElement, cx: CanvasRenderingContext2D, w: number, h: number, dpr: number) => {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      c.style.width = `${w}px`;
      c.style.height = `${h}px`;
      cx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx.lineCap = 'round';
      cx.lineJoin = 'round';
    };
    const fit = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (!w || !h) return;
      size.current = { w, h };
      fitOne(cv, ctx, w, h, dpr);
      fitOne(ov, octx, w, h, dpr);
      redraw();
      setTick((n) => n + 1); // the text box, if open, is placed from the size
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    const stop = board.subscribe((change) => {
      if (change.kind === 'redraw') {
        redraw();
        setTick((n) => n + 1); // the zoom figure, the "board is full" line, the redo button
      } else if (change.stroke.kind === 'highlighter') {
        // See-through ink: drawn in pieces, the pieces would show where they overlap.
        redrawSoon();
      } else {
        drawStroke(ctx, change.stroke, change.from, size.current, board.view, font.current);
        if (change.from === 0) setTick((n) => n + 1);
      }
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
      if (frame) cancelAnimationFrame(frame);
      el.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', key);
      window.removeEventListener('blur', blur);
      board.end();
    };
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps

  // The host's keys: a letter picks a tool, Ctrl+Z takes back, Ctrl+Y (or Ctrl+Shift+Z) puts back. Not while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isHostRef.current || isTyping(e.target) || e.altKey) return;
      if (e.ctrlKey || e.metaKey) {
        const k = (e.key || '').toLowerCase();
        if (k === 'z') {
          e.preventDefault();
          if (e.shiftKey) board.redoMine();
          else board.undoMine();
        } else if (k === 'y') {
          e.preventDefault();
          board.redoMine();
        }
        return;
      }
      if (e.shiftKey) return;
      const tool = toolForKey(e.key);
      if (!tool) return;
      e.preventDefault();
      pick(tool);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [board]); // eslint-disable-line react-hooks/exhaustive-deps

  // The text box takes the keyboard as soon as it is placed.
  useEffect(() => {
    if (editor) editorEl.current?.focus();
  }, [editor]);

  const pick = (tool: Tool) => {
    if (editing.current) commitText();
    setPen((p) => ({ ...p, tool }));
  };
  /** A colour or thickness chosen while rubbing out or moving goes back to the pen. */
  const drawingTool = (tool: Tool): Tool => (tool === 'eraser' || tool === 'move' ? 'pen' : tool);

  const pointOf = (e: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    const view = board.view;
    return [
      view.x + (e.clientX - box.left) / ((box.width || 1) * view.zoom),
      view.y + (e.clientY - box.top) / ((box.height || 1) * view.zoom),
    ];
  };
  const preview = (d: Dragging | null) => {
    const ov = overlay.current;
    const octx = ov?.getContext('2d');
    if (!ov || !octx) return;
    octx.clearRect(0, 0, size.current.w, size.current.h);
    if (!d) return;
    const p = penRef.current;
    const ghost: Stroke = {
      id: 'preview',
      userId: 0,
      points: [d.from, d.to],
      color: p.color,
      size: p.size,
      eraser: false,
    };
    ghost.kind = d.kind;
    drawStroke(octx, ghost, 0, size.current, board.view, font.current);
  };
  const openText = (point: Point) => {
    editing.current = { point };
    setEditor({ point });
  };
  /** The words typed so far go on the board; an empty box just goes away. */
  const commitText = () => {
    const was = editing.current;
    const el = editorEl.current;
    editing.current = null;
    setEditor(null);
    if (was && el) board.addText(penRef.current, was.point, el.innerText ?? el.textContent ?? '');
  };
  const cancelText = () => {
    editing.current = null;
    setEditor(null);
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const middle = e.pointerType === 'mouse' && e.button === 1;
    if (e.pointerType === 'mouse' && e.button !== 0 && !middle) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* it works without it */
    }
    const tool = penRef.current.tool;
    // Moving the board: Ctrl held, the hand chosen, the middle button, or anyone who is only watching.
    if (!isHost || tool === 'move' || e.ctrlKey || e.metaKey || middle) {
      e.preventDefault();
      drag.current = { x: e.clientX, y: e.clientY };
      return;
    }
    const p = pointOf(e);
    if (isFreehand(tool)) board.begin(penRef.current, p);
    else if (isShape(tool)) shape.current = { kind: tool, from: p, to: p, start: [e.clientX, e.clientY], moved: false };
    else if (tool === 'text') {
      e.preventDefault(); // or the press itself would take the keyboard off the box it opens
      // A press while typing only places the words; the next press opens a new box.
      if (editing.current) commitText();
      else openText(p);
    }
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
    const d = shape.current;
    if (d) {
      d.to = pointOf(e);
      d.moved = d.moved || Math.abs(e.clientX - d.start[0]) + Math.abs(e.clientY - d.start[1]) > 3;
      preview(d);
      return;
    }
    if (board.isDrawing) board.extend(pointOf(e));
  };
  const up = () => {
    drag.current = null;
    const d = shape.current;
    if (d) {
      shape.current = null;
      preview(null);
      if (d.moved) board.addShape(penRef.current, d.kind, d.from, d.to);
    }
    board.end();
  };
  const zoomBy = (factor: number) =>
    moveView(zoomAt(board.view, board.view.zoom * factor, size.current.w / 2, size.current.h / 2, size.current));

  const hand = !isHost || pen.tool === 'move' || ctrlDown;
  const inking = pen.tool !== 'eraser' && pen.tool !== 'move';
  const editorAt = editor ? toScreen(editor.point, size.current, board.view) : null;
  const editorPx = (textSizeOf(pen.size) * size.current.w * board.view.zoom) / 1100;
  return (
    <div className="wb" data-testid="call-whiteboard">
      <div className="wb-top">
        {isHost ? (
          <>
            <div className="wb-grp" role="group" aria-label="Tools">
              {TOOLS.map(({ tool, label, Icon }) => (
                <button
                  key={tool}
                  className={`wb-tl${pen.tool === tool ? ' sel' : ''}`}
                  title={`${label} (${TOOL_KEYS[tool]})`}
                  aria-label={label}
                  aria-pressed={pen.tool === tool}
                  data-testid={`wb-tool-${tool}`}
                  onClick={() => pick(tool)}
                >
                  <Icon size={15} />
                </button>
              ))}
            </div>
            <div className="wb-grp" role="group" aria-label="Colour">
              {PEN_COLOURS.map((colour) => (
                <button
                  key={colour}
                  className={`wb-sw${inking && pen.color === colour ? ' sel' : ''}`}
                  style={{ '--c': colour } as CSSProperties}
                  aria-label={`Colour ${colour}`}
                  aria-pressed={inking && pen.color === colour}
                  data-testid="wb-colour"
                  onClick={() => setPen({ ...pen, color: colour, tool: drawingTool(pen.tool) })}
                />
              ))}
            </div>
            <div className="wb-grp" role="group" aria-label="Thickness">
              {PEN_SIZES.map((s) => (
                <button
                  key={s}
                  className={`wb-sz${pen.tool !== 'move' && pen.size === s ? ' sel' : ''}`}
                  aria-label={`Thickness ${s}`}
                  aria-pressed={pen.tool !== 'move' && pen.size === s}
                  data-testid="wb-size"
                  onClick={() => setPen({ ...pen, size: s, tool: pen.tool === 'move' ? 'pen' : pen.tool })}
                >
                  <i style={{ width: s + 3, height: s + 3 }} />
                </button>
              ))}
            </div>
            <div className="wb-grp">
              <button
                className="wb-tl"
                title="Undo your last stroke (Ctrl+Z)"
                aria-label="Undo your last stroke"
                data-testid="wb-undo"
                onClick={() => {
                  if (editing.current) commitText();
                  board.undoMine();
                }}
              >
                <Undo2 size={15} />
              </button>
              <button
                className="wb-tl"
                title="Put back what you undid (Ctrl+Y)"
                aria-label="Put back what you undid"
                data-testid="wb-redo"
                disabled={!board.canRedo}
                onClick={() => board.redoMine()}
              >
                <Redo2 size={15} />
              </button>
              <button
                className="wb-tl"
                title="Clear the board for everyone"
                aria-label="Clear the board for everyone"
                data-testid="wb-clear"
                onClick={() => {
                  cancelText();
                  board.clear();
                }}
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
              className={`wb-tl${pen.tool === 'move' ? ' sel' : ''}`}
              title="Move the board (V, or hold Ctrl and drag)"
              aria-label="Move the board"
              aria-pressed={pen.tool === 'move'}
              data-testid="wb-move"
              onClick={() => pick(pen.tool === 'move' ? 'pen' : 'move')}
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
        {isHost && (
          <span className="wb-tip">
            {pen.tool === 'text'
              ? 'Click to place text · Enter to keep it · Shift + Enter for a new line'
              : 'Ctrl + drag to move · Ctrl + scroll to zoom · a letter picks a tool'}
          </span>
        )}
        <button className="wb-close" data-testid="wb-close" onClick={onClose}>
          <X size={13} />
          <span>Close board</span>
        </button>
      </div>
      <div className={`wb-wrap${hand ? ' hand' : pen.tool === 'text' && isHost ? ' text' : ''}`} ref={wrap}>
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
        <canvas ref={overlay} className="wb-overlay" aria-hidden="true" />
        {editor && editorAt && (
          <div
            ref={editorEl}
            className="wb-text"
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline="true"
            aria-label="Text for the board. Enter keeps it, Shift and Enter starts a new line, Escape cancels."
            data-testid="wb-text-editor"
            style={{ left: editorAt[0], top: editorAt[1], fontSize: editorPx, color: pen.color }}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                commitText();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelText();
              }
            }}
            onBlur={() => {
              if (editing.current) commitText();
            }}
            onPointerDown={(e) => e.stopPropagation()}
          />
        )}
      </div>
    </div>
  );
}
