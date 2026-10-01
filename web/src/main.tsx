import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { App } from './App.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { createApiClient } from './services/apiClient.ts';
import { disablePush } from './services/push.ts';
import { clearSession, getSession, setSession } from './services/session.ts';
import { createChatSocket } from './services/socket.ts';
import type { Session } from './types/index.ts';
import { withTimeout } from './utils/timeout.ts';
import './styles/index.css';

const SIGN_OUT_WAIT_MS = 2000;
const currentToken = () => getSession()?.token ?? null;

/** Shows the sign-in page until there is a session, then the app. The session is kept in browser storage. */
function Root() {
  const [session, setCurrentSession] = useState<Session | null>(() => getSession());
  const socketRef = useRef<Socket | null>(null);

  // Signing out (by choice, an expired session, or a refused connection) always closes the live
  // connection first, so a stale one cannot keep receiving messages.
  const signOut = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    clearSession();
    setCurrentSession(null);
  }, []);

  const api = useMemo(
    () => createApiClient({ baseUrl: '', getToken: currentToken, onUnauthorized: signOut }),
    [signOut],
  );
  const socket = useMemo(
    () => (session ? createChatSocket({ baseUrl: '', getToken: currentToken }) : null),
    [session?.token], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    socketRef.current = socket;
    return () => {
      socket?.close();
    };
  }, [socket]);

  // Choosing to sign out also stops push to this device while the token still works, but never
  // waits long for it. Not done on an expired session: that request would fail and loop back here.
  const signOutByChoice = useCallback(() => {
    void withTimeout(disablePush(api), SIGN_OUT_WAIT_MS)
      .catch(() => {})
      .finally(signOut);
  }, [api, signOut]);

  if (!session || !socket) {
    return (
      <LoginPage
        onLoggedIn={(next) => {
          setSession(next);
          setCurrentSession(next);
        }}
      />
    );
  }
  return (
    <BrowserRouter>
      <App
        api={api}
        socket={socket}
        user={session.user}
        getToken={currentToken}
        onSignOut={signOutByChoice}
        onAuthError={signOut}
      />
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
