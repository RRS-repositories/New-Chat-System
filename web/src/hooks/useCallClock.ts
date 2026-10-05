import { useEffect, useState } from 'react';

/** Seconds → "04:07" (or "1:04:07" past the hour). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const two = (n: number) => String(n).padStart(2, '0');
  const hours = Math.floor(s / 3600);
  const rest = `${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return hours ? `${hours}:${rest}` : rest;
}

/** How long the call has been going, as text that ticks once a second. Empty before the call has begun. */
export function useCallClock(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since == null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [since]);
  return since == null ? '' : formatDuration((now - since) / 1000);
}
