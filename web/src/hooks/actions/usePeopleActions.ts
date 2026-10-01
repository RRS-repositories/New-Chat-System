import { useCallback } from 'react';
import type { PreferencePatch } from '../../services/chatApi.ts';
import type { Preferences } from '../../types/index.ts';
import { withSelfSorted } from '../../utils/restrictions.ts';
import type { ActionDeps } from './actionDeps.ts';

/** Actions about people and the signed-in person's own settings. */
export function usePeopleActions({ chatApi, user, dispatch, stateRef }: ActionDeps) {
  /** The people the signed-in person can pick from (never includes themselves). */
  const listUsers = useCallback(() => chatApi.users(), [chatApi]);

  /** The same list with the signed-in person added back, sorted by name (the admin pickers need them). */
  const allUsers = useCallback(
    async () => withSelfSorted(await chatApi.users(), { id: user.id, fullName: user.fullName, role: user.role }),
    [chatApi, user.id, user.fullName, user.role],
  );

  /** Shown at once; the changed settings are put back and the error rethrown if the server refuses. */
  const updatePrefs = useCallback(
    async (patch: PreferencePatch) => {
      const before = stateRef.current.prefs;
      dispatch({ type: 'prefs_set', prefs: { ...before, ...patch } });
      try {
        const saved = await chatApi.updatePreferences(patch);
        dispatch({ type: 'prefs_set', prefs: { ...stateRef.current.prefs, ...saved } });
      } catch (e) {
        const undo = Object.fromEntries(Object.keys(patch).map((key) => [key, before[key as keyof Preferences]]));
        dispatch({ type: 'prefs_set', prefs: { ...stateRef.current.prefs, ...undo } });
        throw e;
      }
    },
    [chatApi, dispatch, stateRef],
  );

  const setStatus = useCallback(
    async (text: string, emoji: string) => {
      const status = (await chatApi.setStatus(text, emoji)) || { text, emoji };
      dispatch({
        type: 'prefs_set',
        prefs: { ...stateRef.current.prefs, statusText: status.text, statusEmoji: status.emoji },
      });
      dispatch({ type: 'user_status', userId: user.id, text: status.text, emoji: status.emoji });
    },
    [chatApi, dispatch, stateRef, user.id],
  );

  return { listUsers, allUsers, updatePrefs, setStatus };
}
