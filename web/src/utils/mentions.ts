const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const boundary = (name: string) => new RegExp(`(^|[^\\w@])@${esc(name)}(?![\\w])`, 'i');

export function mentionsUser(content: string, fullName: string): boolean {
  const text = String(content || '');
  if (/(^|[^\w@])@(all|channel)\b/i.test(text)) return true;
  const full = fullName.trim();
  const first = full.split(/\s+/)[0] || '';
  return (full !== '' && boundary(full).test(text)) || (first !== '' && boundary(first).test(text));
}

export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const m = /(^|\s)@([^\s@]*)$/.exec(before);
  if (!m) return null;
  return { start: caret - m[2]!.length - 1, query: m[2]! };
}

export function renderWithMentions(content: string, names: string[]): Array<{ text: string; mention: boolean }> {
  const tokens = [...names]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(esc)
    .concat(['all', 'channel']);
  const re = new RegExp(`@(?:${tokens.join('|')})(?![\\w])`, 'gi');
  const out: Array<{ text: string; mention: boolean }> = [];
  let last = 0;
  for (const m of content.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > 0 && /[\w@]/.test(content[i - 1]!)) continue;
    if (i > last) out.push({ text: content.slice(last, i), mention: false });
    out.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < content.length) out.push({ text: content.slice(last), mention: false });
  return out;
}

export type MentionItem = { id: number | 'all' | 'channel'; label: string };
/** The autocomplete list for an @query: @all/@channel first when they match, then up to six people. */
export function mentionItems(members: { id: number; fullName: string }[], query: string): MentionItem[] {
  const q = query.toLowerCase();
  const special: MentionItem[] = (['all', 'channel'] as const)
    .filter((s) => s.startsWith(q))
    .map((s) => ({ id: s, label: s }));
  // Match at the start of any word of the name ("@sa" finds "Bob Sales"; "@a" does not).
  const people: MentionItem[] = members
    .filter((m) =>
      m.fullName
        .toLowerCase()
        .split(/\s+/)
        .some((w) => w.startsWith(q)),
    )
    .slice(0, 6)
    .map((m) => ({ id: m.id, label: m.fullName }));
  return [...special, ...people];
}

export function insertMention(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const next = `${text.slice(0, start)}@${name} ${text.slice(caret)}`;
  return { text: next, caret: start + name.length + 2 };
}
