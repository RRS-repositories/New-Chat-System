import { useCallback, useEffect, useState } from 'react';
import { AdminFrame } from '../components/admin/AdminFrame.tsx';
import { useChat } from '../context/chatContext.ts';
import type { Restriction, RestrictionType, UserOption } from '../types/index.ts';
import {
  RESTRICTION_TYPES,
  isManagement,
  restrictionRow,
  toRestrictionInput,
  typeLabel,
  validateRestrictionForm,
} from '../utils/restrictions.ts';

export const PICKER_FOOTNOTE =
  'The people lists come from the chat user list, which leaves out anyone you yourself are restricted from contacting, so they cannot be picked here. Every restriction is still listed in the table.';

/** Management-only page: who is blocked from contacting whom (/admin/restrictions). */
export function RestrictionsPage() {
  const { user, actions } = useChat();
  const allowed = isManagement(user);
  const [rows, setRows] = useState<Restriction[] | null>(null);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [targetUserId, setTargetUserId] = useState<number | null>(null);
  const [restriction, setRestriction] = useState<RestrictionType>('all');
  const [bothWays, setBothWays] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await actions.listRestrictions());
      setLoadError(null);
    } catch (e: any) {
      setRows((r) => r ?? []);
      setLoadError(e?.message || 'Could not load restrictions');
    }
  }, [actions]);
  useEffect(() => {
    if (!allowed) return;
    void refresh();
    let live = true;
    actions
      .allUsers()
      .then((u) => {
        if (live) setUsers(u);
      })
      .catch(() => {
        if (live) setUsers([]);
      });
    return () => {
      live = false;
    };
  }, [allowed, actions, refresh]);

  async function add() {
    const problem = validateRestrictionForm({ userId, targetUserId, restriction });
    if (problem) {
      setFormError(problem);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await actions.addRestriction(
        toRestrictionInput({ userId: userId!, targetUserId: targetUserId!, restriction, reason, bothWays }),
      );
      setReason('');
      setBothWays(false);
      setTargetUserId(null);
      await refresh();
    } catch (e: any) {
      setFormError(e?.message || 'Could not add restriction');
    } finally {
      setSaving(false);
    }
  }
  async function remove(r: Restriction) {
    const d = restrictionRow(r);
    if (!confirm(`Remove this restriction?\n\n${d.user} ${d.blockedFrom} ${d.target} (${d.type})`)) return;
    setRemoving(r.id);
    setRowError(null);
    try {
      await actions.removeRestriction(r.id);
      await refresh();
    } catch (e: any) {
      setRowError(e?.message || 'Could not remove restriction');
    } finally {
      setRemoving(null);
    }
  }

  const pick = (v: string) => (v ? Number(v) : null);
  return (
    <AdminFrame title="Admin" tab="restrictions">
      <div className="admin-body">
        <section className="admin-form" aria-label="Add restriction">
          <h2>Add a restriction</h2>
          <div className="admin-form-grid">
            <label className="field">
              <span>User</span>
              <select value={userId ?? ''} onChange={(e) => setUserId(pick(e.target.value))}>
                <option value="">Choose…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Blocked from contacting</span>
              <select value={targetUserId ?? ''} onChange={(e) => setTargetUserId(pick(e.target.value))}>
                <option value="">Choose…</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Type</span>
              <select value={restriction} onChange={(e) => setRestriction(e.target.value as RestrictionType)}>
                {RESTRICTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {typeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Reason</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Optional" />
            </label>
          </div>
          <label className="row gap muted">
            <input type="checkbox" checked={bothWays} onChange={(e) => setBothWays(e.target.checked)} /> Block both ways
          </label>
          {formError && <p className="error">{formError}</p>}
          <div className="row gap end">
            <button className="btn-accent" disabled={saving} onClick={() => void add()}>
              {saving ? 'Saving…' : 'Add restriction'}
            </button>
          </div>
        </section>

        {loadError && <p className="error">{loadError}</p>}
        {rowError && <p className="error">{rowError}</p>}
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>User</th>
                <th>Blocked from</th>
                <th>Target</th>
                <th>Type</th>
                <th>Set by</th>
                <th>Date</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {rows === null && (
                <tr>
                  <td colSpan={7} className="muted">
                    Loading…
                  </td>
                </tr>
              )}
              {rows?.length === 0 && !loadError && (
                <tr>
                  <td colSpan={7} className="muted">
                    No restrictions
                  </td>
                </tr>
              )}
              {rows?.map((r) => {
                const d = restrictionRow(r);
                return (
                  <tr key={r.id}>
                    <td>{d.user}</td>
                    <td className="muted">{d.blockedFrom}</td>
                    <td>{d.target}</td>
                    <td title={d.reason || undefined}>
                      {d.type}
                      {d.reason && <div className="muted">{d.reason}</div>}
                    </td>
                    <td>{d.setBy}</td>
                    <td>{d.date}</td>
                    <td>
                      <button className="btn-ghost" disabled={removing !== null} onClick={() => void remove(r)}>
                        {removing === r.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted admin-foot">{PICKER_FOOTNOTE}</p>
      </div>
    </AdminFrame>
  );
}
