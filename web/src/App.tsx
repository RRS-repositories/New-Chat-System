import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import type { ApiClient } from './services/apiClient.ts';
import type { ChatUser } from './types/index.ts';
import { ChatProvider, useChat } from './context/ChatProvider.tsx';
import { CallProvider } from './context/CallProvider.tsx';
import { CallPanel } from './components/calls/CallPanel.tsx';
import { IncomingCallModal } from './components/calls/IncomingCallModal.tsx';
import { ChatLayout, useSidebar } from './components/layout/ChatLayout.tsx';
import { Sidebar } from './components/layout/Sidebar.tsx';
import { MessagePanel } from './components/channel/MessagePanel.tsx';
import { ThreadPanel } from './components/channel/ThreadPanel.tsx';
import { ChannelDetailsPanel } from './components/channel/ChannelDetailsPanel.tsx';
import { SearchPanel } from './components/channel/SearchPanel.tsx';
import { NewChannelDialog } from './components/dialogs/NewChannelDialog.tsx';
import { NewDmDialog } from './components/dialogs/NewDmDialog.tsx';
import { BrowseChannelsDialog } from './components/dialogs/BrowseChannelsDialog.tsx';
import { RestrictionsAdmin } from './pages/RestrictionsPage.tsx';
import { AdminPeople, AdminUserAccess } from './pages/AdminPeoplePage.tsx';
import { SettingsDialog } from './components/dialogs/SettingsDialog.tsx';
import { isManagement } from './utils/restrictions.ts';
import { parseSwOpen } from './utils/notify.ts';
import './styles/index.css';

const LAST = 'chat_last_channel';
const NOT_ENABLED = 'Team chat is not enabled for your account. Ask a manager to switch it on under Settings → Permissions.';

function ChannelScreen({ basePath, onSignOut, details, admin }: { basePath: string; onSignOut?: () => void; details?: boolean; admin?: 'people' | 'user' | 'restrictions' }) {
  const { channelId = null, messageId = null, userId = null } = useParams(); const nav = useNavigate();
  const { state, user, actions, setCurrentChannelId } = useChat(); const { open, openSidebar, closeSidebar } = useSidebar();
  const [dialog, setDialog] = useState<'channel' | 'dm' | 'browse' | 'search' | 'settings' | null>(null);
  const go = useCallback((id: string) => { try { localStorage.setItem(LAST, id); } catch {} nav(`${basePath}/channels/${id}`); closeSidebar(); }, [basePath, nav, closeSidebar]);
  useEffect(() => { if (channelId) void actions.openChannel(channelId); }, [channelId]); // eslint-disable-line react-hooks/exhaustive-deps
  // On the admin page no channel is open (so nothing is marked read behind it).
  useEffect(() => { if (admin) setCurrentChannelId(null); }, [admin, setCurrentChannelId]);
  useEffect(() => { const n = state.channels.reduce((a, c) => a + (c.mentionCount || 0), 0); document.title = n ? `(${n}) Chat` : 'Chat'; }, [state.channels]);
  useEffect(() => { if (!channelId && !admin && state.channels.length) { let last = null as string | null; try { last = localStorage.getItem(LAST); } catch {} go(state.channels.find((c) => c.id === last)?.id || state.channels[0]!.id); } }, [channelId, admin, state.channels, go]);
  if (state.notEnabled) return (
    <main className="not-enabled">
      <div className="not-enabled-card">
        <p>{NOT_ENABLED}</p>
        {onSignOut && <button className="link" onClick={onSignOut}>Sign out</button>}
      </div>
    </main>
  );
  const panel = channelId && messageId
    ? <ThreadPanel rootId={messageId} channelId={channelId} onClose={() => nav(`${basePath}/channels/${channelId}`)} />
    : channelId && details
      ? <ChannelDetailsPanel channelId={channelId} onClose={() => nav(`${basePath}/channels/${channelId}`)} />
      : undefined;
  const adminHead = { onOpenSidebar: openSidebar, onClose: () => nav(basePath || '/'), onTab: (t: 'people' | 'restrictions') => nav(`${basePath}/admin${t === 'restrictions' ? '/restrictions' : ''}`) };
  const adminPage = admin === 'restrictions' ? <RestrictionsAdmin {...adminHead} />
    : admin === 'user' && userId && /^\d+$/.test(userId) ? <AdminUserAccess userId={Number(userId)} onBack={() => nav(`${basePath}/admin`)} {...adminHead} />
    : <AdminPeople onOpenUser={(id) => nav(`${basePath}/admin/users/${id}`)} {...adminHead} />;
  return (
    <>
      <ChatLayout sidebarOpen={open} onCloseSidebar={closeSidebar} panel={panel}
        sidebar={<Sidebar channels={state.channels} currentId={channelId} onSelect={(c) => go(c.id)} onNewChannel={() => setDialog('channel')} onNewDm={() => setDialog('dm')} onBrowse={() => setDialog('browse')} onSearch={() => setDialog('search')}
          onRestrictions={isManagement(user) ? () => { nav(`${basePath}/admin`); closeSidebar(); } : undefined} restrictionsActive={!!admin} userName={user.fullName} onSignOut={onSignOut}
          presence={state.presence} onSettings={() => { setDialog('settings'); closeSidebar(); }} />}
        main={admin ? adminPage : <MessagePanel channelId={channelId} onOpenSidebar={openSidebar} onOpenThread={(m) => nav(`${basePath}/channels/${m.channelId}/thread/${m.threadId || m.id}`)} onOpenDetails={() => channelId && nav(`${basePath}/channels/${channelId}/details`)} />} />
      {dialog === 'channel' && <NewChannelDialog onClose={() => setDialog(null)} onCreated={go} />}
      {dialog === 'dm' && <NewDmDialog onClose={() => setDialog(null)} onOpened={go} />}
      {dialog === 'browse' && <BrowseChannelsDialog onClose={() => setDialog(null)} onJoined={go} />}
      {dialog === 'settings' && <SettingsDialog onClose={() => setDialog(null)} />}
      {dialog === 'search' && <SearchPanel currentChannelId={channelId} onClose={() => setDialog(null)}
        onJump={(cid, mid) => { closeSidebar(); if (cid !== channelId) nav(`${basePath}/channels/${cid}`); void actions.jumpTo(cid, mid).catch(() => {}); }} />}
    </>
  );
}

