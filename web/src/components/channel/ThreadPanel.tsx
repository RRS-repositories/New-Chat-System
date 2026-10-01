import { useEffect, type ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';
import type { Message as M } from '../../types/index.ts';
import { Message } from '../messages/Message.tsx';
import { MessageInput } from '../messages/MessageInput.tsx';
import { useCanModerate, useMentionRenderer, useReactionExtra } from './MessagePanel.tsx';

export function ThreadPanel({
  rootId,
  channelId,
  onClose,
  renderContent,
  renderExtra,
  onUpload,
}: {
  rootId: string;
  channelId: string;
  onClose: () => void;
  renderContent?: (c: string) => ReactNode;
  renderExtra?: (m: M) => ReactNode;
  onUpload?: (files: File[], content: string) => Promise<void>;
}) {
  const { state, user, actions } = useChat();
  const t = state.threads[rootId];
  const canModerate = useCanModerate(channelId);
  const mentionRenderer = useMentionRenderer(channelId);
  renderContent = renderContent || mentionRenderer;
  const reactionExtra = useReactionExtra();
  renderExtra = renderExtra || reactionExtra;
  const members = state.membersByChannel[channelId] || [];
  useEffect(() => {
    void actions.openThread(rootId).catch(() => onClose());
  }, [rootId]); // eslint-disable-line react-hooks/exhaustive-deps
  const replyTarget =
    state.replyTarget && (state.replyTarget.threadId === rootId || state.replyTarget.id === rootId)
      ? state.replyTarget
      : null;
  const common = (m: M) => ({
    m,
    own: m.userId === user.id,
    canModerate,
    inThread: true,
    highlighted: false,
    renderContent,
    renderExtra,
    onEdit: actions.edit,
    onDelete: actions.remove,
    onReply: () => actions.reply(m),
    onThread: () => {},
    onPin: () => void (m.pinned ? actions.unpin(m.id) : actions.pin(m.id)).catch(() => {}),
    onReact: (_m: M, emoji: string) => void actions.react(m.id, emoji).catch(() => {}),
    onJump: () => {},
  });
  return (
    <aside className="thread-panel" aria-label="Thread">
      <header className="chan-head">
        <button className="icon-btn only-mobile" aria-label="Back" onClick={onClose}>
          <ArrowLeft size={18} />
        </button>
        <h2 className="chan-title">Thread</h2>
        <button className="icon-btn only-desktop push-right" aria-label="Close thread" onClick={onClose}>
          <X size={16} />
        </button>
      </header>
      <div className="feed">
        {!t ? (
          <p className="muted pad">Loading…</p>
        ) : (
          <>
            <Message {...common(t.root)} grouped={false} />
            <div className="thread-divider muted">
              {t.replies.length} {t.replies.length === 1 ? 'reply' : 'replies'}
            </div>
            {t.replies.map((m, i) => (
              <Message key={m.id} {...common(m)} grouped={i > 0 && t.replies[i - 1]!.userId === m.userId} />
            ))}
          </>
        )}
      </div>
      <MessageInput
        members={members}
        sendOnEnter={state.prefs.sendOnEnter}
        replyTo={replyTarget && replyTarget.id !== rootId ? replyTarget : null}
        onCancelReply={() => actions.reply(null)}
        onSend={(c) =>
          actions.send(channelId, c, {
            threadId: rootId,
            replyToId: replyTarget && replyTarget.id !== rootId ? replyTarget.id : null,
          })
        }
        onTyping={() => actions.typing(channelId)}
        onUpload={
          onUpload ||
          ((files, c) =>
            actions.upload(
              channelId,
              files,
              c,
              replyTarget && replyTarget.id !== rootId ? replyTarget.id : null,
              rootId,
            ))
        }
      />
    </aside>
  );
}
