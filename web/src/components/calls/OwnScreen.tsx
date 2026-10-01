import { useTrackStream } from '../../hooks/useTrackStream.ts';
import type { TrackLike } from '../../services/callManager.ts';

/**
 * The sharer's own screen, shown back to them small, so they can see what the others see.
 * It plays the capture that is already running: nothing extra is sent or received.
 */
export function OwnScreen({ track }: { track: TrackLike }) {
  const videoRef = useTrackStream<HTMLVideoElement>(track);
  return (
    <figure className="call-screen call-own-screen">
      <video ref={videoRef} autoPlay playsInline muted data-testid="call-own-screen" aria-label="Your shared screen" />
      <figcaption className="muted call-self-share">
        You are sharing your screen. This is what the others see.
      </figcaption>
    </figure>
  );
}
