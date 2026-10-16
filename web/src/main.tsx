import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { App } from './App.tsx';
import { ThemeProvider } from './context/ThemeProvider.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { createApiClient } from './services/apiClient.ts';
import { disablePush } from './services/push.ts';
import { clearSession, getSession, setSession } from './services/session.ts';
import { createChatSocket } from './services/socket.ts';
import type { Session } from './types/index.ts';
import { withTimeout } from './utils/timeout.ts';
import { isEmbedded } from './utils/embed.ts';
import '@fontsource-variable/inter/wght.css';
import './styles/index.css';
import { holdPresenceLock } from './utils/keepAwake.ts';

const SIGN_OUT_WAIT_MS = 2000;
const currentToken = () => getSession()?.token ?? null;
// Inside the CRM's Chat tab. Everyone signs in to the chat as themselves there, once per browser.
const embedded = isEmbedded();

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
    // Signed in: ask the browser not to freeze this tab, so presence holds while people work elsewhere.
    if (socket) holdPresenceLock();
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
        note={
          embedded
            ? 'Sign in to your own chat account with your CRM email and password. This browser remembers it, so you only do this once.'
            : undefined
        }
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
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  </StrictMode>,
);
