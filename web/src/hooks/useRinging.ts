import { useEffect, type MutableRefObject } from 'react';
import type { CallUiState } from '../context/callState.ts';
import type { Preferences } from '../types/index.ts';
import { closeCallNotification, isLookedAt, showCallNotification } from '../utils/notify.ts';
import { startRingtone, stopRingtone } from '../utils/ringtone.ts';

const RINGTONE_MS = 30_000;
const RING_CAP_MS = 35_000; // the server ends an unanswered call after 30 s; this only guards a lost event

/**
 * While a call is ringing in: plays the ringtone (if sound is on), shows a desktop notification when
 * the chat is not being looked at, and stops ringing by itself if the "call ended" event never arrives.
 */
export function useRinging(deps: {
  ringingCallId: string | null;
  callRef: MutableRefObject<CallUiState>;
  prefsRef: MutableRefObject<Preferences>;
  onGiveUp: (callId: string) => void;
}): void {
  const { ringingCallId, callRef, prefsRef, onGiveUp } = deps;
  useEffect(() => {
    if (!ringingCallId) return;
    const incoming = callRef.current.incoming;
    if (prefsRef.current.soundEnabled) startRingtone(RINGTONE_MS);
    // Not being looked at (another tab, another app): a notification with Accept and Decline, kept
    // until answered. Someone looking at the chat already sees the card.
    if (incoming && !isLookedAt({ hidden: document.hidden, focused: document.hasFocus() }))
      void showCallNotification(incoming);
    const cap = setTimeout(() => onGiveUp(ringingCallId), RING_CAP_MS);
    return () => {
      clearTimeout(cap);
      stopRingtone();
      void closeCallNotification(ringingCallId);
    };
  }, [ringingCallId]); // eslint-disable-line react-hooks/exhaustive-deps
}
