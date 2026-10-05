import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { CallScreen } from './components/calls/CallScreen.tsx';
import { IncomingCallModal } from './components/calls/IncomingCallModal.tsx';
import { ThemeSync } from './components/common/ThemeSync.tsx';
import { paths } from './config/routes.ts';
import { CallProvider } from './context/CallProvider.tsx';
import { ChatProvider } from './context/ChatProvider.tsx';
import { SignOutContext } from './context/SignOutContext.ts';
import { ToastProvider } from './context/ToastProvider.tsx';
import { useNotificationOpen } from './hooks/useNotificationOpen.ts';
import { AdminPeoplePage } from './pages/AdminPeoplePage.tsx';
import { AdminUserAccessPage } from './pages/AdminUserAccessPage.tsx';
import { ChatPage } from './pages/ChatPage.tsx';
import { DmRedirectPage } from './pages/DmRedirectPage.tsx';
import { RestrictionsPage } from './pages/RestrictionsPage.tsx';
import type { ApiClient } from './services/apiClient.ts';
import type { ChatUser } from './types/index.ts';

type Props = {
  api: ApiClient;
  socket: Socket;
  user: ChatUser;
  getToken: () => string | null;
  /** The person chose to sign out. */
  onSignOut: () => void;
  /** The session stopped working (expired or revoked). */
  onAuthError: () => void;
};

/** The signed-in app: shared state, the call layer that floats above every screen, and the pages. */
export function App({ api, socket, user, getToken, onSignOut, onAuthError }: Props) {
  const [currentChannelId, setCurrentChannelId] = useState<string | null>(null);
  useNotificationOpen();

  return (
    <SignOutContext.Provider value={onSignOut}>
      <ToastProvider>
        <ChatProvider
          api={api}
          socket={socket}
          user={user}
          getToken={getToken}
          currentChannelId={currentChannelId}
          setCurrentChannelId={setCurrentChannelId}
          onAuthError={onAuthError}
        >
          <ThemeSync />
          <CallProvider socket={socket} getToken={getToken}>
            <IncomingCallModal />
            <CallScreen />
            <Routes>
              <Route path="/" element={<ChatPage />} />
              <Route path="/channels/:channelId" element={<ChatPage />} />
              <Route path="/channels/:channelId/thread/:messageId" element={<ChatPage />} />
              <Route path="/channels/:channelId/details" element={<ChatPage details />} />
              <Route path="/channels/:channelId/pins" element={<ChatPage pins />} />
              <Route path="/admin" element={<AdminPeoplePage />} />
              <Route path="/admin/users/:userId" element={<AdminUserAccessPage />} />
              <Route path="/admin/restrictions" element={<RestrictionsPage />} />
              <Route path="/dm/:userId" element={<DmRedirectPage />} />
              <Route path="*" element={<Navigate to={paths.home} replace />} />
            </Routes>
          </CallProvider>
        </ChatProvider>
      </ToastProvider>
    </SignOutContext.Provider>
  );
}
