/**
 * Incoming-call ring: two short WebAudio beeps every 3 s (like sound.ts, no audio files).
 * Stops on stopRingtone() or after `maxMs` (the server gives up ringing after 30 s).
 */
let ctx: AudioContext | null = null;
let loop: ReturnType<typeof setInterval> | null = null;
let cap: ReturnType<typeof setTimeout> | null = null;

function burst() {
  try {
    ctx = ctx || new (window.AudioContext || (window as any).webkitAudioContext)();
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    for (const [at, freq] of [
      [0, 660],
      [0.5, 520],
    ] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(0.08, t0 + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + 0.4);
      o.connect(g);
      g.connect(ctx.destination);
      o.start(t0 + at);
      o.stop(t0 + at + 0.42);
    }
  } catch {
    /* no audio permission yet: the modal is still shown */
  }
}

export function startRingtone(maxMs = 30_000) {
  stopRingtone();
  burst();
  loop = setInterval(burst, 3000);
  cap = setTimeout(stopRingtone, maxMs);
}

export function stopRingtone() {
  if (loop) clearInterval(loop);
  if (cap) clearTimeout(cap);
  loop = null;
  cap = null;
}
