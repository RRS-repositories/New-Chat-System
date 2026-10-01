// The browser's microphone and screen capture, in the shape the call manager expects.
import { MIC_CONSTRAINTS, type StreamLike } from './callManager.ts';

/** Asks for the microphone. The browser shows its permission prompt the first time. */
export async function getMicrophone(): Promise<StreamLike> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no media devices');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS }, video: false });
  return stream as unknown as StreamLike;
}

/** Asks which screen or window to share. Picture only — no sound from the shared screen. */
export async function getScreen(): Promise<StreamLike> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('screen sharing is not supported here');
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  return stream as unknown as StreamLike;
}
