import { useCallback, useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { Download, Minus, Plus, X } from 'lucide-react';
import { openingScale, percent, toggledScale, zoomed, type Size } from '../../utils/viewer.ts';

/** Room around the picture when it opens: the page padding and the toolbar. */
const PADDING = 16;
const TOOLBAR = 56;
const space = (): Size => ({
  width: Math.max(1, window.innerWidth - PADDING * 2),
  height: Math.max(1, window.innerHeight - PADDING * 2 - TOOLBAR),
});

/**
 * The picture viewer. The picture opens whole on the screen (never cut off, never zoomed past
 * twice its size), then zooms with the + and − buttons, the mouse wheel, the + and − keys, or a
 * double-click (actual size and back). Zoomed in, it scrolls. Download saves the file.
 */
export function Lightbox({
  src,
  alt,
  filename = alt,
  failed = false,
  onClose,
}: {
  src: string | null;
  alt: string;
  /** The name the file is saved under. */
  filename?: string;
  /** The full-size picture could not be fetched. */
  failed?: boolean;
  onClose: () => void;
}) {
  const [natural, setNatural] = useState<Size | null>(null);
  const [scale, setScale] = useState(1);
  const [opening, setOpening] = useState(1);
  const box = useRef<HTMLDivElement | null>(null);

  const sized = (e: SyntheticEvent<HTMLImageElement>) => {
    const n = { width: e.currentTarget.naturalWidth, height: e.currentTarget.naturalHeight };
    const s = openingScale(n, space());
    setNatural(n);
    setOpening(s);
    setScale(s);
  };
  const zoom = useCallback((direction: 1 | -1) => setScale((s) => zoomed(s, direction)), []);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === '+' || e.key === '=') zoom(1);
      else if (e.key === '-' || e.key === '_') zoom(-1);
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose, zoom]);

  // The wheel zooms. A native listener, because React's is passive and could not stop the page scrolling.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.deltaY) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, src]);

  const width = natural ? Math.round(natural.width * scale) : undefined;
  return (
    <div className="lightbox" ref={box} role="dialog" aria-label={alt}>
      <div className="lightbox-bar" onClick={(e) => e.stopPropagation()}>
        {natural && (
          <>
            <button className="icon-btn" aria-label="Zoom out" title="Zoom out (−)" onClick={() => zoom(-1)}>
              <Minus size={18} />
            </button>
            <button
              className="lightbox-zoom"
              aria-label="Zoom level; press to reset"
              title="Back to the opening size"
              data-testid="lightbox-zoom"
              onClick={() => setScale(opening)}
            >
              {percent(scale)}
            </button>
            <button className="icon-btn" aria-label="Zoom in" title="Zoom in (+)" onClick={() => zoom(1)}>
              <Plus size={18} />
            </button>
          </>
        )}
        {src && (
          <a
            className="icon-btn"
            href={src}
            download={filename}
            aria-label={`Download ${filename}`}
            title="Download"
            data-testid="lightbox-download"
          >
            <Download size={18} />
          </a>
        )}
        <button className="icon-btn" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <div className="lightbox-stage" onClick={onClose}>
        {src ? (
          <img
            src={src}
            alt={alt}
            onLoad={sized}
            style={width ? { width: `${width}px` } : undefined}
            data-testid="lightbox-image"
            data-scale={scale}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={() => setScale((s) => toggledScale(s, opening))}
          />
        ) : failed ? (
          <p className="muted" data-testid="lightbox-failed">
            The picture could not be loaded. Close this and try again, or download it.
          </p>
        ) : (
          <p className="muted">Loading…</p>
        )}
      </div>
    </div>
  );
}
