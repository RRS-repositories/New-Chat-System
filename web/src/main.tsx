import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import type { Socket } from 'socket.io-client';
import { createApiClient } from './api/client.ts';
import { createChatSocket } from './api/socket.ts';
import { getSession, setSession, clearSession } from './auth/session.ts';
import { LoginPage } from './auth/LoginPage.tsx';
import { ChatApp } from './ChatApp.tsx';
import type { Session } from './api/types.ts';
import { disablePush } from './lib/push.ts';
import { withTimeout } from './lib/timeout.ts';
import './styles.css';

/** chat2.rowanroseclaims.co.uk: own login page, session in localStorage. */
function Root() {
  const [session, setSess] = useState<Session | null>(() => getSession());
  const socketRef = useRef<Socket | null>(null);
  // Signing out (by choice, a 401, or a rejected socket) always closes the
  // socket first so a stale connection cannot keep receiving messages.
  const signOut = useCallback(() => { socketRef.current?.close(); socketRef.current = null; clearSession(); setSess(null); }, []);
  const api = useMemo(() => createApiClient({ baseUrl: '', getToken: () => getSession()?.token ?? null, onUnauthorized: signOut }), [signOut]);
  const socket = useMemo(() => (session ? createChatSocket({ baseUrl: '', getToken: () => getSession()?.token ?? null }) : null), [session?.token]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { socketRef.current = socket; return () => { socket?.close(); }; }, [socket]);
  // Choosing to sign out also stops push to this device (while the token still
  // works), but never waits more than 2 s for it. Not on a 401: that call would
  // fail and loop back into signOut.
  const userSignOut = useCallback(() => { void withTimeout(disablePush(api), 2000).catch(() => {}).finally(signOut); }, [api, signOut]);
  if (!session || !socket) return <LoginPage onLoggedIn={(s) => { setSession(s); setSess(s); }} />;
  return <BrowserRouter><ChatApp api={api} socket={socket} user={session.user} getToken={() => getSession()?.token ?? null} onSignOut={userSignOut} onAuthError={signOut} /></BrowserRouter>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);
