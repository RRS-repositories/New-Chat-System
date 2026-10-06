import { useCallback, useEffect, useState } from 'react';
import { useChat } from '../context/chatContext.ts';
import type { AdminUser } from '../types/index.ts';

/**
 * The admin panel's list of people. Loads only when `allowed` (Management or IT). `users` is null while
 * loading. `gate` says whether the chat.beta permission is being enforced (what "Chat access" means).
 */
export function useAdminUsers(allowed: boolean, deactivated = false) {
  const { actions } = useChat();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gate, setGate] = useState(true);

  const reload = useCallback(async () => {
    try {
      const r = await actions.adminUsers(deactivated);
      setUsers(r.users);
      setGate(r.gate);
      setError(null);
    } catch (e: any) {
      setUsers((current) => current ?? []);
      setError(e?.message || 'Could not load people');
    }
  }, [actions, deactivated]);

  useEffect(() => {
    if (allowed) void reload();
  }, [allowed, reload]);

  return { users, gate, error, reload };
}
