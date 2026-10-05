import type { Message } from '../types/index.ts';
const DAY = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Wall-clock parts in Europe/London, independent of the device's zone and of
// ICU's spelling choices ("Sept" vs "Sep").
function londonParts(d: Date) {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(d)) {
    if (part.type !== 'literal') p[part.type] = part.value;
  }
  const hour = p.hour === '24' ? '00' : p.hour;
  return { y: +p.year, m: +p.month, d: +p.day, hm: `${hour}:${p.minute}`, wd: WEEKDAYS.indexOf(p.weekday) };
}

export function formatTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const a = londonParts(d),
    b = londonParts(now);
  if (a.y === b.y && a.m === b.m && a.d === b.d) return a.hm;
  if (now.getTime() - d.getTime() < 7 * DAY) return `${WEEKDAYS[a.wd] ?? ''} ${a.hm}`.trim();
  return `${a.d} ${MONTHS[a.m - 1]}`;
}
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The time of day, 24-hour, in UK time: "14:05". */
export const formatClock = (iso: string): string => londonParts(new Date(iso)).hm;

/** One value per calendar day in UK time, to tell when the day changes between two messages. */
export function dayKey(iso: string): string {
  const p = londonParts(new Date(iso));
  return `${p.y}-${p.m}-${p.d}`;
}

/** The label on the chip between days: "Today", "Yesterday", or "Monday, 6 Oct" (with the year when it is not this one). */
export function dayLabel(iso: string, now = new Date()): string {
  const a = londonParts(new Date(iso));
  const b = londonParts(now);
  const days = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / DAY);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const label = `${WEEKDAYS_LONG[a.wd] ?? ''}, ${a.d} ${MONTHS[a.m - 1]}`;
  return a.y === b.y ? label : `${label} ${a.y}`;
}

export function groupWithPrevious(
  prev: Pick<Message, 'userId' | 'createdAt'> | undefined,
  cur: Pick<Message, 'userId' | 'createdAt'>,
): boolean {
  if (!prev || prev.userId !== cur.userId) return false;
  return new Date(cur.createdAt).getTime() - new Date(prev.createdAt).getTime() <= 5 * 60_000;
}
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('') || '?';
