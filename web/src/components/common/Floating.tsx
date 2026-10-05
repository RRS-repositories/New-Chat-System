import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  /** The button the box belongs to; the box is placed beside it. */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Where to try first. The box flips to the other side when there is no room. */
  prefer?: 'above' | 'below';
  role?: string;
  label?: string;
};

const GAP = 8;
const EDGE = 8;

/**
 * A small box (menu, emoji picker) that floats beside a button. It is drawn at the top level of the
 * page, so a scrolling list cannot cut it off and it sits above the call screen. It closes on a
 * click elsewhere, on Escape, and when the page behind it scrolls or resizes.
 */
export function Floating({ anchor, onClose, children, className = '', prefer = 'below', role, label }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    const from = anchor.current;
    if (!el || !from) return;
    const a = from.getBoundingClientRect();
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    const left = Math.max(EDGE, Math.min(a.right - width, window.innerWidth - width - EDGE));
    const above = a.top - height - GAP;
    const below = a.bottom + GAP;
    const fitsAbove = above >= EDGE;
    const fitsBelow = below + height <= window.innerHeight - EDGE;
    const top =
      prefer === 'above' ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
    setAt({ left, top: Math.max(EDGE, top) });
  }, [anchor, prefer]);

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const target = e.target as Node;
      if (box.current?.contains(target) || anchor.current?.contains(target)) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
      anchor.current?.focus();
    };
    const moved = (e: Event) => {
      if (e.type === 'scroll' && box.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    window.addEventListener('resize', moved);
    document.addEventListener('scroll', moved, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', moved);
      document.removeEventListener('scroll', moved, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div
      ref={box}
      className={`floating ${className}`}
      role={role}
      aria-label={label}
      style={{ left: at?.left ?? 0, top: at?.top ?? 0, visibility: at ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  );
}
