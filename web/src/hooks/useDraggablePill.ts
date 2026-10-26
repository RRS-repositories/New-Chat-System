import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  clampToViewport,
  hasMoved,
  readPillPosition,
  rememberPillPosition,
  type Point,
  type Size,
} from '../utils/pillPosition.ts';

type Drag = { pointerId: number; start: Point; origin: Point; moved: boolean };

export type DraggablePill = {
  ref: (el: HTMLDivElement | null) => void;
  /** Inline position once the pill has been moved; undefined leaves it in its CSS corner. */
  style: CSSProperties | undefined;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
};

const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });

/**
 * Lets the minimised call pill be dragged anywhere in the window, with a mouse or a finger.
 * Its buttons still click: a press on a button is never a drag, and a press elsewhere becomes a
 * drag only once the pointer has travelled a few pixels. The pill stays fully inside the window,
 * also when the window is resized, and the spot is remembered for next time.
 */
export function useDraggablePill(): DraggablePill {
  const el = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [pos, setPos] = useState<Point | null>(() => readPillPosition());
  const posRef = useRef(pos);
  posRef.current = pos;

  const size = (): Size => {
    const r = el.current?.getBoundingClientRect();
    return { width: r?.width ?? 0, height: r?.height ?? 0 };
  };
  const place = useCallback((p: Point) => setPos(clampToViewport(p, size(), viewport())), []);

  // A spot remembered on a bigger screen, or a window made smaller, must not leave the pill off-screen.
  useEffect(() => {
    const fit = () => {
      if (posRef.current) place(posRef.current);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [place]);

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as Element).closest('button')) return; // the buttons click; the rest of the pill drags
    const node = el.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    drag.current = {
      pointerId: e.pointerId,
      start: { x: e.clientX, y: e.clientY },
      origin: { x: r.left, y: r.top },
      moved: false,
    };
    node.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      const now = { x: e.clientX, y: e.clientY };
      if (!d.moved && !hasMoved(d.start, now)) return;
      d.moved = true;
      e.preventDefault();
      place({ x: d.origin.x + now.x - d.start.x, y: d.origin.y + now.y - d.start.y });
    },
    [place],
  );

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.pointerId) return;
    drag.current = null;
    if (el.current?.hasPointerCapture(e.pointerId)) el.current.releasePointerCapture(e.pointerId);
    if (d.moved && posRef.current) rememberPillPosition(posRef.current);
  }, []);

  const ref = useCallback((node: HTMLDivElement | null) => {
    el.current = node;
  }, []);

  const style: CSSProperties | undefined = pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined;
  return { ref, style, onPointerDown, onPointerMove, onPointerUp };
}
