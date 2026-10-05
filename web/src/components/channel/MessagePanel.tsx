import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { ReactionBar } from '../messages/ReactionBar.tsx';
import { FileList } from '../messages/FileAttachment.tsx';
import type { MessageInputHandle } from '../messages/MessageInput.tsx';
import { useChat } from '../../context/chatContext.ts';
import type { Channel, Message } from '../../types/index.ts';
import { renderRich } from '../messages/RichText.tsx';
import { presenceOf } from '../../utils/presence.ts';
import { UserAvatar } from '../common/UserAvatar.tsx';
import { Avatar } from '../common/Avatar.tsx';
import { useAvatarSrc } from '../../hooks/useAvatarSrc.ts';

/** Message text on screen: links, bold, code, lists and @mentions. Built from text pieces — never HTML. */
export function useMentionRenderer(channelId: string | null): (content: string) => ReactNode {
  const { state } = useChat();
  const names = useMemo(
    () => (channelId ? (state.membersByChannel[channelId] || []).map((m) => m.fullName) : []),
    [state.membersByChannel, channelId],
  );
  return useCallback((content: string) => renderRich(content, names), [names]);
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

const composerPlaceholder = (channel: Channel | null) => {
  if (!channel) return 'Message';
  return channel.type === 'dm' ? `Message ${channel.dmUserName || ''}`.trim() : `Message #${channel.displayName}`;
};

/** What an empty conversation shows instead of a blank page. */
function EmptyConversation({ channel }: { channel: Channel | null }) {
  if (!channel) return null;
  if (channel.type === 'dm') {
    const name = channel.dmUserName || 'this person';
    return (
      <div className="empty">
        <UserAvatar userId={channel.dmUserId} name={name} size="lg" />
        <h3>{name}</h3>
        <p>
          This is the very start of your conversation with {name.split(' ')[0]}. Say hello, send a file, or start a call
          from the phone icon above.
        </p>
      </div>
    );
  }
  return (
    <div className="empty">
      <Avatar name={channel.displayName} size="lg" glyph={channel.type === 'private' ? '🔒' : '#'} />
      <h3>#{channel.displayName}</h3>
      <p>Nothing has been posted here yet. Send the first message to get it going.</p>
    </div>
  );
}

export function MessagePanel({
  channelId,
  onOpenSidebar,
  onOpenThread,
  onOpenDetails,
  onOpenPins,
  openPanel = null,
}: {
  channelId: string | null;
  onOpenSidebar: () => void;
  onOpenThread?: (m: Message) => void;
  onOpenDetails?: () => void;
  onOpenPins?: () => void;
  /** Which side panel is open beside the conversation, to light its header button. */
  openPanel?: 'pins' | 'details' | null;
}) {
  const { state, user, actions } = useChat();
  const calls = useCall();
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
  const dmAvatar = useAvatarSrc(channel?.type === 'dm' ? channel.dmUserId : null);
  // How many messages were unread when this channel was opened (it is marked read a moment later,
  // so the highest count seen is kept). The NEW line in the list is placed from it.
  const unread = useRef({ channelId, count: 0 });
  if (unread.current.channelId !== channelId) unread.current = { channelId, count: 0 };
  if ((channel?.unreadCount ?? 0) > unread.current.count) unread.current.count = channel!.unreadCount;
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

  // The feed and every message in it are drawn again only when one of their props changes, so the
  // callbacks below must stay the same between draws: they read what changes through a ref.
  const held = useRef(bucket?.items);
  held.current = bucket?.items;
  const jump = useCallback(
    (id: string) => {
      if (!channelId) return;
      if (held.current?.some((m) => m.id === id)) {
        actions.highlight(id);
        return;
      }
      void actions.jumpTo(channelId, id).catch(() => {});
    },
    [channelId, actions],
  );
  const loaded = !!bucket?.loaded;
  const empty = useMemo(
    () => (loaded ? <EmptyConversation channel={channel} /> : <p className="muted pad">Loading…</p>),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loaded, channel?.id, channel?.displayName, channel?.dmUserName, channel?.type],
  );
  const openThread = useRef(onOpenThread);
  openThread.current = onOpenThread;
  const loadOlder = useCallback(
    () => (channelId ? actions.loadOlder(channelId) : Promise.resolve()),
    [actions, channelId],
  );
  const loadNewer = useCallback(
    () => (channelId ? actions.loadNewer(channelId) : Promise.resolve()),
    [actions, channelId],
  );
  const loadLatest = useCallback(
    () => (channelId ? actions.loadLatest(channelId) : Promise.resolve()),
    [actions, channelId],
  );
  const trim = useCallback(() => {
    if (channelId) actions.trimChannel(channelId);
  }, [actions, channelId]);
  const thread = useCallback((m: Message) => openThread.current?.(m), []);
  const togglePin = useCallback(
    (m: Message) => void (m.pinned ? actions.unpin(m.id) : actions.pin(m.id)).catch(() => {}),
    [actions],
  );
  const react = useCallback((m: Message, emoji: string) => void actions.react(m.id, emoji).catch(() => {}), [actions]);

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
        openPanel={openPanel}
        onOpenPins={onOpenPins}
        onOpenDetails={onOpenDetails}
        dmAvatar={dmAvatar}
        dmPresence={channel?.type === 'dm' ? presenceOf(state.presence, channel.dmUserId) : undefined}
        dmStatus={channel?.dmUserId != null ? state.presence.statuses[channel.dmUserId] : undefined}
        onSetNotify={channel ? (pref) => actions.setChannelNotify(channel.id, pref) : undefined}
        onStartCall={channel ? () => void calls.startCall(channel.id) : undefined}
        callDisabled={calls.busy}
      />
      <CallBanner channelId={channelId} />
      {channelId ? (
        <>
          <MessageFeed
            key={channelId}
            items={bucket?.items || []}
            hasOlder={!!bucket?.nextCursor}
            onLoadOlder={loadOlder}
            onLoadNewer={loadNewer}
            onTrim={trim}
            unreadAtOpen={unread.current.count}
            empty={empty}
            selfId={user.id}
            canModerate={canModerate}
            windowed={!!bucket?.windowed}
            onLoadLatest={loadLatest}
            highlightId={state.highlightId}
            onHighlightDone={actions.clearHighlight}
            renderContent={renderContent}
            renderExtra={renderExtra}
            onEdit={actions.edit}
            onDelete={actions.remove}
            onReply={actions.reply}
            onThread={thread}
            onPin={togglePin}
            onReact={react}
            onJump={jump}
          />
          <TypingIndicator names={typing} />
          <MessageInput
            ref={inputRef}
            members={members}
            sendOnEnter={state.prefs.sendOnEnter}
            placeholder={composerPlaceholder(channel)}
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
