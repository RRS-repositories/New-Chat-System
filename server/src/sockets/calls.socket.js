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
  socket.on('disconnect', () => {
    try {
      calls.onSocketDisconnect(socket.id, user.id);
    } catch (e) {
      console.error('[chat] call disconnect handling failed', e?.message || e);
    }
  });
}
