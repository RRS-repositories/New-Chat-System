/**
 * A table on the clipboard → the Markdown table the message box should receive, the way Mattermost
 * does it. Excel, Google Sheets and web pages put both HTML (with a <table>) and plain text
 * (tab-separated rows) on the clipboard; either is enough.
 *
 * Words around the table are kept (the owner, 6 Nov 2026: a sentence, a table and a warning under
 * it arrived as the table alone). Each block of tab-separated lines in the plain text becomes a
 * table and the other lines stay as they are.
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

const splitLines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');
const tsvRow = (line: string) => line.split('\t').map((c) => c.trim());

/** Tab-separated text (a spreadsheet copy) → rows. Null unless every line has at least one tab. */
export function rowsFromTsv(text: string): string[][] | null {
  const lines = splitLines(text).filter((l) => l.trim() !== '');
  if (lines.length < 2 || !lines.every((l) => l.includes('\t'))) return null;
  return lines.map(tsvRow);
}

/**
 * Text with tab-separated blocks in it → the same text with each block (two or more lines in a row
 * that all have a tab) turned into a Markdown table; everything else is left word for word. Null
 * when there is no such block, so the paste goes in untouched.
 */
export function tablesInText(text: string): string | null {
  const lines = splitLines(text);
  const out: string[] = [];
  let changed = false;
  let i = 0;
  while (i < lines.length) {
    let j = i;
    while (j < lines.length && lines[j]!.trim() !== '' && lines[j]!.includes('\t')) j++;
    const table = j - i >= 2 ? markdownTable(lines.slice(i, j).map(tsvRow)) : null;
    if (table) {
      // A table needs its own lines: a break before it when a sentence sits right above.
      if (out.length && out[out.length - 1]!.trim() !== '') out.push('');
      out.push(table);
      changed = true;
      i = j;
      // ... and after it, so the next sentence is not taken for a row.
      if (i < lines.length && lines[i]!.trim() !== '') out.push('');
    } else {
      out.push(lines[i]!);
      i++;
    }
  }
  return changed ? out.join('\n') : null;
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

/**
 * What was pasted → what the message box should receive, or null when there was no table in it.
 * Only a table (every line tab-separated): the HTML table's cells when there is one, since those
 * survive a cell with a line break in it; else the tab-separated text. A table among words: the
 * words stay and each tab-separated block becomes a table. HTML with a table but text without
 * tabs: the table alone, the old behaviour.
 */
export function tableFromClipboard({ html, text }: { html?: string; text?: string }): string | null {
  if (text && rowsFromTsv(text)) {
    const rows = (html && rowsFromHtml(html)) || rowsFromTsv(text);
    return rows ? markdownTable(rows) : null;
  }
  const mixed = text ? tablesInText(text) : null;
  if (mixed) return mixed;
  const rows = html ? rowsFromHtml(html) : null;
  return rows ? markdownTable(rows) : null;
}
