import { Pin, X } from 'lucide-react';
import type { Message } from '../../types/index.ts';
import { formatTime } from '../../utils/format.ts';
export function PinnedList({ pins, canModerate, onJump, onUnpin, onClose }: { pins: Message[]; canModerate: boolean; onJump: (id: string) => void; onUnpin: (id: string) => void; onClose: () => void }) {
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal" role="dialog" aria-label="Pinned messages" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2><Pin size={14} /> Pinned messages</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        {!pins.length && <p className="muted">No pinned messages</p>}
        {pins.length > 0 && (
          <div className="pick-list">
            {pins.map((m) => (
              <div key={m.id} className="pick-row pin-row">
                <button className="pin-body" onClick={() => { onJump(m.id); onClose(); }}>
                  <div className="msg-meta"><span className="msg-author">{m.userName}</span><span className="muted">{formatTime(m.createdAt)}</span></div>
                  <div className="pin-text">{m.content.slice(0, 200)}{m.content.length > 200 ? '…' : ''}{m.files.length ? ` 📎 ${m.files.length}` : ''}</div>
                </button>
                {canModerate && <button className="link" onClick={() => onUnpin(m.id)}>Unpin</button>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
