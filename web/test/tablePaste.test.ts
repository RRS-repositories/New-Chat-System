// A pasted table (spreadsheet cells or a web table) becomes a Markdown table in the message box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownTable, rowsFromTsv, rowsFromHtml, tableFromClipboard } from '../src/utils/tablePaste.ts';
import { parseRich } from '../src/utils/richText.ts';

test('spreadsheet cells (tab-separated) become a table; ordinary text does not', () => {
  assert.equal(
    tableFromClipboard({ text: 'Name\tAmount\r\nAnn\t10\r\nBob\t2|3\r\n' }),
    '| Name | Amount |\n| --- | --- |\n| Ann | 10 |\n| Bob | 2\\|3 |',
  );
  assert.equal(tableFromClipboard({ text: 'just a line' }), null);
  assert.equal(tableFromClipboard({ text: 'one\ttab\nbut not here' }), null, 'every line needs a tab');
  assert.equal(tableFromClipboard({ text: 'a\tb' }), null, 'one row is not a table');
  assert.equal(rowsFromTsv('a\tb\n\nc\td')?.length, 2, 'blank lines are skipped');
});

test('a single column or a single row is left as text', () => {
  assert.equal(markdownTable([['a'], ['b']]), null);
  assert.equal(markdownTable([['a', 'b']]), null);
});

test('what the paste produces is what the message draws', () => {
  const md = tableFromClipboard({ text: 'Lender\tStatus\nVanquis\tOpen\nZable\tClosed' })!;
  const [block] = parseRich(md);
  assert.equal(block!.kind, 'table');
  if (block!.kind === 'table') {
    assert.equal(block.rows.length, 2);
    assert.deepEqual(
      block.header.map((c) => c.map((p) => ('text' in p ? p.text : '')).join('')),
      ['Lender', 'Status'],
    );
  }
});

// A tiny stand-in for the browser's DOMParser: enough of the DOM for rowsFromHtml.
function fakeDoc(rows: string[][] | null): Document | null {
  if (!rows) return { querySelector: () => null } as unknown as Document;
  const trs = rows.map((r) => {
    const tr: any = {};
    const cells = r.map((t) => ({ textContent: t, closest: () => tr }));
    tr.querySelectorAll = () => cells;
    return tr;
  });
  const table: any = { querySelectorAll: () => trs };
  for (const tr of trs) tr.closest = () => table;
  return { querySelector: () => table } as unknown as Document;
}

test('an HTML table on the clipboard wins over the plain text; no table means null', () => {
  assert.deepEqual(
    rowsFromHtml('<table>…</table>', () =>
      fakeDoc([
        ['h1', 'h2'],
        ['a', 'b'],
      ]),
    ),
    [
      ['h1', 'h2'],
      ['a', 'b'],
    ],
  );
  assert.equal(
    rowsFromHtml('<p>x</p>', () => fakeDoc(null)),
    null,
  );
  assert.equal(
    rowsFromHtml('<table></table>', () => null),
    null,
    'no parser: null',
  );
});