/** A clicked notification (service worker `chat-sw:open`) opens its channel in this tab. */
function NotificationOpen({ basePath }: { basePath: string }) {
  const nav = useNavigate();
  useEffect(() => {
    const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null; if (!sw) return;
    const onSw = (e: MessageEvent) => { const id = parseSwOpen(e.data); if (!id) return; try { localStorage.setItem(LAST, id); } catch {} nav(`${basePath}/channels/${id}`); };
    sw.addEventListener('message', onSw); try { sw.startMessages(); } catch { /* older browsers */ }
    return () => sw.removeEventListener('message', onSw);
  }, [basePath, nav]);
  return null;
}

function DmRedirect({ basePath }: { basePath: string }) {
  const { userId } = useParams(); const nav = useNavigate(); const { actions } = useChat();
  useEffect(() => { actions.openDm(Number(userId)).then((c) => nav(`${basePath}/channels/${c.id}`, { replace: true })).catch(() => nav(basePath || '/', { replace: true })); }, [userId]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function ChatApp({ api, socket, user, getToken, basePath = '', onSignOut, onAuthError }: { api: ApiClient; socket: Socket; user: ChatUser; getToken: () => string | null; basePath?: string; onSignOut?: () => void; onAuthError?: () => void }) {
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  return (
    <ChatProvider api={api} socket={socket} user={user} getToken={getToken} currentChannelId={currentChannelId} setCurrentChannelId={setCurrentChannelId} onAuthError={onAuthError ?? onSignOut}>
      <CallProvider socket={socket} getToken={getToken}>
      <NotificationOpen basePath={basePath} />
      <IncomingCallModal basePath={basePath} />
      <CallPanel />
      <Routes>
        <Route path="/" element={<ChannelScreen basePath={basePath} onSignOut={onSignOut} />} />
        <Route path="/channels/:channelId" element={<ChannelScreen basePath={basePath} onSignOut={onSignOut} />} />
        <Route path="/channels/:channelId/thread/:messageId" element={<ChannelScreen basePath={basePath} onSignOut={onSignOut} />} />
        <Route path="/channels/:channelId/details" element={<ChannelScreen basePath={basePath} onSignOut={onSignOut} details />} />
        <Route path="/admin" element={<ChannelScreen basePath={basePath} onSignOut={onSignOut} admin="people" />} />
        <Route path="/admin/users/:userId" element={<ChannelScreen basePath={basePath} onSignOut={onSignOut} admin="user" />} />
        <Route path="/admin/restrictions" element={<ChannelScreen basePath={basePath} onSignOut={onSignOut} admin="restrictions" />} />
        <Route path="/dm/:userId" element={<DmRedirect basePath={basePath} />} />
        <Route path="*" element={<Navigate to={basePath || '/'} replace />} />
      </Routes>
      </CallProvider>
    </ChatProvider>
  );
}
