/**
 * A table on the clipboard → the Markdown table the message box should receive, the way Mattermost
 * does it. Excel, Google Sheets and web pages put both HTML (with a <table>) and plain text
 * (tab-separated rows) on the clipboard; either is enough.
 */

/** Table cell text → safe inside a Markdown cell: one line, pipes escaped. */
function cell(text: string): string {
  return text
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\|/g, '\\|')
    .trim();
}

/** Rows of cells → a Markdown table; the first row is the header. Null for fewer than 2 rows or 2 columns. */
export function markdownTable(rows: string[][]): string | null {
  const width = Math.max(0, ...rows.map((r) => r.length));
  if (rows.length < 2 || width < 2) return null;
  const line = (r: string[]) => `| ${Array.from({ length: width }, (_, i) => cell(r[i] ?? '') || ' ').join(' | ')} |`;
  const separator = `| ${Array.from({ length: width }, () => '---').join(' | ')} |`;
  return [line(rows[0]!), separator, ...rows.slice(1).map(line)].join('\n');
}

/** Tab-separated text (a spreadsheet copy) → rows. Null unless every line has at least one tab. */
export function rowsFromTsv(text: string): string[][] | null {
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim() !== '');
  if (lines.length < 2 || !lines.every((l) => l.includes('\t'))) return null;
  return lines.map((l) => l.split('\t').map((c) => c.trim()));
}

/** HTML with a <table> → the rows of its first table (text only). Null when there is none. */
export function rowsFromHtml(html: string, parse: (html: string) => Document | null = defaultParse): string[][] | null {
  const doc = parse(html);
  const table = doc?.querySelector('table');
  if (!table) return null;
  const rows: string[][] = [];
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    if (tr.closest('table') !== table) continue; // a table inside a cell stays text
    const cells = Array.from(tr.querySelectorAll('th, td')).filter((c) => c.closest('tr') === tr);
    if (cells.length) rows.push(cells.map((c) => (c.textContent || '').trim()));
  }
  return rows.length ? rows : null;
}

function defaultParse(html: string): Document | null {
  try {
    return typeof DOMParser === 'undefined' ? null : new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return null;
  }
}

/** What was pasted → a Markdown table, or null when it was not a table. */
export function tableFromClipboard({ html, text }: { html?: string; text?: string }): string | null {
  const rows = (html && rowsFromHtml(html)) || (text && rowsFromTsv(text)) || null;
  return rows ? markdownTable(rows) : null;
}
