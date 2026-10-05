import { MonitorUp } from 'lucide-react';
import { useTrackStream } from '../../hooks/useTrackStream.ts';
import type { TrackLike } from '../../services/callManager.ts';

/**
 * The sharer's own screen, shown back to them small in the corner, so they can see what the
 * others see. It plays the capture that is already running: nothing extra is sent or received.
 */
export function OwnScreen({ track, onStop }: { track: TrackLike; onStop: () => void }) {
  const videoRef = useTrackStream<HTMLVideoElement>(track);
  return (
    <figure className="selfpv call-own-screen">
      <div className="ph">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          data-testid="call-own-screen"
          aria-label="Your shared screen"
        />
      </div>
      <figcaption className="cap">
        <span>
          <MonitorUp size={13} /> You’re presenting
        </span>
        <button data-testid="call-own-screen-stop" onClick={onStop}>
          Stop
        </button>
      </figcaption>
    </figure>
  );
}
