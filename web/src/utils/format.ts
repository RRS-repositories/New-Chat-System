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
/** A stable tone (0-7) per person, so each avatar keeps its own colour everywhere. */
export const avatarTone = (name: string): number => {
  let h = 0;
  for (const ch of name.trim().toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % 8;
};
