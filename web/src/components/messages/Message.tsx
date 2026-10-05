import { memo, useState, type ReactNode } from 'react';
import { Phone, Pin } from 'lucide-react';
import type { Message as M } from '../../types/index.ts';
import { formatClock, formatTime } from '../../utils/format.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';
import { MessageActions } from './MessageActions.tsx';
import { ReplyPreview } from './ReplyPreview.tsx';

export type MessageProps = {
  m: M;
  /** Follows the same person's previous message closely: no avatar or name, just the text. */
  grouped: boolean;
  own: boolean;
  canModerate: boolean;
  inThread?: boolean;
  highlighted?: boolean;
  renderContent?: (content: string) => ReactNode;
  /** What goes under the text (files, reactions). A function, so an unchanged message is not redrawn. */
  renderExtra?: (m: M) => ReactNode;
  onEdit: (id: string, c: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReply: (m: M) => void;
  onThread: (m: M) => void;
  onPin: (m: M) => void;
  onReact: (m: M, emoji: string) => void;
  onJump: (id: string) => void;
};

/**
 * One message. Wrapped in `memo`: with hundreds on the page, a new message or a keystroke must not
 * redraw the ones that did not change, so every prop here has to stay the same between draws.
 */
export const Message = memo(function Message({
  m,
  grouped,
  own,
  canModerate,
  inThread,
  highlighted,
  renderContent,
  renderExtra,
  onEdit,
  onDelete,
  onReply,
  onThread,
  onPin,
  onReact,
  onJump,
}: MessageProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const c = draft.trim();
    if (c && c !== m.content) {
      try {
        await onEdit(m.id, c);
      } catch (e: any) {
        setError(e?.message || 'Could not save');
        return;
      }
    }
    setEditing(false);
  }
  async function del() {
    try {
      await onDelete(m.id);
    } catch (e: any) {
      setError(e?.message || 'Could not delete');
      setConfirm(false);
    }
  }

  if (m.type === 'system') return <div className="msg-system muted">{m.content}</div>;
  if (m.type === 'call')
    return (
      <div id={`msg-${m.id}`} className="msg sysm msg-call">
        <div className="gav" />
        <div className="bd">
          <Phone size={14} aria-hidden="true" />
          <span>{m.content}</span>
          <span>· {formatTime(m.createdAt)}</span>
        </div>
      </div>
    );

  // A pinned message and a quoted reply always show who wrote them.
  const first = !grouped || m.pinned || !!m.replyTo;
  return (
    <div id={`msg-${m.id}`} className={`msg${first ? ' first' : ' grouped'}${highlighted ? ' highlight' : ''}`}>
      {!editing && (
        <MessageActions
          m={m}
          own={own}
          canModerate={canModerate}
          inThread={inThread}
          onReply={() => onReply(m)}
          onThread={() => onThread(m)}
          onPin={() => onPin(m)}
          onReact={(e) => onReact(m, e)}
          onEdit={() => {
            setDraft(m.content);
            setEditing(true);
          }}
          onDelete={() => setConfirm(true)}
        />
      )}
      <div className="gav">
        {first ? (
          <UserAvatar userId={m.userId} name={m.userName} />
        ) : (
          <span className="ts-h">{formatClock(m.createdAt)}</span>
        )}
      </div>
      <div className="bd msg-body">
        {m.pinned && !inThread && (
          <div className="pinflag pinned-flag">
            <Pin size={11} /> Pinned
          </div>
        )}
        {m.replyTo && <ReplyPreview replyTo={m.replyTo} onJump={onJump} />}
        {first && (
          <div className="hd msg-meta">
            <b className="msg-author">{m.userName}</b>
            <time dateTime={m.createdAt} title={new Date(m.createdAt).toLocaleString()}>
              {formatClock(m.createdAt)}
            </time>
          </div>
        )}
        {editing ? (
          <div className="msg-edit">
            <div className="comp-in">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={1}
                autoFocus
                aria-label="Edit message"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void save();
                  }
                  if (e.key === 'Escape') setEditing(false);
                }}
              />
              <button className="btn-ghost btn-small" aria-label="Cancel edit" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button className="btn-accent btn-small" onClick={() => void save()}>
                Save
              </button>
            </div>
          </div>
        ) : m.content ? (
          <div className="msg-text tx">
            {renderContent ? renderContent(m.content) : m.content}
            {m.editedAt && <span className="ed"> (edited)</span>}
          </div>
        ) : null}
        {renderExtra?.(m)}
        {!inThread && m.replyCount > 0 && (
          <button className="thlink thread-link" onClick={() => onThread(m)}>
            {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
        {confirm && (
          <div className="msg-confirm">
            <span className="muted">Delete this message?</span>
            <button className="link danger" onClick={() => void del()}>
              Delete
            </button>
            <button className="link" onClick={() => setConfirm(false)}>
              Keep
            </button>
          </div>
        )}
        {error && <p className="error">{error}</p>}
      </div>
    </div>
  );
});
