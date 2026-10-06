import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useChat } from '../../context/chatContext.ts';

/** Management or IT set a person's password. The CRM applies its rules and signs the person out everywhere. */
export function SetPassword({ userId, name }: { userId: number; name: string }) {
  const { actions } = useChat();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setDone(await actions.setUserPassword(userId, password, confirm));
      setPassword('');
      setConfirm('');
      setOpen(false);
    } catch (e: any) {
      setError(e?.message || 'Could not set the password');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card" data-testid="set-password">
      <div className="admin-card-head">
        <KeyRound size={16} aria-hidden="true" />
        <div>
          <b>Password</b>
          <span className="muted">
            Set a new password for {name}. It signs them out everywhere; the same password opens the CRM and the chat.
          </span>
        </div>
        {!open && (
          <button className="btn-ghost btn-small" data-testid="set-password-open" onClick={() => setOpen(true)}>
            Set a password
          </button>
        )}
      </div>
      {open && (
        <form
          className="admin-card-form"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              data-testid="set-password-new"
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </label>
          <label className="field">
            <span>Again</span>
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              data-testid="set-password-again"
              onChange={(e) => setConfirm(e.target.value)}
            />
          </label>
          <div className="row gap">
            <button className="btn-accent" type="submit" data-testid="set-password-save" disabled={busy || !password}>
              Set password
            </button>
            <button className="btn-ghost" type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {done && (
        <p className="ok" role="status" data-testid="set-password-done">
          {done}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
