import { useEffect, useRef, useState } from 'react';
import type { TrackLike } from '../services/callManager.ts';

export type VoiceSource = { userId: number; track: TrackLike | null; muted: boolean };

const CHECK_EVERY_MS = 160;
/** How loud counts as speaking (0 to 1, the average swing of the sound wave). */
const LOUD = 0.035;
/** Keep the light on this long after the last loud moment, so it does not flicker between words. */
const HOLD_MS = 500;

type Listener = { track: TrackLike; source: MediaStreamAudioSourceNode; analyser: AnalyserNode; lastLoud: number };

const sameSet = (a: Set<number>, b: Set<number>) => a.size === b.size && [...a].every((id) => b.has(id));

/**
 * Who is speaking right now, worked out in the browser by listening to each person's audio.
 * Nothing is sent anywhere; it only lights the green ring on a call tile. The answer changes
 * (and the screen redraws) only when someone starts or stops speaking.
 */
export function useSpeaking(sources: VoiceSource[]): Set<number> {
  const [speaking, setSpeaking] = useState<Set<number>>(() => new Set());
  const context = useRef<AudioContext | null>(null);
  const listeners = useRef(new Map<number, Listener>());
  const latest = useRef(sources);
  latest.current = sources;

  // One listener per person, replaced when their audio track changes and dropped when they leave.
  const key = sources.map((s) => `${s.userId}:${(s.track as { id?: string } | null)?.id ?? ''}`).join('|');
  useEffect(() => {
    const wanted = new Map(latest.current.filter((s) => s.track).map((s) => [s.userId, s.track!]));
    for (const [userId, listener] of listeners.current) {
      if (wanted.get(userId) === listener.track) continue;
      listener.source.disconnect();
      listeners.current.delete(userId);
    }
    for (const [userId, track] of wanted) {
      if (listeners.current.has(userId)) continue;
      try {
        const Context = window.AudioContext || (window as any).webkitAudioContext;
        context.current ??= new Context();
        void context.current.resume?.().catch(() => {});
        const source = context.current.createMediaStreamSource(new MediaStream([track as unknown as MediaStreamTrack]));
        const analyser = context.current.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);
        listeners.current.set(userId, { track, source, analyser, lastLoud: 0 });
      } catch {
        /* no audio analysis in this browser: the tile simply never lights */
      }
    }
  }, [key]);

  useEffect(() => {
    const samples = new Uint8Array(512);
    const timer = setInterval(() => {
      const now = Date.now();
      const next = new Set<number>();
      for (const [userId, listener] of listeners.current) {
        listener.analyser.getByteTimeDomainData(samples);
        let swing = 0;
        for (const value of samples) swing += Math.abs(value - 128);
        if (swing / samples.length / 128 > LOUD) listener.lastLoud = now;
        const muted = latest.current.find((s) => s.userId === userId)?.muted;
        if (!muted && now - listener.lastLoud < HOLD_MS) next.add(userId);
      }
      setSpeaking((previous) => (sameSet(previous, next) ? previous : next));
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  // Leaving the call releases the audio analysis.
  useEffect(
    () => () => {
      for (const listener of listeners.current.values()) listener.source.disconnect();
      listeners.current.clear();
      void context.current?.close().catch(() => {});
      context.current = null;
    },
    [],
  );

  return speaking;
}
