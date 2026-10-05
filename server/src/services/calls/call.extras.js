/**
 * What happens inside a live call besides the audio: reactions and raised hands.
 *
 * All of it is kept in memory for the life of the call and relayed only to the people in it, the
 * same way call set-up messages are. Nothing here is stored in the database.
 * A request is honoured only when it comes from the sender's own call device (the tab that is in
 * the call); anything else is dropped without an answer.
 */
export const REACTION_BURST = 5; // at most this many reactions…
export const REACTION_WINDOW_MS = 3000; // …in this long, per person
const EMOJI_MAX_CODE_POINTS = 8;

/** One emoji: short, and not ordinary text (so the relay cannot be used to push words onto screens). */
export function isEmoji(value) {
  if (typeof value !== 'string') return false;
  const length = [...value].length;
  return length >= 1 && length <= EMOJI_MAX_CODE_POINTS && /\p{Extended_Pictographic}/u.test(value);
}

export function createCallExtras({ devices, toCall, now }) {
  const hands = new Map(); // callId -> Set(userId) with a hand up
  const recent = new Map(); // `${callId}:${userId}` -> times of their latest reactions

  const fromCallDevice = (callId, userId, socketId) =>
    typeof socketId === 'string' && devices.get(callId)?.get(userId) === socketId;

  return {
    /** What a person joining needs to draw the call as it is now. */
    snapshot(callId) {
      return { hands: [...(hands.get(callId) || [])] };
    },

    /** A reaction floats up on everyone's call screen. Returns false when it was dropped. */
    react({ callId, userId, socketId, emoji }) {
      if (!fromCallDevice(callId, userId, socketId) || !isEmoji(emoji)) return false;
      const key = `${callId}:${userId}`;
      const t = now();
      const times = (recent.get(key) || []).filter((at) => t - at < REACTION_WINDOW_MS);
      if (times.length >= REACTION_BURST) return false;
      times.push(t);
      recent.set(key, times);
      toCall(callId, 'call_reaction', { call_id: callId, from_user_id: userId, emoji });
      return true;
    },

    /** Raise or lower a hand. Everyone in the call is told only when it actually changed. */
    setHand({ callId, userId, socketId, up }) {
      if (!fromCallDevice(callId, userId, socketId)) return false;
      const raised = hands.get(callId) || new Set();
      const wanted = up === true;
      if (raised.has(userId) === wanted) return true;
      if (wanted) raised.add(userId);
      else raised.delete(userId);
      hands.set(callId, raised);
      toCall(callId, 'call_hand_changed', { call_id: callId, user_id: userId, up: wanted });
      return true;
    },

    /** Someone left the call: their hand goes down with them. */
    onLeft(callId, userId) {
      recent.delete(`${callId}:${userId}`);
      if (hands.get(callId)?.delete(userId))
        toCall(callId, 'call_hand_changed', { call_id: callId, user_id: userId, up: false });
    },

    /** The call is over. */
    forget(callId) {
      hands.delete(callId);
      for (const key of recent.keys()) if (key.startsWith(`${callId}:`)) recent.delete(key);
    },
  };
}
