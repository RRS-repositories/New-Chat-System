import { useState, type ReactNode } from 'react';
import { Phone, Pin, X } from 'lucide-react';
import type { Message as M } from '../../types/index.ts';
import { avatarTone, formatTime, initials } from '../../utils/format.ts';
import { MessageActions } from './MessageActions.tsx';
import { ReplyPreview } from './ReplyPreview.tsx';

export type MessageProps = {
  m: M;
  grouped: boolean;
  own: boolean;
  canModerate: boolean;
  inThread?: boolean;
  highlighted?: boolean;
  renderContent?: (content: string) => ReactNode;
  extra?: ReactNode;
  onEdit: (id: string, c: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReply: (m: M) => void;
  onThread: (m: M) => void;
  onPin: (m: M) => void;
  onReact: (m: M, emoji: string) => void;
  onJump: (id: string) => void;
};

export function Message({
  m,
  grouped,
  own,
  canModerate,
  inThread,
  highlighted,
  renderContent,
  extra,
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
      <div id={`msg-${m.id}`} className="msg-call muted">
        <Phone size={12} aria-hidden="true" />
        <span>{m.content}</span>
        <span>· {formatTime(m.createdAt)}</span>
      </div>
    );
  const showMeta = !grouped || !!m.replyTo;
  return (
    <div id={`msg-${m.id}`} className={`msg${grouped ? ' grouped' : ''}${highlighted ? ' highlight' : ''}`}>
      <div className="msg-avatar">
        {!grouped && <span className={`avatar av-${avatarTone(m.userName)}`}>{initials(m.userName)}</span>}
      </div>
      <div className="msg-body">
        {m.replyTo && <ReplyPreview replyTo={m.replyTo} onJump={onJump} />}
        {showMeta && !grouped && (
          <div className="msg-meta">
            <span className="msg-author">{m.userName}</span>
            <span className="muted">{formatTime(m.createdAt)}</span>
            {m.pinned && (
              <span className="muted pinned-flag" title="Pinned">
                <Pin size={11} /> pinned
              </span>
            )}
          </div>
        )}
        {editing ? (
          <div className="msg-edit">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={2}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void save();
                }
                if (e.key === 'Escape') setEditing(false);
              }}
            />
            <div className="row gap">
              <button className="btn-accent" onClick={() => void save()}>
                Save
              </button>
              <button className="btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : m.content ? (
          <div className="msg-text">
            {renderContent ? renderContent(m.content) : m.content}
            {m.editedAt && <span className="muted"> (edited)</span>}
          </div>
        ) : null}
        {extra}
        {!inThread && m.replyCount > 0 && (
          <button className="link thread-link" onClick={() => onThread(m)}>
            {m.replyCount} {m.replyCount === 1 ? 'reply' : 'replies'}
          </button>
        )}
        {confirm && (
          <div className="row gap">
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
      {editing && (
        <button className="icon-btn" aria-label="Cancel edit" onClick={() => setEditing(false)}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
