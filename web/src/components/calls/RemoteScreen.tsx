import { ExternalLink, Maximize2, MonitorUp, Undo2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTrackStream } from '../../hooks/useTrackStream.ts';
import type { TrackLike } from '../../services/callManager.ts';

const WINDOW_NAME = 'chat-shared-screen';
const WINDOW_FEATURES = 'popup,width=1280,height=760';

/** Fills a separate browser window with one live video. Double-click toggles full screen there. */
function showInWindow(target: Window, track: TrackLike, title: string) {
  const doc = target.document;
  doc.title = title;
  doc.body.style.cssText = 'margin:0;background:#05070F;overflow:hidden';
  doc.body.replaceChildren();
  const video = doc.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  video.style.cssText = 'width:100vw;height:100vh;object-fit:contain;display:block';
  video.ondblclick = () => {
    void (doc.fullscreenElement ? doc.exitFullscreen() : video.requestFullscreen()).catch(() => {});
  };
  try {
    video.srcObject = new MediaStream([track as unknown as MediaStreamTrack]);
    void video.play().catch(() => {});
  } catch {
    /* unsupported */
  }
  doc.body.appendChild(video);
}

type Props = {
  track: TrackLike;
  /** Whose screen it is; "You" when it is the viewer's own. */
  name: string;
  own?: boolean;
};

/**
 * A shared screen, filling the stage. "Full screen" fills this monitor, and "Open in a separate
 * window" moves it to its own browser window (drag it to a second monitor, maximise it). The
 * window shows the same live stream — nothing extra is sent or received.
 */
/** How long without a new frame counts as a stalled picture. */
const STALL_MS = 4000;

export function RemoteScreen({ track, name, own = false }: Props) {
  const videoRef = useTrackStream<HTMLVideoElement>(track);
  const windowRef = useRef<Window | null>(null);
  const [inWindow, setInWindow] = useState(false);
  // No new frame for a while (the sharer's connection is struggling): say so over the last frame,
  // rather than leaving a frozen picture that looks live.
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (own) return;
    const video = videoRef.current;
    if (!video || typeof (video as any).getVideoPlaybackQuality !== 'function') return;
    let frames = -1;
    let since = Date.now();
    const timer = setInterval(() => {
      try {
        const now = (video as any).getVideoPlaybackQuality().totalVideoFrames as number;
        if (now !== frames) {
          frames = now;
          since = Date.now();
          setStalled(false);
        } else if (Date.now() - since >= STALL_MS) setStalled(true);
      } catch {
        /* not supported */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [track, own, videoRef]);

  const closeWindow = () => {
    const open = windowRef.current;
    windowRef.current = null;
    setInWindow(false);
    try {
      open?.close();
    } catch {
      /* already closed */
    }
  };

  // The window goes away when the share ends, the sharer changes, the call ends or this page closes.
  useEffect(() => {
    window.addEventListener('pagehide', closeWindow);
    return () => {
      window.removeEventListener('pagehide', closeWindow);
      closeWindow();
    };
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps

  const fullScreen = () => {
    void videoRef.current?.requestFullscreen?.().catch(() => {});
  };

  const openWindow = () => {
    const opened = window.open('', WINDOW_NAME, WINDOW_FEATURES);
    if (!opened) {
      fullScreen(); // pop-ups blocked: full screen is the next best thing
      return;
    }
    windowRef.current = opened;
    showInWindow(opened, track, `${name}'s screen`);
    opened.addEventListener('pagehide', () => {
      if (windowRef.current !== opened) return;
      windowRef.current = null;
      setInWindow(false);
    });
    setInWindow(true);
  };

  return (
    <figure className="c-scr call-screen">
      <figcaption className="c-scrtop call-screen-bar">
        <span className="who">
          <MonitorUp size={14} />
          <span>
            {inWindow ? (
              <>
                <b>{name}’s screen</b> is open in its own window
              </>
            ) : (
              <>
                <b>{own ? 'You are' : `${name} is`}</b> presenting
              </>
            )}
          </span>
        </span>
        {!own && (
          <>
            <button
              className="c-ic"
              data-testid="call-screen-full"
              aria-label="Full screen"
              title="Full screen"
              onClick={fullScreen}
            >
              <Maximize2 size={16} />
            </button>
            {inWindow ? (
              <button
                className="c-ic"
                data-testid="call-screen-back"
                aria-label="Close the separate window"
                title="Close the separate window"
                onClick={closeWindow}
              >
                <Undo2 size={16} />
              </button>
            ) : (
              <button
                className="c-ic"
                data-testid="call-screen-pop"
                aria-label="Open in a separate window"
                title="Open in a separate window"
                onClick={openWindow}
              >
                <ExternalLink size={16} />
              </button>
            )}
          </>
        )}
      </figcaption>
      <div className="c-scrbody">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          data-testid={own ? 'call-own-screen-stage' : 'call-remote-screen'}
          aria-label={own ? 'Your shared screen' : `${name}'s screen`}
          onDoubleClick={own ? undefined : fullScreen}
        />
        {stalled && (
          <div className="c-stall" role="status" data-testid="call-screen-stalled">
            Picture paused — waiting for {name}’s connection
          </div>
        )}
      </div>
    </figure>
  );
}
