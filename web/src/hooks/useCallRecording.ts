import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { Socket } from 'socket.io-client';
import type { CallUiState } from '../context/callState.ts';
import type { CallApi } from '../services/callApi.ts';
import type { CallSnapshot } from '../services/callManager.ts';
import { CallRecorder, canRecord } from '../services/callRecorder.ts';
import { MAX_FILE_BYTES } from '../utils/files.ts';
import { useLatest } from './useLatest.ts';

export type RecordingState = { by: number; since: number } | null;
const CONFIRM_WITHIN_MS = 5000;

const two = (n: number) => String(n).padStart(2, '0');
/** "Call recording 2026-10-05 14.30.webm" */
export function recordingFileName(at: Date): string {
  const day = `${at.getFullYear()}-${two(at.getMonth() + 1)}-${two(at.getDate())}`;
  return `Call recording ${day} ${two(at.getHours())}.${two(at.getMinutes())}.webm`;
}

/** Every live voice in the call, this person's own included. */
function voicesOf(snapshot: CallSnapshot): MediaStreamTrack[] {
  return [snapshot.ownAudioTrack, ...snapshot.participants.map((p) => p.audioTrack)].filter(
    Boolean,
  ) as unknown as MediaStreamTrack[];
}
const screenOf = (snapshot: CallSnapshot) =>
  (snapshot.participants.find((p) => p.screenTrack)?.screenTrack ??
    snapshot.ownScreenTrack ??
    null) as unknown as MediaStreamTrack | null;

type Deps = {
  socket: Socket;
  callApi: CallApi;
  userId: number;
  callId: MutableRefObject<string | null>;
  ui: MutableRefObject<CallUiState>;
  snapshot: CallSnapshot;
  /** Says something to this person outside the call screen (the call may be over by then). */
  tell: (text: string) => void;
  setPanelError: (text: string | null) => void;
};

/**
 * Recording a call. The flag ("this call is being recorded") lives on the server and is shown to
 * everyone; the recording itself is made here, in the host's tab, and saved into the call's
 * conversation when it stops, including when the host leaves or the call ends.
 */
export function useCallRecording({ socket, callApi, userId, callId, ui, snapshot, tell, setPanelError }: Deps) {
  const [recording, setRecording] = useState<RecordingState>(null);
  const recorder = useRef<CallRecorder | null>(null);
  const where = useRef<{ callId: string; channelId: string } | null>(null);
  const confirmed = useRef(false);
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotRef = useLatest(snapshot);

  /** Stops this tab's recording (if any) and saves it. `save: false` throws it away. */
  const finish = useCallback(
    ({ save = true }: { save?: boolean } = {}) => {
      const current = recorder.current;
      const target = where.current;
      if (!current || !target) return;
      recorder.current = null;
      where.current = null;
      confirmed.current = false;
      if (confirmTimer.current) clearTimeout(confirmTimer.current);
      if (callId.current === target.callId) socket.emit('call_rec', { call_id: target.callId, on: false });
      current
        .stop()
        .then(async (result) => {
          if (!result || !save) return;
          const file = new File([result.blob], recordingFileName(new Date()), { type: 'video/webm' });
          await callApi.uploadRecording(target.channelId, file, target.callId, result.durationSecs);
          tell(
            result.hitLimit
              ? 'The recording reached the 20 MB limit. It was stopped and saved to the conversation.'
              : 'Recording saved to the conversation',
          );
        })
        .catch((e) => tell(e?.message || 'The recording could not be saved'));
    },
    [socket, callApi, callId, tell],
  );

  const start = useCallback(() => {
    const id = callId.current;
    const channelId = ui.current.channelId;
    if (!id || !channelId || recorder.current) return;
    if (!canRecord()) return setPanelError('This browser cannot record calls');
    const next = new CallRecorder({ maxBytes: MAX_FILE_BYTES, onLimit: () => finish() });
    try {
      next.start(voicesOf(snapshotRef.current), screenOf(snapshotRef.current));
    } catch (e: any) {
      return setPanelError(e?.message || 'Recording could not start');
    }
    recorder.current = next;
    where.current = { callId: id, channelId };
    confirmed.current = false;
    setPanelError(null);
    socket.emit('call_rec', { call_id: id, on: true });
    // The server tells everyone, this tab included. No word back means it refused: nothing is kept.
    confirmTimer.current = setTimeout(() => {
      if (recorder.current !== next || confirmed.current) return;
      finish({ save: false });
      setPanelError('Recording could not start. Only the host can record.');
    }, CONFIRM_WITHIN_MS);
  }, [socket, callId, ui, snapshotRef, finish, setPanelError]);

  const toggleRecording = useCallback(() => {
    if (recorder.current) finish();
    else start();
  }, [finish, start]);

  // People joining and leaving: their voices join and leave the mix.
  useEffect(() => {
    recorder.current?.setAudioTracks(voicesOf(snapshot));
  }, [snapshot]);

  // The flag as everyone sees it. If it goes off while this tab is recording (the host stopped it), save what there is.
  useEffect(() => {
    if (!recorder.current) return;
    if (recording?.by === userId) confirmed.current = true;
    else if (confirmed.current && !recording) finish();
  }, [recording, userId, finish]);

  return { recording, setRecording, toggleRecording, finishRecording: finish };
}
