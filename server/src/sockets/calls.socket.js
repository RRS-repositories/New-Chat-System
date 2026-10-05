/**
 * WebRTC signalling relay and call-device disconnect handling for one connection.
 * The call service decides whether a signal is delivered (sender's call socket → target's
 * call socket, ≤ 64 KB); anything else is dropped silently. `calls` may be null (unit tests).
 */
export function attachCallSignalling({ socket, user, calls }) {
  if (!calls) return;
  socket.on('webrtc_signal', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const { call_id, to_user_id, signal_data } = payload;
    try {
      calls.relaySignal({
        fromSocketId: socket.id,
        fromUserId: user.id,
        callId: call_id,
        toUserId: to_user_id,
        signalData: signal_data,
      });
    } catch (e) {
      console.error('[chat] webrtc_signal relay failed', e?.message || e);
    }
  });
  // In-call extras. Each is checked by the call service (the sender must be in that call, on this
  // connection); a bad or unwanted one is dropped without an answer.
  const relay = (event, run) =>
    socket.on(event, (payload) => {
      if (!payload || typeof payload !== 'object' || typeof payload.call_id !== 'string') return;
      try {
        run({ callId: payload.call_id, userId: user.id, socketId: socket.id }, payload);
      } catch (e) {
        console.error(`[chat] ${event} failed`, e?.message || e);
      }
    });
  relay('call_reaction', (who, p) => calls.react?.({ ...who, emoji: p.emoji }));
  relay('call_hand', (who, p) => calls.setHand?.({ ...who, up: p.up === true }));
  relay('call_wb', (who, p) => {
    Promise.resolve(calls.whiteboard?.({ ...who, op: p.op })).catch((e) =>
      console.error('[chat] call_wb failed', e?.message || e),
    );
  });

  socket.on('disconnect', () => {
    try {
      calls.onSocketDisconnect(socket.id, user.id);
    } catch (e) {
      console.error('[chat] call disconnect handling failed', e?.message || e);
    }
  });
}
