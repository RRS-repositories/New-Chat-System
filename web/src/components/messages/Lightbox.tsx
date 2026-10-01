import { useEffect } from 'react';
import { X } from 'lucide-react';
export function Lightbox({ src, alt, onClose }: { src: string | null; alt: string; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="lightbox" onClick={onClose} role="dialog" aria-label={alt}>
      <button className="icon-btn lightbox-close" aria-label="Close" onClick={onClose}>
        <X size={18} />
      </button>
      {src ? <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} /> : <p className="muted">Loading…</p>}
    </div>
  );
}
