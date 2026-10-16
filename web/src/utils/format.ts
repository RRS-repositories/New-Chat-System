import type { Message } from '../types/index.ts';
const DAY = 86_400_000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Wall-clock parts in the reader's own time zone (the device's, unless one is given), independent
// of ICU's spelling choices ("Sept" vs "Sep"). The team is spread across countries, so each person
// reads times as their own clock shows them, not London's.
function clockParts(d: Date, timeZone?: string) {
  const p: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat('en-GB', {
    ...(timeZone ? { timeZone } : {}),
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

export function formatTime(iso: string, now = new Date(), timeZone?: string): string {
  const d = new Date(iso);
  const a = clockParts(d, timeZone),
    b = clockParts(now, timeZone);
  if (a.y === b.y && a.m === b.m && a.d === b.d) return a.hm;
  if (now.getTime() - d.getTime() < 7 * DAY) return `${WEEKDAYS[a.wd] ?? ''} ${a.hm}`.trim();
  return `${a.d} ${MONTHS[a.m - 1]}`;
}
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The time of day, 24-hour, on the reader's own clock: "14:05". */
export const formatClock = (iso: string, timeZone?: string): string => clockParts(new Date(iso), timeZone).hm;

/** One value per calendar day on the reader's own clock, to tell when the day changes between two messages. */
export function dayKey(iso: string, timeZone?: string): string {
  const p = clockParts(new Date(iso), timeZone);
  return `${p.y}-${p.m}-${p.d}`;
}

/** The label on the chip between days: "Today", "Yesterday", or "Monday, 6 Oct" (with the year when it is not this one). */
export function dayLabel(iso: string, now = new Date(), timeZone?: string): string {
  const a = clockParts(new Date(iso), timeZone);
  const b = clockParts(now, timeZone);
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
/** The full moment with its zone, for a tooltip: "16 Oct 2026, 14:05 IST". */
export function formatFull(iso: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    ...(timeZone ? { timeZone } : {}),
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  }).format(d);
}
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join('') || '?';
