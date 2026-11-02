import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceRecorder, voiceNoteName, type VoiceDeps, type VoiceNote } from '../services/voiceNote.ts';

export type VoicePhase = 'idle' | 'asking' | 'recording' | 'preview' | 'sending';

type Options = {
  /** Sends the finished note (a File named "Voice note …") into the conversation. */
  onSend: (file: File, note: VoiceNote) => Promise<void>;
  deps?: VoiceDeps;
};

/**
 * The composer's voice note: ask for the microphone, record with a running clock, then either
 * listen back first or send straight away. Discard at any point lets the microphone go.
 */
export function useVoiceNote({ onSend, deps }: Options) {
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [secs, setSecs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<VoiceNote | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [hitLimit, setHitLimit] = useState(false);
  const rec = useRef<VoiceRecorder | null>(null);
  const clock = useRef<ReturnType<typeof setInterval> | null>(null);
  const url = useRef<string | null>(null);

  const stopClock = () => {
    if (clock.current) clearInterval(clock.current);
    clock.current = null;
  };
  const dropPreview = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
    setPreviewUrl(null);
  };
  const reset = useCallback(() => {
    stopClock();
    dropPreview();
    rec.current = null;
    setNote(null);
    setSecs(0);
    setHitLimit(false);
    setPhase('idle');
  }, []);

  /** Stops the recording and shows it for listening back. */
  const stop = useCallback(async () => {
    const current = rec.current;
    if (!current) return;
    stopClock();
    const got = await current.stop();
    if (rec.current !== current) return; // discarded meanwhile
    if (!got) return reset();
    setNote(got);
    const u = URL.createObjectURL(got.blob);
    url.current = u;
    setPreviewUrl(u);
    setPhase('preview');
  }, [reset]);

  const start = useCallback(async () => {
    if (rec.current) return;
    setError(null);
    setHitLimit(false);
    const next = new VoiceRecorder({
      ...deps,
      onLimit: () => {
        setHitLimit(true);
        void stop();
      },
    });
    rec.current = next;
    setPhase('asking');
    try {
      await next.start();
    } catch (e: any) {
      if (rec.current === next) {
        rec.current = null;
        setPhase('idle');
        setError(e?.message || 'The microphone could not be used.');
      }
      return;
    }
    if (rec.current !== next) return; // discarded while the permission prompt was up
    setSecs(0);
    setPhase('recording');
    clock.current = setInterval(() => setSecs(next.elapsedSecs()), 250);
  }, [deps, stop]);

  const discard = useCallback(() => {
    const current = rec.current;
    rec.current = null;
    current?.cancel();
    reset();
  }, [reset]);

  /** Sends what there is: straight from recording, or the note being listened to. */
  const send = useCallback(async () => {
    let ready = note;
    const current = rec.current;
    if (!ready && current) {
      stopClock();
      ready = await current.stop();
      if (rec.current !== current) return;
      if (!ready) return reset();
      setNote(ready);
    }
    if (!ready) return;
    setPhase('sending');
    setError(null);
    try {
      await onSend(new File([ready.blob], voiceNoteName(new Date(), ready.ext), { type: ready.type }), ready);
      reset();
    } catch (e: any) {
      // Keep the note: the person can try again or save it by listening back.
      if (!url.current) {
        const u = URL.createObjectURL(ready.blob);
        url.current = u;
        setPreviewUrl(u);
      }
      setError(e?.message || 'The voice note could not be sent');
      setPhase('preview');
    }
  }, [note, onSend, reset]);

  const level = useCallback(() => rec.current?.level() ?? 0, []);

  // Leaving the conversation mid-recording lets the microphone go.
  useEffect(
    () => () => {
      rec.current?.cancel();
      stopClock();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );

  return {
    phase,
    secs,
    error,
    note,
    previewUrl,
    hitLimit,
    start,
    stop,
    discard,
    send,
    level,
    clearError: () => setError(null),
  };
}
export type VoiceNoteControl = ReturnType<typeof useVoiceNote>;
