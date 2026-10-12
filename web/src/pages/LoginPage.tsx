import { useState, type FormEvent } from 'react';
import { MessageCircle } from 'lucide-react';
import { APP_TITLE, ORG_NAME } from '../config/constants.ts';
import { signIn } from '../services/authApi.ts';
import type { Session } from '../types/index.ts';

/**
 * The sign-in page. People use their CRM email and password; there is no separate chat account.
 *
 * `note` replaces the standing line when the caller needs to say more — inside the CRM the
 * chat is framed and cannot borrow that session, so the person has to be told why they are
 * being asked to sign in again. main.tsx has passed it since the embedded-mode change; the
 * prop was never declared here, which made the whole web app fail to build.
 */
export function LoginPage({ onLoggedIn, note }: { onLoggedIn: (session: Session) => void; note?: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onLoggedIn(await signIn(email, password));
    } catch (e: any) {
      setError(e?.message || 'Sign in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <span className="s-logo">
            <MessageCircle size={17} strokeWidth={2.2} />
          </span>
          <div>
            <h1 className="login-title">{APP_TITLE}</h1>
            <span className="muted">{ORG_NAME}</span>
          </div>
        </div>
        <p className="muted">{note || 'Sign in with your CRM email and password.'}</p>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="btn-accent" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
