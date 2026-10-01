import { CornerUpLeft } from 'lucide-react';
import type { Message } from '../../types/index.ts';
export function ReplyPreview({ replyTo, onJump }: { replyTo: NonNullable<Message['replyTo']>; onJump: (id: string) => void }) {
  const text = replyTo.content.length > 80 ? `${replyTo.content.slice(0, 80)}…` : replyTo.content;
  return (
    <button className="reply-preview" onClick={() => onJump(replyTo.id)} title="Go to the original message">
      <CornerUpLeft size={12} /><span className="reply-author">{replyTo.userName || 'Unknown'}</span><span className="reply-text">{text || '(attachment)'}</span>
    </button>
  );
}
