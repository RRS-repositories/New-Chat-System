import { useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { ApiClient } from '../services/apiClient.ts';
import type { PresenceSnapshot } from '../types/index.ts';
import type { Action } from '../context/chatReducer.ts';
import { backFromAway, computeAway } from '../utils/presence.ts';

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;

/**
 * Presence: snapshot on every (re)connect, then user_* events. Also reports our
 * own away state: `set_away { away: true }` after 5 minutes without input in the
 * chat or 5 minutes of it not being looked at; `{ away: false }` on the next input
 * or when the chat is looked at again. All failures are silent: presence is
 * decoration, chat works without it.
 */
export function usePresence({ api, socket, dispatch, looking, notLookingSince }: { api: ApiClient; socket: Socket; dispatch: Dispatch<Action>; looking: boolean; notLookingSince: MutableRefObject<number | null> }) {
  const lastInput = useRef(Date.now()); const sentAway = useRef(false);
  const comeBack = useRef<() => void>(() => {});
  useEffect(() => {
    let live = true;
    const load = () => { api.get<PresenceSnapshot>('/api/chat/users/online').then((r) => { if (live) dispatch({ type: 'presence_loaded', snapshot: r }); }).catch(() => {}); };
    const onOnline = (p: { user_id: number }) => dispatch({ type: 'user_online', userId: Number(p.user_id) });
    const onOffline = (p: { user_id: number }) => dispatch({ type: 'user_offline', userId: Number(p.user_id) });
    const onAway = (p: { user_id: number; away: boolean }) => dispatch({ type: 'user_away', userId: Number(p.user_id), away: !!p.away });
    const onStatus = (p: { user_id: number; text?: string; emoji?: string }) => dispatch({ type: 'user_status', userId: Number(p.user_id), text: p.text || '', emoji: p.emoji || '' });

    const check = () => {
      if (!sentAway.current && socket.connected && computeAway({ now: Date.now(), lastInputAt: lastInput.current, notLookingSince: notLookingSince.current })) { sentAway.current = true; socket.emit('set_away', { away: true }); }
    };
    // Input while the chat has long been out of view (e.g. a mouse over an
    // unfocused window) does not bring us back; that would just flap.
    const active = () => {
      const now = Date.now(); lastInput.current = now;
      if (backFromAway({ sentAway: sentAway.current, now, lastInputAt: now, notLookingSince: notLookingSince.current })) { sentAway.current = false; socket.emit('set_away', { away: false }); }
    };
    comeBack.current = active;
    // A new socket starts "not away" on the server, so reset on connect.
    const onConnect = () => { sentAway.current = false; load(); check(); };

    const handlers: Array<[string, (...a: any[]) => void]> = [['connect', onConnect], ['user_online', onOnline], ['user_offline', onOffline], ['user_away', onAway], ['user_status', onStatus]];
    for (const [ev, fn] of handlers) socket.on(ev, fn);
    for (const ev of INPUT_EVENTS) window.addEventListener(ev, active, { capture: true, passive: true });
    const t = setInterval(check, 30_000);
    if (socket.connected) load();
    return () => {
      live = false; clearInterval(t); comeBack.current = () => {};
      for (const [ev, fn] of handlers) socket.off(ev, fn);
      for (const ev of INPUT_EVENTS) window.removeEventListener(ev, active, { capture: true });
    };
  }, [api, socket, dispatch, notLookingSince]);
  // Looked at again (focus after a pointerdown that came first, or just
  // switching back to the tab to read): same "I'm back" path as input.
  useEffect(() => { if (looking) comeBack.current(); }, [looking]);
}
