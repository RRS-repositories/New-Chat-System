import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Menu, X } from 'lucide-react';
import { useChat } from '../context/ChatProvider.tsx';
import type { AdminUser, Restriction } from '../types/index.ts';
import { ACCESS_KINDS, KIND_LABEL, accessMap, anyBlocked, blockedList, filterPeople, type AccessKind, type PairAccess } from '../utils/access.ts';
import { isManagement } from '../utils/restrictions.ts';

const NO_ACCESS: PairAccess = { out: { dm: false, call: false, channel: false }, in: { dm: false, call: false, channel: false } };

/** The two admin pages share one header: a title, the People / All restrictions tabs and a way back to chat. */
export function AdminHead({ title, tab, onTab, onClose, onOpenSidebar, onBack }: { title: string; tab: 'people' | 'restrictions'; onTab: (t: 'people' | 'restrictions') => void; onClose: () => void; onOpenSidebar: () => void; onBack?: () => void }) {
  return (
    <header className="chan-head">
      <button className="icon-btn only-mobile" aria-label="Channels" onClick={onOpenSidebar}><Menu size={18} /></button>
      {onBack && <button className="icon-btn" aria-label="Back to people" title="Back to people" onClick={onBack}><ArrowLeft size={16} /></button>}
      <h1 className="chan-title">{title}</h1>
      <nav className="admin-tabs" aria-label="Admin sections">
        <button className={`admin-tab${tab === 'people' ? ' active' : ''}`} aria-current={tab === 'people' ? 'page' : undefined} onClick={() => onTab('people')}>People</button>
        <button className={`admin-tab${tab === 'restrictions' ? ' active' : ''}`} aria-current={tab === 'restrictions' ? 'page' : undefined} onClick={() => onTab('restrictions')}>All restrictions</button>
      </nav>
      <span className="head-actions"><button className="icon-btn" aria-label="Close admin" title="Back to chat" onClick={onClose}><X size={16} /></button></span>
    </header>
  );
}

function useAdminUsers(allowed: boolean) {
  const { actions } = useChat();
  const [users, setUsers] = useState<AdminUser[] | null>(null); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setUsers(await actions.adminUsers()); setError(null); } catch (e: any) { setUsers((u) => u ?? []); setError(e?.message || 'Could not load people'); }
  }, [actions]);
  useEffect(() => { if (allowed) void load(); }, [allowed, load]);
  return { users, error, reload: load };
}

function Filters({ query, setQuery, role, setRole, roles }: { query: string; setQuery: (s: string) => void; role: string; setRole: (s: string) => void; roles: string[] }) {
  return (
    <div className="admin-filters">
      <input className="admin-search" type="search" placeholder="Search people" aria-label="Search people" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="">All roles</option>{roles.map((r) => <option key={r} value={r}>{r}</option>)}
      </select>
    </div>
  );
}

type PageProps = { onClose: () => void; onOpenSidebar: () => void; onTab: (t: 'people' | 'restrictions') => void };

