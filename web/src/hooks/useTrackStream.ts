import { useEffect, useRef } from 'react';
import type { TrackLike } from '../services/callManager.ts';

/** Plays one live audio or video track in the `<audio>`/`<video>` element the returned ref is attached to. */
export function useTrackStream<E extends HTMLMediaElement>(track: TrackLike | null) {
  const ref = useRef<E | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!track) {
      element.srcObject = null;
      return;
    }
    try {
      element.srcObject = new MediaStream([track as unknown as MediaStreamTrack]);
      void element.play().catch(() => {});
    } catch {
      /* unsupported */
    }
    return () => {
      element.srcObject = null;
    };
  }, [track]);
  return ref;
}
