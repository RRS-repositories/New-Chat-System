import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ReactionBar } from '../messages/ReactionBar.tsx';
import { PinnedList } from './PinnedMessagesBar.tsx';
import { FileList } from '../messages/FileAttachment.tsx';
import type { MessageInputHandle } from '../messages/MessageInput.tsx';
import { useChat } from '../../context/chatContext.ts';
import type { Message } from '../../types/index.ts';
import { renderWithMentions } from '../../utils/mentions.ts';
import { presenceOf } from '../../utils/presence.ts';

/** Render message text with @mentions highlighted. Text only — never HTML. */
export function useMentionRenderer(channelId: string | null): (content: string) => ReactNode {
  const { state } = useChat();
  const names = useMemo(
    () => (channelId ? (state.membersByChannel[channelId] || []).map((m) => m.fullName) : []),
    [state.membersByChannel, channelId],
  );
  return useCallback(
    (content: string) =>
      renderWithMentions(content, names).map((p, i) =>
        p.mention ? (
          <span key={i} className="mention">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      ),
    [names],
  );
}
import { ChannelHeader } from './ChannelHeader.tsx';
import { MessageFeed } from '../messages/MessageFeed.tsx';
import { MessageInput } from '../messages/MessageInput.tsx';
import { TypingIndicator } from '../messages/TypingIndicator.tsx';
import { CallBanner } from '../calls/CallBanner.tsx';
import { useCall } from '../../context/callContext.ts';

export function useCanModerate(channelId: string | null): boolean {
  const { state, user } = useChat();
  if (user.role === 'Management') return true;
  const me = channelId ? (state.membersByChannel[channelId] || []).find((m) => m.id === user.id) : undefined;
  return me?.channelRole === 'owner' || me?.channelRole === 'admin';
}

/** Attachments and reaction pills under a message; used by the feed and the thread panel. */
export function useReactionExtra(): (m: Message) => ReactNode {
  const { user, actions } = useChat();
  return useCallback(
    (m: Message) => (
      <>
        <FileList files={m.files} />
        <ReactionBar
          reactions={m.reactions}
          selfId={user.id}
          onToggle={(e) => void actions.react(m.id, e).catch(() => {})}
        />
      </>
    ),
    [user.id, actions],
  );
}

export function MessagePanel({
  channelId,
  onOpenSidebar,
  onOpenThread,
  onOpenDetails,
}: {
  channelId: string | null;
  onOpenSidebar: () => void;
  onOpenThread?: (m: Message) => void;
  onOpenDetails?: () => void;
}) {
  const { state, user, actions } = useChat();
  const calls = useCall();
  const [showPins, setShowPins] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<MessageInputHandle>(null);
  const onDragOver = (e: DragEvent) => {
    if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault();
      setDragging(true);
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    inputRef.current?.addFiles(Array.from(e.dataTransfer.files || []));
  };
  const renderExtra = useReactionExtra();
  const pins = channelId ? state.pinsByChannel[channelId] || [] : [];
  const channel = state.channels.find((c) => c.id === channelId) || null;
  const bucket = channelId ? state.messagesByChannel[channelId] : undefined;
  const canModerate = useCanModerate(channelId);
  const renderContent = useMentionRenderer(channelId);
  const members = channelId ? state.membersByChannel[channelId] || [] : [];
  const typing = channelId
    ? Object.entries(state.typingByChannel[channelId] || {})
        .filter(([uid]) => Number(uid) !== user.id)
        .map(([, v]) => v.name)
    : [];
  useEffect(() => {
    if (channelId) {
      void actions.loadMembers(channelId).catch(() => {});
      void actions.loadPins(channelId).catch(() => {});
    }
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  const jump = useCallback(
    (id: string) => {
      if (!channelId) return;
      if (bucket?.items.some((m) => m.id === id)) {
        actions.highlight(id);
        return;
      }
      void actions.jumpTo(channelId, id).catch(() => {});
    },
    [channelId, bucket, actions],
  );

  return (
    <div
      className={`panel${dragging ? ' drop-target' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <ChannelHeader
        channel={channel}
        onOpenSidebar={onOpenSidebar}
        connected={state.connected}
        pinCount={pins.length}
        onOpenPins={() => setShowPins(true)}
        onOpenDetails={onOpenDetails}
        dmPresence={channel?.type === 'dm' ? presenceOf(state.presence, channel.dmUserId) : undefined}
        dmStatus={channel?.dmUserId != null ? state.presence.statuses[channel.dmUserId] : undefined}
        onSetNotify={channel ? (pref) => actions.setChannelNotify(channel.id, pref) : undefined}
        onStartCall={channel ? () => void calls.startCall(channel.id) : undefined}
        callDisabled={calls.busy}
      />
      <CallBanner channelId={channelId} />
      {showPins && channelId && (
        <PinnedList
          pins={pins}
          canModerate={canModerate}
          onJump={jump}
          onUnpin={(id) => void actions.unpin(id).catch(() => {})}
          onClose={() => setShowPins(false)}
        />
      )}
      {channelId ? (
        <>
          <MessageFeed
            key={channelId}
            items={bucket?.items || []}
            hasOlder={!!bucket?.nextCursor}
            onLoadOlder={() => actions.loadOlder(channelId)}
            selfId={user.id}
            canModerate={canModerate}
            windowed={!!bucket?.windowed}
            onLoadLatest={() => actions.loadLatest(channelId)}
            highlightId={state.highlightId}
            onHighlightDone={actions.clearHighlight}
            renderContent={renderContent}
            renderExtra={renderExtra}
            onEdit={actions.edit}
            onDelete={actions.remove}
            onReply={actions.reply}
            onThread={(m) => onOpenThread?.(m)}
            onPin={(m) => void (m.pinned ? actions.unpin(m.id) : actions.pin(m.id)).catch(() => {})}
            onReact={(m, e) => void actions.react(m.id, e).catch(() => {})}
            onJump={jump}
          />
          <TypingIndicator names={typing} />
          <MessageInput
            ref={inputRef}
            members={members}
            sendOnEnter={state.prefs.sendOnEnter}
            onUpload={(files, c) =>
              actions.upload(
                channelId,
                files,
                c,
                state.replyTarget?.channelId === channelId ? state.replyTarget.id : null,
              )
            }
            replyTo={
              state.replyTarget && state.replyTarget.channelId === channelId && !state.replyTarget.threadId
                ? state.replyTarget
                : null
            }
            onCancelReply={() => actions.reply(null)}
            onSend={(c) =>
              actions.send(channelId, c, {
                replyToId: state.replyTarget?.channelId === channelId ? state.replyTarget.id : null,
              })
            }
            onTyping={() => actions.typing(channelId)}
          />
        </>
      ) : (
        <p className="muted pad">Pick a channel to start.</p>
      )}
    </div>
  );
}
