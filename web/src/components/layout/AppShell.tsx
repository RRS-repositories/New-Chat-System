import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_TITLE } from '../../config/constants.ts';
import { paths } from '../../config/routes.ts';
import { useChat } from '../../context/chatContext.ts';
import { useSignOut } from '../../context/SignOutContext.ts';
import { useGoToChannel } from '../../hooks/useGoToChannel.ts';
import type { SidebarState } from '../../hooks/useSidebar.ts';
import { isManagement } from '../../utils/restrictions.ts';
import { SearchPanel } from '../channel/SearchPanel.tsx';
import { NotEnabled } from '../common/NotEnabled.tsx';
import { BrowseChannelsDialog } from '../dialogs/BrowseChannelsDialog.tsx';
import { NewChannelDialog } from '../dialogs/NewChannelDialog.tsx';
import { NewDmDialog } from '../dialogs/NewDmDialog.tsx';
import { SettingsDialog } from '../dialogs/SettingsDialog.tsx';
import { ChatLayout } from './ChatLayout.tsx';
import { Sidebar } from './Sidebar.tsx';

type Dialog = 'channel' | 'dm' | 'browse' | 'search' | 'settings' | null;

type Props = {
  sidebar: SidebarState;
  main: ReactNode;
  panel?: ReactNode;
  /** The channel on screen, if any (highlighted in the sidebar; search jumps relative to it). */
  currentChannelId?: string | null;
  /** True on the admin pages (highlights "Admin" in the sidebar). */
  adminActive?: boolean;
};

/**
 * What every signed-in screen shares: the sidebar, the dialogs it opens (new channel, new message,
 * browse, search, settings), the unread count in the tab title, and the "not enabled" screen.
 */
export function AppShell({ sidebar, main, panel, currentChannelId = null, adminActive = false }: Props) {
  const { state, user, actions } = useChat();
  const navigate = useNavigate();
  const signOut = useSignOut();
  const goToChannel = useGoToChannel(sidebar.closeSidebar);
  const [dialog, setDialog] = useState<Dialog>(null);
  const closeDialog = () => setDialog(null);

  useEffect(() => {
    const mentions = state.channels.reduce((total, channel) => total + (channel.mentionCount || 0), 0);
    document.title = mentions ? `(${mentions}) ${APP_TITLE}` : APP_TITLE;
  }, [state.channels]);

  if (state.notEnabled) return <NotEnabled />;

  const openFromSidebar = (next: Exclude<Dialog, null>) => {
    setDialog(next);
    if (next === 'settings') sidebar.closeSidebar();
  };
  const openAdmin = () => {
    navigate(paths.admin);
    sidebar.closeSidebar();
  };
  const jumpToMessage = (channelId: string, messageId: string) => {
    sidebar.closeSidebar();
    if (channelId !== currentChannelId) navigate(paths.channel(channelId));
    void actions.jumpTo(channelId, messageId).catch(() => {});
  };

  return (
    <>
      <ChatLayout
        sidebarOpen={sidebar.open}
        onCloseSidebar={sidebar.closeSidebar}
        panel={panel}
        main={main}
        sidebar={
          <Sidebar
            channels={state.channels}
            currentId={currentChannelId}
            presence={state.presence}
            userName={user.fullName}
            adminActive={adminActive}
            onSelect={(channel) => goToChannel(channel.id)}
            onNewChannel={() => openFromSidebar('channel')}
            onNewDm={() => openFromSidebar('dm')}
            onBrowse={() => openFromSidebar('browse')}
            onSearch={() => openFromSidebar('search')}
            onSettings={() => openFromSidebar('settings')}
            onAdmin={isManagement(user) ? openAdmin : undefined}
            onSignOut={signOut}
          />
        }
      />
      {dialog === 'channel' && <NewChannelDialog onClose={closeDialog} onCreated={goToChannel} />}
      {dialog === 'dm' && <NewDmDialog onClose={closeDialog} onOpened={goToChannel} />}
      {dialog === 'browse' && <BrowseChannelsDialog onClose={closeDialog} onJoined={goToChannel} />}
      {dialog === 'settings' && <SettingsDialog onClose={closeDialog} />}
      {dialog === 'search' && <SearchPanel currentChannelId={currentChannelId} onClose={closeDialog} onJump={jumpToMessage} />}
    </>
  );
}