/** Admin → People: everyone who can sign in, whether chat is on for them, and how restricted they are. Click a person to set who they can contact. */
export function AdminPeople({ onOpenUser, ...head }: PageProps & { onOpenUser: (id: number) => void }) {
  const { user } = useChat(); const allowed = isManagement(user);
  const { users, error } = useAdminUsers(allowed);
  const [query, setQuery] = useState(''); const [role, setRole] = useState('');
  const roles = useMemo(() => [...new Set((users || []).map((u) => u.role))].sort(), [users]);
  const shown = useMemo(() => filterPeople(users || [], query, role), [users, query, role]);
  return (
    <div className="admin-page">
      <AdminHead title="Admin" tab="people" {...head} />
      {!allowed ? <div className="admin-body"><p className="muted">Management only</p></div> : (
        <div className="admin-body">
          <Filters query={query} setQuery={setQuery} role={role} setRole={setRole} roles={roles} />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="admin-table-wrap">
            <table className="admin-table" data-testid="admin-people">
              <thead><tr><th>Person</th><th>Role</th><th>Chat access</th><th>Now</th><th>Blocked from</th><th>Blocked by</th></tr></thead>
              <tbody>
                {users === null ? <tr><td colSpan={6} className="muted">Loading…</td></tr>
                  : shown.length === 0 ? <tr><td colSpan={6} className="muted">No one matches</td></tr>
                  : shown.map((u) => (
                    <tr key={u.id} className="admin-row" data-testid="admin-person" data-user-id={u.id} tabIndex={0} role="link" aria-label={`Open ${u.fullName}`}
                      onClick={() => onOpenUser(u.id)} onKeyDown={(e) => { if (e.key === 'Enter') onOpenUser(u.id); }}>
                      <td><strong>{u.fullName}</strong><div className="muted">{u.email}</div></td>
                      <td>{u.role}</td>
                      <td>{u.chatEnabled ? <span className="pill on">On</span> : <span className="pill" title="Tick “Team chat (beta)” for this person in the CRM: Settings → user → Permissions">Off</span>}</td>
                      <td>{u.online ? <span className="pill on">Online</span> : <span className="muted">—</span>}</td>
                      <td>{u.blockedFrom ? `${u.blockedFrom} ${u.blockedFrom === 1 ? 'person' : 'people'}` : <span className="muted">—</span>}</td>
                      <td>{u.blockedBy ? `${u.blockedBy} ${u.blockedBy === 1 ? 'person' : 'people'}` : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <p className="muted admin-foot">Chat access is switched on per person in the CRM (Settings → user → Permissions → “Team chat (beta)”); Management and IT always have it. Click a person to choose who they can message, call and share private channels with.</p>
        </div>
      )}
    </div>
  );
}

/** Admin → one person: a tick for each other person and each kind of contact. Ticked = allowed. */
export function AdminUserAccess({ userId, onBack, ...head }: PageProps & { userId: number; onBack: () => void }) {
  const { user, actions } = useChat(); const allowed = isManagement(user);
  const { users, error: loadError, reload } = useAdminUsers(allowed);
  const [rows, setRows] = useState<Restriction[] | null>(null);
  const [query, setQuery] = useState(''); const [role, setRole] = useState(''); const [bothWays, setBothWays] = useState(true);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return; let live = true; setRows(null);
    actions.userRestrictions(userId).then((r) => { if (live) setRows(r); }).catch((e: any) => { if (live) { setRows([]); setError(e?.message || 'Could not load restrictions'); } });
    return () => { live = false; };
  }, [allowed, actions, userId]);

  const person = (users || []).find((u) => u.id === userId);
  const others = useMemo(() => (users || []).filter((u) => u.id !== userId), [users, userId]);
  const roles = useMemo(() => [...new Set(others.map((u) => u.role))].sort(), [others]);
  const shown = useMemo(() => filterPeople(others, query, role), [others, query, role]);
  const access = useMemo(() => accessMap(userId, rows || []), [userId, rows]);

  async function change(targetUserIds: number[], kind: AccessKind | 'all', allow: boolean) {
    if (!targetUserIds.length || busy) return;
    setBusy(true); setError(null);
    try { setRows(await actions.setAccess(userId, { targetUserIds, kind, allowed: allow, bothWays })); void reload(); }
    catch (e: any) { setError(e?.message || 'Could not save'); } finally { setBusy(false); }
  }
  const bulk = (allow: boolean) => {
    const n = shown.length; if (!n) return;
    const who = n === others.length ? 'everyone' : `the ${n} ${n === 1 ? 'person' : 'people'} shown`;
    if (!window.confirm(`${allow ? 'Allow' : 'Block'} ${person?.fullName || 'this person'} ${allow ? 'to contact' : 'from contacting'} ${who}${bothWays ? ', both ways' : ''}?`)) return;
    void change(shown.map((u) => u.id), 'all', allow);
  };

  const name = person?.fullName || 'Person';
  return (
    <div className="admin-page">
      <AdminHead title={name} tab="people" onBack={onBack} {...head} />
      {!allowed ? <div className="admin-body"><p className="muted">Management only</p></div> : (
        <div className="admin-body" data-testid="admin-user-access">
          {person && <p className="admin-summary"><strong>{person.fullName}</strong> · {person.role} · chat access {person.chatEnabled ? 'on' : 'off'}{person.online ? ' · online now' : ''}</p>}
          <p className="muted admin-foot">Ticked means {name} is allowed. Untick to block. Public channels are open to everyone in them; these settings cover direct messages, calls and private channels. People who join later are allowed until you untick them.</p>
          <div className="admin-tools">
            <Filters query={query} setQuery={setQuery} role={role} setRole={setRole} roles={roles} />
            <label className="check-row"><input type="checkbox" data-testid="access-both-ways" checked={bothWays} onChange={(e) => setBothWays(e.target.checked)} />Apply both ways</label>
            <button className="btn-ghost btn-small" data-testid="access-allow-all" disabled={busy || !shown.length} onClick={() => bulk(true)}>Allow all shown</button>
            <button className="btn-ghost btn-small danger" data-testid="access-block-all" disabled={busy || !shown.length} onClick={() => bulk(false)}>Block all shown</button>
          </div>
          {(error || loadError) && <p className="error" role="alert">{error || loadError}</p>}
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>Can contact</th><th>Role</th>{ACCESS_KINDS.map((k) => <th key={k} className="center">{KIND_LABEL[k]}</th>)}<th>Other direction</th></tr></thead>
              <tbody>
                {users === null || rows === null ? <tr><td colSpan={6} className="muted">Loading…</td></tr>
                  : shown.length === 0 ? <tr><td colSpan={6} className="muted">No one matches</td></tr>
                  : shown.map((u) => {
                    const a = access.get(u.id) || NO_ACCESS;
                    return (
                      <tr key={u.id} data-testid="access-row" data-user-id={u.id} className={anyBlocked(a.out) ? 'restricted' : undefined}>
                        <td><strong>{u.fullName}</strong></td>
                        <td>{u.role}</td>
                        {ACCESS_KINDS.map((k) => (
                          <td key={k} className="center">
                            <input type="checkbox" data-kind={k} aria-label={`${name} can ${k === 'dm' ? 'message' : k === 'call' ? 'call' : 'share private channels with'} ${u.fullName}`}
                              checked={!a.out[k]} disabled={busy} onChange={(e) => void change([u.id], k, e.target.checked)} />
                          </td>
                        ))}
                        <td>{anyBlocked(a.in) ? <span className="muted">{u.fullName} is blocked: {blockedList(a.in)}</span> : <span className="muted">—</span>}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
