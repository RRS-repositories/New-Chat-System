/**
 * Incoming-call ring, made with WebAudio (no audio files): a proper telephone ring, loud. Two tones
 * (400 Hz and 450 Hz, the classic ring) in two 0.4 s bursts, repeated every 2 s, at near full
 * volume — the earlier two soft beeps every 3 s were being missed in another tab or app (the owner,
 * 15 Oct 2026). Stops on stopRingtone() or after `maxMs` (the server gives up ringing after 30 s).
 */
let ctx: AudioContext | null = null;
let loop: ReturnType<typeof setInterval> | null = null;
let cap: ReturnType<typeof setTimeout> | null = null;

/** How loud: the gain of each of the two tones (they add up to just under full scale). */
export const RING_GAIN = 0.45;
export const RING_PERIOD_MS = 2000;
const BURSTS: ReadonlyArray<readonly [start: number, length: number]> = [
  [0, 0.4],
  [0.6, 0.4],
];
const TONES = [400, 450] as const;

function burst() {
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    for (const [at, len] of BURSTS) {
      for (const freq of TONES) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t0 + at);
        g.gain.exponentialRampToValueAtTime(RING_GAIN, t0 + at + 0.02);
        g.gain.setValueAtTime(RING_GAIN, t0 + at + len - 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
        o.connect(g);
        g.connect(ctx.destination);
        o.start(t0 + at);
        o.stop(t0 + at + len + 0.01);
      }
    }
  } catch {
    /* no audio permission yet: the card is still shown */
  }
}

export function startRingtone(maxMs = 30_000) {
  stopRingtone();
  burst();
  loop = setInterval(burst, RING_PERIOD_MS);
  cap = setTimeout(stopRingtone, maxMs);
}

export function stopRingtone() {
  if (loop) clearInterval(loop);
  if (cap) clearTimeout(cap);
  loop = null;
  cap = null;
}
