import { X } from 'lucide-react';
import type { Message } from '../api/types.ts';
export function ReplyingToBar({ target, onCancel }: { target: Message; onCancel: () => void }) {
  return (
    <div className="replying-bar">
      <span className="muted">Replying to <strong>{target.userName}</strong>: {target.content.slice(0, 60)}{target.content.length > 60 ? '…' : ''}</span>
      <button className="icon-btn" aria-label="Cancel reply" onClick={onCancel}><X size={14} /></button>
    </div>
  );
}
