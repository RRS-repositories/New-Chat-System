// A pasted table (spreadsheet cells or a web table) becomes a Markdown table in the message box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownTable, rowsFromTsv, rowsFromHtml, tableFromClipboard, tablesInText } from '../src/utils/tablePaste.ts';
import { parseRich } from '../src/utils/richText.ts';

// The owner's paste of 6 Nov 2026: a sentence, a table, a warning under it. Only the table arrived.
const NOTE =
  'claims are filled in and ready to check. One of them, 266791, rests on an incomplete DSAR review, so please read the warning below the table.\n' +
  '\n' +
  'Claim\tLender\tType\tAccounts\tTotal Debt\tClaim Value\n' +
  '261640\tAqua\tCredit card\t1\t391.39\t137.39\n' +
  '266791\t118 118 Money\tCredit card\t1\t825.13\t913.00\n' +
  '\n' +
  'Warning: 266791 was reviewed from a DSAR with pages missing.';

test('words around a pasted table are kept; each tab-separated block becomes a table', () => {
  const got = tablesInText(NOTE)!;
  assert.ok(got.startsWith('claims are filled in and ready to check.'), 'the sentence above stays');
  assert.ok(got.endsWith('Warning: 266791 was reviewed from a DSAR with pages missing.'), 'the warning under it stays');
  assert.ok(
    got.includes('| Claim | Lender | Type | Accounts | Total Debt | Claim Value |\n| --- |'),
    'the table is Markdown',
  );
  const kinds = parseRich(got).map((b) => b.kind);
  assert.deepEqual(kinds, ['paragraph', 'table', 'paragraph'], 'drawn as sentence, table, sentence');
  assert.equal(tablesInText('just words\nand more words'), null, 'no table: left alone');
  assert.equal(tablesInText('one\ttab line\nthen words'), null, 'a single tabbed line is not a table');
});

test('a sentence right above or under the table gets its own line, so the table is still drawn', () => {
  const got = tablesInText('Totals so far:\nName\tAmount\nAnn\t10\nthat is all')!;
  assert.deepEqual(
    parseRich(got).map((b) => b.kind),
    ['paragraph', 'table', 'paragraph'],
  );
  const two = tablesInText('a\tb\nc\td\n\nmiddle words\n\ne\tf\ng\th')!;
  assert.equal(parseRich(two).filter((b) => b.kind === 'table').length, 2, 'two tables in one paste');
  assert.ok(two.includes('middle words'));
});

test('the clipboard HTML table no longer hides the words around it', () => {
  // A web page or a chat answer copied whole: HTML with a <table> in it, plain text with the words too.
  const got = tableFromClipboard({ html: '<p>claims…</p><table>…</table><p>Warning…</p>', text: NOTE })!;
  assert.ok(got.startsWith('claims are filled in'));
  assert.ok(got.includes('| 261640 | Aqua |'));
  assert.ok(got.endsWith('pages missing.'));
  // Only a table: still one Markdown table (in node there is no DOMParser, so the text rows are used).
  assert.equal(
    tableFromClipboard({ html: '<table>…</table>', text: 'h1\th2\na\tb' }),
    '| h1 | h2 |\n| --- | --- |\n| a | b |',
  );
  // HTML table but plain text without tabs: the table alone, as before.
  assert.equal(
    tableFromClipboard({ html: '<table>…</table>', text: 'h1 h2\na b' }),
    null,
    'no DOMParser in node: html rows are null here, text has no tabs',
  );
});

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
