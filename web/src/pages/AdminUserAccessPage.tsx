import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { AdminFrame } from '../components/admin/AdminFrame.tsx';
import { PeopleFilters } from '../components/admin/PeopleFilters.tsx';
import { paths } from '../config/routes.ts';
import { useChat } from '../context/chatContext.ts';
import { useAdminUsers } from '../hooks/useAdminUsers.ts';
import type { AdminUser, Restriction } from '../types/index.ts';
import {
  ACCESS_KINDS,
  KIND_LABEL,
  accessMap,
  anyBlocked,
  blockedList,
  filterPeople,
  type AccessKind,
  type PairAccess,
} from '../utils/access.ts';
import { isManagement, isManagementOrIT } from '../utils/restrictions.ts';
import { SetPassword } from '../components/admin/SetPassword.tsx';

const ALLOWED: PairAccess = {
  out: { dm: false, call: false, channel: false },
  in: { dm: false, call: false, channel: false },
};
const VERB: Record<AccessKind, string> = { dm: 'message', call: 'call', channel: 'share private channels with' };

type RowProps = {
  subjectName: string;
  other: AdminUser;
  access: PairAccess;
  disabled: boolean;
  onChange: (kind: AccessKind, allowed: boolean) => void;
};

/** One other person: a tick per kind of contact (ticked = allowed), and what they are blocked from in return. */
function AccessRow({ subjectName, other, access, disabled, onChange }: RowProps) {
  return (
    <tr data-testid="access-row" data-user-id={other.id} className={anyBlocked(access.out) ? 'restricted' : undefined}>
      <td>
        <strong>{other.fullName}</strong>
      </td>
      <td>{other.role}</td>
      {ACCESS_KINDS.map((kind) => (
        <td key={kind} className="center">
          <input
            type="checkbox"
            data-kind={kind}
            aria-label={`${subjectName} can ${VERB[kind]} ${other.fullName}`}
            checked={!access.out[kind]}
            disabled={disabled}
            onChange={(e) => onChange(kind, e.target.checked)}
          />
        </td>
      ))}
      <td>
        <span className="muted">
          {anyBlocked(access.in) ? `${other.fullName} is blocked: ${blockedList(access.in)}` : '—'}
        </span>
      </td>
    </tr>
  );
}

/** Admin → one person: who they may message, call and share private channels with. */
export function AdminUserAccessPage() {
  const { userId: userIdParam = '' } = useParams();
  const userId = /^\d+$/.test(userIdParam) ? Number(userIdParam) : null;
  const { user, actions } = useChat();
  const navigate = useNavigate();
  // Management see everything here; IT see the person and may set their password.
  const allowed = isManagement(user);
  const { users, error: loadError, reload } = useAdminUsers(isManagementOrIT(user));
  const [restrictions, setRestrictions] = useState<Restriction[] | null>(null);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [bothWays, setBothWays] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed || userId === null) return;
    let live = true;
    setRestrictions(null);
    actions
      .userRestrictions(userId)
      .then((rows) => {
        if (live) setRestrictions(rows);
      })
      .catch((e: any) => {
        if (!live) return;
        setRestrictions([]);
        setError(e?.message || 'Could not load restrictions');
      });
    return () => {
      live = false;
    };
  }, [allowed, actions, userId]);

  const subject = (users || []).find((u) => u.id === userId);
  const others = useMemo(() => (users || []).filter((u) => u.id !== userId), [users, userId]);
  const roles = useMemo(() => [...new Set(others.map((u) => u.role))].sort(), [others]);
  const shown = useMemo(() => filterPeople(others, query, role), [others, query, role]);
  const access = useMemo(
    () => (userId === null ? new Map() : accessMap(userId, restrictions || [])),
    [userId, restrictions],
  );

  if (userId === null) return <Navigate to={paths.admin} replace />;
  const name = subject?.fullName || 'Person';

  async function change(targetUserIds: number[], kind: AccessKind | 'all', allow: boolean) {
    if (!targetUserIds.length || busy || userId === null) return;
    setBusy(true);
    setError(null);
    try {
      setRestrictions(await actions.setAccess(userId, { targetUserIds, kind, allowed: allow, bothWays }));
      void reload();
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  function changeAllShown(allow: boolean) {
    if (!shown.length) return;
    const who =
      shown.length === others.length
        ? 'everyone'
        : `the ${shown.length} ${shown.length === 1 ? 'person' : 'people'} shown`;
    const question = `${allow ? 'Allow' : 'Block'} ${name} ${allow ? 'to contact' : 'from contacting'} ${who}${bothWays ? ', both ways' : ''}?`;
    if (window.confirm(question))
      void change(
        shown.map((u) => u.id),
        'all',
        allow,
      );
  }

  const loading = users === null || restrictions === null;
  return (
    <AdminFrame title={name} tab="people" onBack={() => navigate(paths.admin)}>
      <div className="admin-body" data-testid="admin-user-access">
        {subject && (
          <p className="admin-summary">
            <strong>{subject.fullName}</strong> · {subject.role} · chat access {subject.chatEnabled ? 'on' : 'off'}
            {subject.online ? ' · online now' : subject.lastSeenAt ? '' : ' · never signed in to the chat'}
          </p>
        )}
        {subject && user.id !== subject.id && <SetPassword userId={subject.id} name={subject.fullName} />}
        {!allowed && <p className="muted admin-foot">Who {name} may contact is set by Management.</p>}
        {allowed && (
          <>
            <p className="muted admin-foot">
              Ticked means {name} is allowed. Untick to block. Public channels are open to everyone in them; these
              settings cover direct messages, calls and private channels. People who join later are allowed until you
              untick them.
            </p>
            <div className="admin-tools">
              <PeopleFilters query={query} onQuery={setQuery} role={role} onRole={setRole} roles={roles} />
              <label className="check-row">
                <input
                  type="checkbox"
                  data-testid="access-both-ways"
                  checked={bothWays}
                  onChange={(e) => setBothWays(e.target.checked)}
                />
                Apply both ways
              </label>
              <button
                className="btn-ghost btn-small"
                data-testid="access-allow-all"
                disabled={busy || !shown.length}
                onClick={() => changeAllShown(true)}
              >
                Allow all shown
              </button>
              <button
                className="btn-ghost btn-small danger"
                data-testid="access-block-all"
                disabled={busy || !shown.length}
                onClick={() => changeAllShown(false)}
              >
                Block all shown
              </button>
            </div>
          </>
        )}
        {(error || loadError) && (
          <p className="error" role="alert">
            {error || loadError}
          </p>
        )}
        {allowed && (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Can contact</th>
                  <th>Role</th>
                  {ACCESS_KINDS.map((kind) => (
                    <th key={kind} className="center">
                      {KIND_LABEL[kind]}
                    </th>
                  ))}
                  <th>Other direction</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={6} className="muted">
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && shown.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      No one matches
                    </td>
                  </tr>
                )}
                {!loading &&
                  shown.map((other) => (
                    <AccessRow
                      key={other.id}
                      subjectName={name}
                      other={other}
                      access={access.get(other.id) || ALLOWED}
                      disabled={busy}
                      onChange={(kind, allow) => void change([other.id], kind, allow)}
                    />
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminFrame>
  );
}
