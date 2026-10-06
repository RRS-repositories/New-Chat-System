import { useCallback, useEffect, useState } from 'react';
import { useChat } from '../context/chatContext.ts';
import type { AdminUser } from '../types/index.ts';

/** The admin panel's list of people. Loads only when `allowed` (Management). `users` is null while loading. */
export function useAdminUsers(allowed: boolean, deactivated = false) {
  const { actions } = useChat();
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setUsers(await actions.adminUsers(deactivated));
      setError(null);
    } catch (e: any) {
      setUsers((current) => current ?? []);
      setError(e?.message || 'Could not load people');
    }
  }, [actions, deactivated]);

  useEffect(() => {
    if (allowed) void reload();
  }, [allowed, reload]);

  return { users, error, reload };
}
