// The browser's microphone and screen capture, in the shape the call manager expects.
import { MIC_CONSTRAINTS, type StreamLike } from './callManager.ts';

/** Asks for the microphone. The browser shows its permission prompt the first time. */
export async function getMicrophone(): Promise<StreamLike> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no media devices');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS }, video: false });
  return stream as unknown as StreamLike;
}

/**
 * Asks which screen or window to share. Picture only — no sound from the shared screen.
 * The picture is capped at 1080p and 15 frames a second: in a mesh call the sharer sends one copy
 * to every other person, so an uncapped 30 fps capture is what saturated uploads and left viewers
 * with a frozen or black screen (13 Oct 2026). Text stays sharp (`contentHint`), motion is traded.
 */
export const SHARE_FRAME_RATE = 15;
export async function getScreen(): Promise<StreamLike> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('screen sharing is not supported here');
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: {
      width: { max: 1920 },
      height: { max: 1080 },
      frameRate: { ideal: SHARE_FRAME_RATE, max: SHARE_FRAME_RATE },
    },
    audio: false,
    // Chrome extras: never offer this tab itself, and let the sharer switch what is shared mid-way.
    ...({ selfBrowserSurface: 'exclude', surfaceSwitching: 'include' } as object),
  });
  for (const t of stream.getVideoTracks()) {
    try {
      (t as MediaStreamTrack & { contentHint?: string }).contentHint = 'detail';
    } catch {
      /* not supported */
    }
  }
  return stream as unknown as StreamLike;
}
