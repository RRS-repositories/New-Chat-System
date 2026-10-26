/**
 * Where the minimised call pill sits. By default it is in the bottom-right corner (CSS); once a
 * person drags it somewhere else, that spot is kept here, as a distance from the top-left of the
 * window, and remembered in the browser so the pill comes back where they left it.
 */
import { STORAGE_KEYS } from '../config/constants.ts';

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** The pill never sits closer than this to the edge of the window. */
export const EDGE_MARGIN = 8;
/** A pointer that moves less than this is a click on the pill, not a drag of it. */
export const DRAG_THRESHOLD = 4;

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;
const browserStorage = (): Storage | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null; // storage unavailable (private mode)
  }
};

/** Keeps the whole pill inside the window. A pill wider than the window is pinned to the left/top margin. */
export function clampToViewport(point: Point, size: Size, viewport: Size, margin = EDGE_MARGIN): Point {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.round(Math.min(Math.max(point.x, margin), maxX)),
    y: Math.round(Math.min(Math.max(point.y, margin), maxY)),
  };
}

/** Whether the pointer has travelled far enough from where it went down to count as a drag. */
export function hasMoved(from: Point, to: Point, threshold = DRAG_THRESHOLD): boolean {
  return Math.abs(to.x - from.x) >= threshold || Math.abs(to.y - from.y) >= threshold;
}

/** The spot a person dragged the pill to, or null when it has never been moved (or storage is unavailable). */
export function readPillPosition(storage: Storage | null = browserStorage()): Point | null {
  try {
    const raw = storage?.getItem(STORAGE_KEYS.callPillPosition);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Point>;
    return Number.isFinite(parsed.x) && Number.isFinite(parsed.y) ? { x: parsed.x!, y: parsed.y! } : null;
  } catch {
    return null;
  }
}

export function rememberPillPosition(point: Point, storage: Storage | null = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEYS.callPillPosition, JSON.stringify({ x: point.x, y: point.y }));
  } catch {
    /* storage unavailable */
  }
}
