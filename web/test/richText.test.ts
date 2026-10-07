import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInline, parseRich, type Inline } from '../src/utils/richText.ts';

const text = (t: string): Inline => ({ kind: 'text', text: t });
const link = (href: string): Inline => ({ kind: 'link', text: href, href });

test('plain text stays plain', () => {
  assert.deepEqual(parseInline('just words, 2 * 3 = 6, a_b'), [text('just words, 2 * 3 = 6, a_b')]);
  assert.deepEqual(parseRich('hello'), [{ kind: 'paragraph', lines: [[text('hello')]] }]);
  assert.deepEqual(parseInline(''), []);
});

test('web addresses become links; only http and https', () => {
  assert.deepEqual(parseInline('see https://example.com/a?b=1&c=2 now'), [
    text('see '),
    link('https://example.com/a?b=1&c=2'),
    text(' now'),
  ]);
  assert.deepEqual(parseInline('http://intranet/page'), [link('http://intranet/page')]);
  for (const notALink of ['javascript:alert(1)', 'ftp://files/x', 'www.example.com', 'data:text/html,x'])
    assert.deepEqual(parseInline(notALink), [text(notALink)], notALink);
});

test('the full stop, comma or bracket after an address is not part of it', () => {
  assert.deepEqual(parseInline('Look at https://example.com/page.'), [
    text('Look at '),
    link('https://example.com/page'),
    text('.'),
  ]);
  assert.deepEqual(parseInline('(see https://example.com/a), ok'), [
    text('(see '),
    link('https://example.com/a'),
    text('), ok'),
  ]);
  assert.deepEqual(parseInline('https://en.wikipedia.org/wiki/Claim_(law)'), [
    link('https://en.wikipedia.org/wiki/Claim_(law)'),
  ]);
  assert.deepEqual(parseInline('"https://example.com/x"!'), [text('"'), link('https://example.com/x'), text('"!')]);
});

test('**bold**, and what counts as bold', () => {
  assert.deepEqual(parseInline('this is **very important** today'), [
    text('this is '),
    { kind: 'bold', children: [text('very important')] },
    text(' today'),
  ]);
  assert.deepEqual(parseInline('**a**'), [{ kind: 'bold', children: [text('a')] }]);
  for (const notBold of ['2 ** 3', '** spaced **', '****', '**unfinished'])
    assert.deepEqual(parseInline(notBold), [text(notBold)], notBold);
});

test('a link or a mention inside bold still works', () => {
  assert.deepEqual(parseInline('**read https://example.com now**'), [
    { kind: 'bold', children: [text('read '), link('https://example.com'), text(' now')] },
  ]);
  assert.deepEqual(parseInline('**ask @Ann Agent**', ['Ann Agent']), [
    { kind: 'bold', children: [text('ask '), { kind: 'mention', text: '@Ann Agent' }] },
  ]);
});

test('`code` is shown exactly as typed: nothing inside it is formatted', () => {
  assert.deepEqual(parseInline('run `npm test **now** https://x.y` please'), [
    text('run '),
    { kind: 'code', text: 'npm test **now** https://x.y' },
    text(' please'),
  ]);
  assert.deepEqual(parseInline('a lone ` backtick'), [text('a lone ` backtick')]);
});

test('@mentions are still recognised in ordinary text', () => {
  assert.deepEqual(parseInline('hi @Ann Agent, see https://example.com', ['Ann Agent']), [
    text('hi '),
    { kind: 'mention', text: '@Ann Agent' },
    text(', see '),
    link('https://example.com'),
  ]);
});

test('lines starting with a dash or a number become a list', () => {
  assert.deepEqual(parseRich('To do:\n- call the client\n- send **the** letter\nthanks'), [
    { kind: 'paragraph', lines: [[text('To do:')]] },
    {
      kind: 'list',
      ordered: false,
      start: 1,
      items: [[text('call the client')], [text('send '), { kind: 'bold', children: [text('the')] }, text(' letter')]],
    },
    { kind: 'paragraph', lines: [[text('thanks')]] },
  ]);
  assert.deepEqual(parseRich('3. third\n4) fourth'), [
    { kind: 'list', ordered: true, start: 3, items: [[text('third')], [text('fourth')]] },
  ]);
  assert.deepEqual(parseRich('* star\n• dot'), [
    { kind: 'list', ordered: false, start: 1, items: [[text('star')], [text('dot')]] },
  ]);
});

