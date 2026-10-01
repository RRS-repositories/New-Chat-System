import { useState, type FormEvent } from 'react';
import type { Session } from '../api/types.ts';

export function LoginPage({ onLoggedIn }: { onLoggedIn: (s: Session) => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const res = await fetch('/api/chat/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.token) { setError(data?.message || 'Sign in failed'); return; }
      onLoggedIn({ token: data.token, user: { id: data.user.id, fullName: data.user.fullName || data.user.email, role: data.user.role, email: data.user.email } });
    } catch { setError('Cannot reach the chat service'); } finally { setBusy(false); }
  }

  return (
    <main className="login">
      <form className="login-card" onSubmit={submit}>
        <h1 className="login-title">Chat</h1>
        <p className="muted">Sign in with your CRM email and password.</p>
        <label className="field"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn-accent" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  );
}
