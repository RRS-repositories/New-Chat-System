/** Split a ts_headline snippet on the exact <b>/</b> markers Postgres inserted. Anything else is plain text. */
export function snippetParts(snippet: string): Array<{ text: string; hit: boolean }> {
  const out: Array<{ text: string; hit: boolean }> = [];
  const re = /<b>([\s\S]*?)<\/b>/g; let last = 0;
  for (const m of snippet.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: snippet.slice(last, i), hit: false });
    out.push({ text: m[1]!, hit: true }); last = i + m[0].length;
  }
  if (last < snippet.length) out.push({ text: snippet.slice(last), hit: false });
  return out;
}
