import { renderWithMentions } from './mentions.ts';

/**
 * Message text → a small tree the screen can draw. Pure, and never HTML: the tree only ever holds
 * text, so nothing typed in a message can run as code.
 *
 * What is understood:
 *   **bold**            `code`            ```a block of code```
 *   - a list            1. a numbered list
 *   | a | table |  with a |---|---| line under the first row (what a pasted table becomes)
 *   https://…  links (http and https only)        @mentions
 */
export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'bold'; children: Inline[] };

export type Align = 'left' | 'center' | 'right' | null;
export type Block =
  | { kind: 'paragraph'; lines: Inline[][] }
  | { kind: 'list'; ordered: boolean; start: number; items: Inline[][] }
  | { kind: 'code'; text: string }
  | { kind: 'table'; align: Align[]; header: Inline[][]; rows: Inline[][][] };

const FENCE = '```';
const BULLET = /^\s{0,3}[-*•]\s+(\S.*)$/;
const NUMBERED = /^\s{0,3}(\d{1,3})[.)]\s+(\S.*)$/;

const SEPARATOR_CELL = /^:?-+:?$/;

/** The cells of one table line (`| a | b |`, outer pipes optional, `\|` is a pipe inside a cell). Null when it is not one. */
export function tableCells(line: string): string[] | null {
  const t = line.trim();
  if (!t.includes('|')) return null;
  const inner = t.replace(/^\|/, '').replace(/\|$/, '');
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (ch === '\\' && inner[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '|') {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** The `|---|:---:|` line under a table's first row: its alignments, or null when the line is not one. */
function separatorAlign(line: string): Align[] | null {
  const cells = tableCells(line);
  if (!cells || !cells.every((c) => SEPARATOR_CELL.test(c))) return null;
  return cells.map((c) =>
    c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : null,
  );
}

/** Does a table start at line `i`: a row of cells with a matching `|---|` line under it? */
function tableAt(lines: string[], i: number): { cells: string[]; align: Align[] } | null {
  const cells = tableCells(lines[i]!);
  if (!cells || i + 1 >= lines.length) return null;
  const align = separatorAlign(lines[i + 1]!);
  return align && align.length === cells.length ? { cells, align } : null;
}

const CODE = /`([^`\n]+)`/;
const LINK = /https?:\/\/[^\s<>"'`]+/;
const BOLD = /\*\*([^\s*](?:[^\n]*?[^\s*])?)\*\*/;

/** A web address typed at the end of a sentence: the full stop, comma or closing bracket is not part of it. */
function trimLink(url: string): string {
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1]!;
    if ('.,;:!?\'"'.includes(last)) end--;
    else if (last === ')' && !url.slice(0, end).includes('(')) end--;
    else if (last === ']' && !url.slice(0, end).includes('[')) end--;
    else break;
  }
  return url.slice(0, end);
}

function plain(text: string, names: string[]): Inline[] {
  if (!text) return [];
  return renderWithMentions(text, names).map((part) =>
    part.mention ? { kind: 'mention', text: part.text } : { kind: 'text', text: part.text },
  );
}

/** One line of text → its pieces. Code comes first (nothing inside it is formatted), then links, then bold. */
export function parseInline(text: string, names: string[] = [], allowBold = true): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const found = [
      { kind: 'code' as const, match: CODE.exec(rest) },
      { kind: 'link' as const, match: LINK.exec(rest) },
      { kind: 'bold' as const, match: allowBold ? BOLD.exec(rest) : null },
    ]
      .filter((candidate) => candidate.match)
      .sort((a, b) => a.match!.index - b.match!.index)[0];
    if (!found) {
      out.push(...plain(rest, names));
      break;
    }
    const match = found.match!;
    out.push(...plain(rest.slice(0, match.index), names));
    let used = match[0].length;
    if (found.kind === 'code') out.push({ kind: 'code', text: match[1]! });
    else if (found.kind === 'bold') out.push({ kind: 'bold', children: parseInline(match[1]!, names, false) });
    else {
      const href = trimLink(match[0]);
      used = href.length;
      out.push({ kind: 'link', text: href, href });
    }
    rest = rest.slice(match.index + used);
  }
  return out;
}

/** A whole message → paragraphs, lists and code blocks. */
export function parseRich(content: string, names: string[] = []): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (trimmed.startsWith(FENCE)) {
      // ```one line``` on its own, or everything up to the closing fence (or the end of the message).
      const sameLine = trimmed.length > 6 && trimmed.endsWith(FENCE) ? trimmed.slice(3, -3) : null;
      if (sameLine !== null) {
        blocks.push({ kind: 'code', text: sameLine });
        i++;
        continue;
      }
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.trim().startsWith(FENCE)) body.push(lines[i++]!);
      i++; // the closing fence, if there was one
      blocks.push({ kind: 'code', text: body.join('\n') });
      continue;
    }

    // A table: a row of cells, the |---| line under it, then rows until a line without a pipe.
    const table = tableAt(lines, i);
    if (table) {
      const { cells: headerCells, align } = table;
      const width = headerCells.length;
      const fit = (cells: string[]) => Array.from({ length: width }, (_, c) => parseInline(cells[c] ?? '', names));
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length) {
        const cells = tableCells(lines[i]!);
        if (!cells) break;
        rows.push(fit(cells));
        i++;
      }
      blocks.push({ kind: 'table', align, header: fit(headerCells), rows });
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      const ordered = !!numbered;
      const pattern = ordered ? NUMBERED : BULLET;
      const items: Inline[][] = [];
      const start = numbered ? Number(numbered[1]) : 1;
      while (i < lines.length) {
        const item = pattern.exec(lines[i]!);
        if (!item) break;
        items.push(parseInline(item[ordered ? 2 : 1]!, names));
        i++;
      }
      blocks.push({ kind: 'list', ordered, start, items });
      continue;
    }

    const paragraph: Inline[][] = [];
    while (i < lines.length) {
      const next = lines[i]!;
      if (next.trim().startsWith(FENCE) || BULLET.test(next) || NUMBERED.test(next)) break;
      // The start of a table ends the paragraph (never before its first line: that line is not a table).
      if (paragraph.length && tableAt(lines, i)) break;
      paragraph.push(parseInline(next, names));
      i++;
    }
    blocks.push({ kind: 'paragraph', lines: paragraph });
  }
  return blocks;
}
