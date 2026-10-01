import { useState } from 'react';
import { Reply, MessageSquare, Pin, PinOff, SmilePlus, Pencil, Trash2 } from 'lucide-react';
import type { Message } from '../../types/index.ts';
import { EmojiPicker } from './EmojiPicker.tsx';
type Props = { m: Message; own: boolean; canModerate: boolean; inThread?: boolean; onReply: () => void; onThread: () => void; onPin: () => void; onReact: (emoji: string) => void; onEdit: () => void; onDelete: () => void };
export function MessageActions({ m, own, canModerate, inThread, onReply, onThread, onPin, onReact, onEdit, onDelete }: Props) {
  const [pick, setPick] = useState(false);
  return (
    <div className="msg-actions" role="toolbar" aria-label="Message actions">
      <button className="icon-btn" aria-label="Reply" title="Reply" onClick={onReply}><Reply size={14} /></button>
      {!inThread && !m.threadId && <button className="icon-btn" aria-label="Thread" title="Thread" onClick={onThread}><MessageSquare size={14} /></button>}
      <span className="picker-anchor">
        <button className="icon-btn" aria-label="React" title="React" onClick={() => setPick(true)}><SmilePlus size={14} /></button>
        {pick && <EmojiPicker onPick={onReact} onClose={() => setPick(false)} />}
      </span>
      {canModerate && <button className="icon-btn" aria-label={m.pinned ? 'Unpin' : 'Pin'} title={m.pinned ? 'Unpin' : 'Pin'} onClick={onPin}>{m.pinned ? <PinOff size={14} /> : <Pin size={14} />}</button>}
      {own && <button className="icon-btn" aria-label="Edit" title="Edit" onClick={onEdit}><Pencil size={14} /></button>}
      {own && <button className="icon-btn" aria-label="Delete" title="Delete" onClick={onDelete}><Trash2 size={14} /></button>}
    </div>
  );
}
