import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChannelDetailsPanel } from '../components/channel/ChannelDetailsPanel.tsx';
import { PinsPanel } from '../components/channel/PinsPanel.tsx';
import { MessagePanel } from '../components/channel/MessagePanel.tsx';
import { ThreadPanel } from '../components/channel/ThreadPanel.tsx';
import { AppShell } from '../components/layout/AppShell.tsx';
import { paths } from '../config/routes.ts';
import { useChat } from '../context/chatContext.ts';
import { useGoToChannel } from '../hooks/useGoToChannel.ts';
import { useSidebar } from '../hooks/useSidebar.ts';
import { readLastChannel } from '../utils/lastChannel.ts';

/** The main screen: one channel's conversation, with a thread or the channel details beside it when asked for. */
export function ChatPage({ details = false, pins = false }: { details?: boolean; pins?: boolean }) {
  const { channelId = null, messageId = null } = useParams();
  const navigate = useNavigate();
  const { state, actions } = useChat();
  const sidebar = useSidebar();
  const goToChannel = useGoToChannel(sidebar.closeSidebar);

  useEffect(() => {
    if (channelId) void actions.openChannel(channelId);
  }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps

  // With no channel in the address, open the one used last time (or the first in the list).
  useEffect(() => {
    if (channelId || !state.channels.length) return;
    const last = readLastChannel();
    goToChannel(state.channels.find((c) => c.id === last)?.id || state.channels[0]!.id);
  }, [channelId, state.channels, goToChannel]);

  // The open channel left this person's list (they left it, it was archived, or they were removed): go home.
  useEffect(() => {
    if (channelId && state.channels.length && !state.channels.some((c) => c.id === channelId)) navigate(paths.home);
  }, [channelId, state.channels, navigate]);

  const backToChannel = () => channelId && navigate(paths.channel(channelId));
  let panel;
  if (channelId && messageId) panel = <ThreadPanel rootId={messageId} channelId={channelId} onClose={backToChannel} />;
  else if (channelId && details)
    panel = <ChannelDetailsPanel channelId={channelId} onClose={backToChannel} onGone={() => navigate(paths.home)} />;
  else if (channelId && pins)
    panel = (
      <PinsPanel
        channelId={channelId}
        onClose={backToChannel}
        onJump={(id) => {
          // On a narrow screen the panel covers the conversation: close it so the message can be seen.
          if (window.matchMedia('(max-width: 900px)').matches) navigate(paths.channel(channelId));
          const held = state.messagesByChannel[channelId]?.items.some((m) => m.id === id);
          if (held) actions.highlight(id);
          else void actions.jumpTo(channelId, id).catch(() => {});
        }}
      />
    );

  return (
    <AppShell
      sidebar={sidebar}
      currentChannelId={channelId}
      panel={panel}
      main={
        <MessagePanel
          channelId={channelId}
          onOpenSidebar={sidebar.openSidebar}
          onOpenThread={(m) => navigate(paths.thread(m.channelId, m.threadId || m.id))}
          openPanel={details ? 'details' : pins ? 'pins' : null}
          onOpenDetails={() =>
            channelId && navigate(details ? paths.channel(channelId) : paths.channelDetails(channelId))
          }
          onOpenPins={() => channelId && navigate(pins ? paths.channel(channelId) : paths.channelPins(channelId))}
        />
      }
    />
  );
}
