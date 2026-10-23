import { useEffect, useState, type CSSProperties, type SyntheticEvent } from 'react';
import { X } from 'lucide-react';
import { viewerWidth } from '../../utils/viewer.ts';

export function Lightbox({
  src,
  alt,
  failed = false,
  onClose,
}: {
  src: string | null;
  alt: string;
  /** The full-size picture could not be fetched. */
  failed?: boolean;
  onClose: () => void;
}) {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  const sized = (e: SyntheticEvent<HTMLImageElement>) =>
    setWidth(viewerWidth(e.currentTarget.naturalWidth, window.innerWidth));
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={alt}>
      <button className="icon-btn lightbox-close" aria-label="Close" onClick={onClose}>
        <X size={18} />
      </button>
      {src ? (
        <img
          src={src}
          alt={alt}
          onLoad={sized}
          style={width ? ({ width: `${width}px` } as CSSProperties) : undefined}
          data-testid="lightbox-image"
          onClick={(e) => e.stopPropagation()}
        />
      ) : failed ? (
        <p className="muted" data-testid="lightbox-failed">
          The picture could not be loaded. Close this and try again, or download it.
        </p>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </div>
  );
}
