import { useTrackStream } from '../../hooks/useTrackStream.ts';
import type { TrackLike } from '../../services/callManager.ts';

/** One hidden player per person in the call, for their voice. */
export function RemoteAudio({ track }: { track: TrackLike }) {
  const ref = useTrackStream<HTMLAudioElement>(track);
  return <audio ref={ref} autoPlay hidden />;
}
