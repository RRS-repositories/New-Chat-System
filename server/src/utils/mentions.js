const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * @all / @channel → everyone; @Full Name or @FirstName → a member (the client
 * matches the same way). A first name shared by two members is ambiguous and
 * matches nobody on its own. Longest names first so "@Ann Agent" is not read
 * as "@Ann".
 */
export function parseMentions(content, members) {
  const text = String(content || '');
  if (/(^|[^\w@])@(all|channel)\b/i.test(text)) return { userIds: [], all: true };
  const firstCounts = new Map();
  for (const m of members) {
    const f = (m.fullName || '').trim().split(/\s+/)[0]?.toLowerCase();
    if (f) firstCounts.set(f, (firstCounts.get(f) || 0) + 1);
  }
  const candidates = [];
  for (const m of members) {
    const full = (m.fullName || '').trim();
    if (!full) continue;
    candidates.push({ id: m.id, name: full });
    const first = full.split(/\s+/)[0];
    if (first !== full && firstCounts.get(first.toLowerCase()) === 1) candidates.push({ id: m.id, name: first });
  }
  candidates.sort((a, b) => b.name.length - a.name.length);
  const ids = [];
  let rest = text;
  for (const c of candidates) {
    const re = new RegExp(`(^|[^\\w@])@${esc(c.name)}(?![\\w])`, 'i');
    if (re.test(rest)) {
      ids.push(c.id);
      rest = rest.replace(re, '$1 ');
    }
  }
  return { userIds: [...new Set(ids)], all: false };
}
