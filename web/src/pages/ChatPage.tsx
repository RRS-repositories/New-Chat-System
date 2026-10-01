import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChannelDetailsPanel } from '../components/channel/ChannelDetailsPanel.tsx';
import { MessagePanel } from '../components/channel/MessagePanel.tsx';
import { ThreadPanel } from '../components/channel/ThreadPanel.tsx';
import { AppShell } from '../components/layout/AppShell.tsx';
import { paths } from '../config/routes.ts';
import { useChat } from '../context/chatContext.ts';
import { useGoToChannel } from '../hooks/useGoToChannel.ts';
import { useSidebar } from '../hooks/useSidebar.ts';
import { readLastChannel } from '../utils/lastChannel.ts';

/** The main screen: one channel's conversation, with a thread or the channel details beside it when asked for. */
export function ChatPage({ details = false }: { details?: boolean }) {
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

  const backToChannel = () => channelId && navigate(paths.channel(channelId));
  let panel;
  if (channelId && messageId) panel = <ThreadPanel rootId={messageId} channelId={channelId} onClose={backToChannel} />;
  else if (channelId && details) panel = <ChannelDetailsPanel channelId={channelId} onClose={backToChannel} />;

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
          onOpenDetails={() => channelId && navigate(paths.channelDetails(channelId))}
        />
      }
    />
  );
}
