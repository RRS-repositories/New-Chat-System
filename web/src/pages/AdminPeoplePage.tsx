import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AdminFrame } from '../components/admin/AdminFrame.tsx';
import { PeopleFilters } from '../components/admin/PeopleFilters.tsx';
import { paths } from '../config/routes.ts';
import { useChat } from '../context/chatContext.ts';
import { useAdminUsers } from '../hooks/useAdminUsers.ts';
import type { AdminUser } from '../types/index.ts';
import { filterPeople } from '../utils/access.ts';
import { isManagement } from '../utils/restrictions.ts';

const peopleCount = (n: number) => `${n} ${n === 1 ? 'person' : 'people'}`;
const DASH = <span className="muted">—</span>;

function PersonRow({ person, onOpen }: { person: AdminUser; onOpen: () => void }) {
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
          <span className="pill" title="Tick “Team chat (beta)” for this person in the CRM: Settings → user → Permissions">
            Off
          </span>
        )}
      </td>
      <td>{person.online ? <span className="pill on">Online</span> : DASH}</td>
      <td>{person.blockedFrom ? peopleCount(person.blockedFrom) : DASH}</td>
      <td>{person.blockedBy ? peopleCount(person.blockedBy) : DASH}</td>
    </tr>
  );
}

/** Admin → People: everyone who can sign in, whether chat is on for them, and how restricted they are. */
export function AdminPeoplePage() {
  const { user } = useChat();
  const navigate = useNavigate();
  const { users, error } = useAdminUsers(isManagement(user));
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const roles = useMemo(() => [...new Set((users || []).map((u) => u.role))].sort(), [users]);
  const shown = useMemo(() => filterPeople(users || [], query, role), [users, query, role]);

  return (
    <AdminFrame title="Admin" tab="people">
      <div className="admin-body">
        <PeopleFilters query={query} onQuery={setQuery} role={role} onRole={setRole} roles={roles} />
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="admin-table-wrap">
          <table className="admin-table" data-testid="admin-people">
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Chat access</th>
                <th>Now</th>
                <th>Blocked from</th>
                <th>Blocked by</th>
              </tr>
            </thead>
            <tbody>
              {users === null && (
                <tr>
                  <td colSpan={6} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {users !== null && shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No one matches
                  </td>
                </tr>
              )}
              {shown.map((person) => (
                <PersonRow key={person.id} person={person} onOpen={() => navigate(paths.adminUser(person.id))} />
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted admin-foot">
          Chat access is switched on per person in the CRM (Settings → user → Permissions → “Team chat (beta)”);
          Management and IT always have it. Click a person to choose who they can message, call and share private
          channels with.
        </p>
      </div>
    </AdminFrame>
  );
}