test('things that only look like a list are left alone', () => {
  for (const notAList of ['-5 degrees', 'well-known', '2024. A year', '1.5 litres', '-', '- '])
    assert.deepEqual(parseRich(notAList), [{ kind: 'paragraph', lines: [[text(notAList)]] }], notAList);
});

test('a fenced block is code, kept exactly, with nothing inside formatted', () => {
  assert.deepEqual(parseRich('before\n```\nSELECT *\n  FROM x -- **not bold**\n```\nafter'), [
    { kind: 'paragraph', lines: [[text('before')]] },
    { kind: 'code', text: 'SELECT *\n  FROM x -- **not bold**' },
    { kind: 'paragraph', lines: [[text('after')]] },
  ]);
  assert.deepEqual(parseRich('```one line```'), [{ kind: 'code', text: 'one line' }]);
  assert.deepEqual(parseRich('```\nnever closed\n- still code'), [
    { kind: 'code', text: 'never closed\n- still code' },
  ]);
});

test('line breaks and blank lines in ordinary text are kept', () => {
  assert.deepEqual(parseRich('one\n\ntwo'), [{ kind: 'paragraph', lines: [[text('one')], [], [text('two')]] }]);
});

test('nothing typed can become markup: angle brackets are just text', () => {
  const blocks = parseRich('<script>alert(1)</script> <a href="https://evil.example">x</a>');
  const flat = JSON.stringify(blocks);
  assert.ok(flat.includes('<script>alert(1)</script>'), 'kept as text');
  const kinds = (blocks[0] as any).lines[0].map((piece: Inline) => piece.kind);
  assert.deepEqual(kinds, ['text', 'link', 'text'], 'only the address itself is a link');
  assert.equal((blocks[0] as any).lines[0][1].href, 'https://evil.example');
});

test('a very long message is handled quickly', () => {
  const long = Array.from(
    { length: 400 },
    (_, i) => `line ${i} with **bold** and https://example.com/${i} and \`code\``,
  ).join('\n');
  const started = performance.now();
  const blocks = parseRich(long.slice(0, 4000));
  assert.ok(blocks.length >= 1);
  assert.ok(performance.now() - started < 50, 'well under a frame or two');
});

test('a table: a row of cells, the |---| line, then rows; outer pipes optional; \| is a pipe; short rows are padded', () => {
  const t = parseRich('| Name | Amount |\n|---|---:|\n| Ann | 10 |\nBob | 2\\|3 |\n| Cy |');
  assert.equal(t.length, 1);
  const table = t[0]!;
  assert.equal(table.kind, 'table');
  if (table.kind !== 'table') return;
  assert.deepEqual(table.align, [null, 'right']);
  assert.deepEqual(table.header, [[text('Name')], [text('Amount')]]);
  assert.deepEqual(table.rows, [
    [[text('Ann')], [text('10')]],
    [[text('Bob')], [text('2|3')]],
    [[text('Cy')], []],
  ]);
});

test('a table ends the paragraph before it and stops at a line without a pipe; pipes alone are not a table', () => {
  const blocks = parseRich('totals:\n| a | b |\n| - | - |\n| 1 | 2 |\nthanks');
  assert.deepEqual(
    blocks.map((b) => b.kind),
    ['paragraph', 'table', 'paragraph'],
  );
  assert.deepEqual(parseRich('a | b\nc | d'), [{ kind: 'paragraph', lines: [[text('a | b')], [text('c | d')]] }]);
  assert.deepEqual(parseRich('| a | b |\n|---|'), [
    { kind: 'paragraph', lines: [[text('| a | b |')], [text('|---|')]] },
  ]);
});
