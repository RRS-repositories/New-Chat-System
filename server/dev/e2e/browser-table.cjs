// Real-browser check: a table pasted into the message box (spreadsheet cells, or a web page's table)
// becomes a Markdown table in the box and is drawn as a table in the sent message, for the sender
// and the reader. Against the local harness (node server/dev/local.mjs → http://localhost:5021).
//   node server/dev/e2e/browser-table.cjs
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:5021';
const results = [];
const errors = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push(['FAIL', `${name} — ${String(e.message).split('\n')[0]}`]);
  }
};
async function signIn(browser, email, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`${label} console: ${m.text().slice(0, 160)}`);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'local');
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar-user', { timeout: 15000 });
  await page.locator('.chan-row', { hasText: 'General' }).first().click();
  await page.waitForSelector('.panel > .input-bar textarea');
  return { ctx, page };
}
/** Pastes into the message box the way a browser does: a paste event carrying the clipboard's types. */
const paste = (page, data) =>
  page.evaluate((d) => {
    const ta = document.querySelector('.panel > .input-bar textarea');
    ta.focus();
    const dt = new DataTransfer();
    for (const [type, value] of Object.entries(d)) dt.setData(type, value);
    ta.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, data);
const box = (page) => page.locator('.panel > .input-bar textarea');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const meg = await signIn(browser, 'm@x', 'Meg');
  const ann = await signIn(browser, 'a@x', 'Ann');

  await step('spreadsheet cells (tab-separated) pasted into the box become a Markdown table', async () => {
    await paste(meg.page, { 'text/plain': 'Lender\tStatus\tAmount\r\nVanquis\tOpen\t120\r\nZable\tClosed\t80\r\n' });
    await meg.page.waitForFunction(
      () =>
        /\| Lender \| Status \| Amount \|\n\| --- \| --- \| --- \|/.test(
          document.querySelector('.panel > .input-bar textarea').value,
        ),
      null,
      { timeout: 4000 },
    );
  });

  await step(
    'sent, it is drawn as a table with a header row and the cells, for the sender and the reader',
    async () => {
      await box(meg.page).focus();
      await meg.page.keyboard.press('Enter');
      for (const who of [meg, ann]) {
        const table = who.page.locator('.msg .msg-table').last();
        await table.waitFor({ timeout: 8000 });
        const heads = await table.locator('th').allInnerTexts();
        if (heads.join(',') !== 'Lender,Status,Amount') throw new Error(`header: ${heads}`);
        const rows = await table.locator('tbody tr').count();
        if (rows !== 2) throw new Error(`${rows} rows`);
        const cells = await table.locator('tbody tr').nth(1).locator('td').allInnerTexts();
        if (cells.join(',') !== 'Zable,Closed,80') throw new Error(`row 2: ${cells}`);
      }
    },
  );

  await step("a web page's table (HTML on the clipboard) becomes a table too, with the text of its cells", async () => {
    await paste(meg.page, {
      'text/html':
        '<meta charset="utf-8"><table><tr><th>Name</th><th>Role</th></tr><tr><td>Ann <b>Agent</b></td><td>cs_agent</td></tr><tr><td>Bob</td><td>Sales | UK</td></tr></table>',
      'text/plain': 'Name Role Ann Agent cs_agent Bob Sales | UK',
    });
    await meg.page.waitForFunction(
      () => /\| Name \| Role \|/.test(document.querySelector('.panel > .input-bar textarea').value),
      null,
      { timeout: 4000 },
    );
    await meg.page.waitForTimeout(1100); // the server takes one message a second from a person
    await box(meg.page).focus();
    await meg.page.keyboard.press('Enter');
    const table = ann.page.locator('.msg .msg-table').last();
    await table.waitFor({ timeout: 8000 });
    await ann.page.waitForFunction(
      () => {
        const t = [...document.querySelectorAll('.msg .msg-table')].pop();
        return t && t.querySelector('th')?.textContent === 'Name';
      },
      null,
      { timeout: 8000 },
    );
    const cells = await table.locator('tbody tr').nth(1).locator('td').allInnerTexts();
    if (cells.join(',') !== 'Bob,Sales | UK') throw new Error(`pipe inside a cell: ${cells}`);
  });

  await step('ordinary pasted text is left alone', async () => {
    await paste(meg.page, { 'text/plain': 'just a sentence' });
    await meg.page.waitForTimeout(300);
    const value = await box(meg.page).inputValue();
    if (value !== '') throw new Error(`the box took the paste over: "${value}"`);
  });

  await browser.close();
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  console.log(`\nbrowser errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 'none'}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
