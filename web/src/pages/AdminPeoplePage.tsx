import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminFrame } from '../components/admin/AdminFrame.tsx';
import { PeopleFilters } from '../components/admin/PeopleFilters.tsx';
import { paths } from '../config/routes.ts';
import { useChat } from '../context/chatContext.ts';
import { useAdminUsers } from '../hooks/useAdminUsers.ts';
import type { AdminUser } from '../types/index.ts';
import { filterPeople } from '../utils/access.ts';
import { isManagement, isManagementOrIT } from '../utils/restrictions.ts';
import { dayLabel } from '../utils/format.ts';

const peopleCount = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const DASH = <span className="muted">—</span>;

type RowProps = {
  person: AdminUser;
  onOpen: () => void;
  /** Management only: switch this person off, or on again. */
  onToggle?: (person: AdminUser) => void;
  deactivated?: boolean;
};

function PersonRow({ person, onOpen, onToggle, deactivated }: RowProps) {
  return (
    <tr
      className="admin-row"
      data-testid="admin-person"
      data-user-id={person.id}
      tabIndex={0}
      role="link"
      aria-label={`Open ${person.fullName}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
    >
      <td>
        <strong>{person.fullName}</strong>
        <div className="muted">{person.email}</div>
      </td>
      <td>{person.role}</td>
      <td>
        {person.chatEnabled ? (
          <span className="pill on">On</span>
        ) : (
          <span
            className="pill"
            title="Tick “Team chat (beta)” for this person in the CRM: Settings → user → Permissions"
          >
            Off
          </span>
        )}
      </td>
      <td>
        {person.online ? (
          <span className="pill on">Online</span>
        ) : person.lastSeenAt ? (
          <span className="muted">{dayLabel(person.lastSeenAt)}</span>
        ) : (
          <span
            className="pill never"
            title="Has not signed in to the chat yet, so is not offered when people pick someone"
          >
            Never signed in
          </span>
        )}
      </td>
      <td>
        {person.pushOn ? (
          <span className="pill on">On</span>
        ) : person.lastSeenAt ? (
          <span className="pill off" title="Has not pressed Turn on in the chat yet">
            Off
          </span>
        ) : (
          DASH
        )}
      </td>
      <td>{person.blockedFrom ? peopleCount(person.blockedFrom) : DASH}</td>
      <td>{person.blockedBy ? peopleCount(person.blockedBy) : DASH}</td>
      <td className="center">
        {onToggle && (
          <button
            className={`btn-ghost btn-small${deactivated ? '' : ' danger'}`}
            data-testid={deactivated ? 'reactivate' : 'deactivate'}
            onClick={(e) => {
              e.stopPropagation();
              onToggle(person);
            }}
          >
            {deactivated ? 'Reactivate' : 'Deactivate'}
          </button>
        )}
      </td>
    </tr>
  );
}

/** Admin → People: everyone who can sign in (or, on the Deactivated tab, who cannot), whether chat is on for them, and how restricted they are. */
export function AdminPeoplePage({ deactivated = false }: { deactivated?: boolean }) {
  const { user, actions } = useChat();
  const navigate = useNavigate();
  const { users, error, reload } = useAdminUsers(isManagementOrIT(user), deactivated);
  const [actError, setActError] = useState<string | null>(null);
  // Deactivating signs the person out everywhere at once and bars them from the chat and the CRM until switched on again.
  async function toggle(person: AdminUser) {
    const question = deactivated
      ? `Switch ${person.fullName} back on? They can sign in again.`
      : `Deactivate ${person.fullName}? They are signed out everywhere now and cannot sign in to the chat or the CRM until switched on again.`;
    if (!window.confirm(question)) return;
    setActError(null);
    try {
      if (deactivated) await actions.reactivateUser(person.id);
      else await actions.deactivateUser(person.id);
      await reload();
    } catch (e: any) {
      setActError(e?.message || 'That did not work');
    }
  }
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const roles = useMemo(() => [...new Set((users || []).map((u) => u.role))].sort(), [users]);
  const shown = useMemo(() => filterPeople(users || [], query, role), [users, query, role]);

  return (
    <AdminFrame title={deactivated ? 'Deactivated people' : 'Admin'} tab={deactivated ? 'deactivated' : 'people'}>
      <div className="admin-body">
        <PeopleFilters query={query} onQuery={setQuery} role={role} onRole={setRole} roles={roles} />
        {(error || actError) && (
          <p className="error" role="alert">
            {error || actError}
          </p>
        )}
        {deactivated && (
          <p className="muted admin-foot">
            People who are switched off or were never approved. They cannot sign in, are not offered to anyone, and
            conversations with them are out of sight until they are switched on again.
          </p>
        )}
        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="admin-people">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Chat access</th>
                <th>Signed in</th>
                <th>Notifications</th>
                <th>Blocked from</th>
                <th>Blocked by</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users === null && (
                <tr>
                  <td colSpan={8} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {users !== null && shown.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted">
                    No one matches
                  </td>
                </tr>
              )}
              {shown.map((person) => (
                <PersonRow
                  key={person.id}
                  person={person}
                  deactivated={deactivated}
                  onToggle={isManagement(user) && person.id !== user.id ? toggle : undefined}
                  onOpen={() => navigate(paths.adminUser(person.id))}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted admin-foot">
          Chat access is switched on per person in the CRM (Settings → user → Permissions → “Team chat (beta)”);
          Management and IT always have it. Click a person to choose who they can message, call and share private
          channels with. Someone who has never signed in to the chat is not offered when people pick who to message,
          call or add.
        </p>
      </div>
    </AdminFrame>
  );
}
