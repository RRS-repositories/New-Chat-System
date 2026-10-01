// Real-browser check of the admin panel: people list, per-person "who can they contact" ticks,
// bulk block/allow, and that a block really stops a direct message. Local harness on http://localhost:5021.
//   node server/dev/e2e/browser-admin.cjs [screenshot.png]
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:5021';
const results = []; const errors = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', `${name} — ${String(e.message).split('\n')[0]}`]); } };
const tid = (id) => `[data-testid="${id}"]`;

async function person(browser, email, label) {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 800 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'local');
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar-user', { timeout: 20000 });
  return { ctx, page };
}
const row = (page, name) => page.locator(tid('access-row'), { hasText: name });
const box = (page, name, kind) => row(page, name).locator(`input[data-kind="${kind}"]`);

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const meg = await person(browser, 'm@x', 'Meg (Management)'); const ann = await person(browser, 'a@x', 'Ann');

  await step('Management sees "Admin" in the sidebar; other people do not', async () => {
    await meg.page.locator('.sidebar-foot .chan-row', { hasText: 'Admin' }).waitFor({ timeout: 5000 });
    if (await ann.page.locator('.sidebar-foot .chan-row', { hasText: 'Admin' }).count()) throw new Error('a non-manager sees Admin');
  });
  await step('People list shows everyone with role, chat access and who is online', async () => {
    await meg.page.locator('.sidebar-foot .chan-row', { hasText: 'Admin' }).click();
    await meg.page.locator(tid('admin-person')).first().waitFor({ timeout: 8000 });
    const n = await meg.page.locator(tid('admin-person')).count(); if (n < 6) throw new Error(`only ${n} people listed`);
    const annRow = meg.page.locator(tid('admin-person'), { hasText: 'Ann Agent' });
    if (!/Online/.test(await annRow.innerText())) throw new Error('Ann should show Online');
    await meg.page.fill('[aria-label="Search people"]', 'sales');
    await meg.page.waitForFunction((sel) => document.querySelectorAll(sel).length > 0 && [...document.querySelectorAll(sel)].every((r) => /Sales/.test(r.textContent)), tid('admin-person'), { timeout: 4000 });
    await meg.page.fill('[aria-label="Search people"]', '');
  });
  await step('open a person: every other person is listed with three ticks, all allowed to begin with', async () => {
    await meg.page.locator(tid('admin-person'), { hasText: 'Ann Agent' }).click();
    await meg.page.waitForSelector(tid('admin-user-access'), { timeout: 8000 });
    await row(meg.page, 'Bob Sales').waitFor({ timeout: 8000 });
    for (const k of ['dm', 'call', 'channel']) if (!(await box(meg.page, 'Bob Sales', k).isChecked())) throw new Error(`${k} not allowed by default`);
  });
  await step('untick Messages for one person (both ways): it is saved and shown for both directions', async () => {
    await box(meg.page, 'Bob Sales', 'dm').click();
    await meg.page.waitForFunction((sel) => /is blocked: Messages/.test([...document.querySelectorAll(sel)].find((r) => /Bob Sales/.test(r.textContent))?.textContent || ''), tid('access-row'), { timeout: 8000 });
    await meg.page.reload({ waitUntil: 'domcontentloaded' }); await row(meg.page, 'Bob Sales').waitFor({ timeout: 8000 });
    if (await box(meg.page, 'Bob Sales', 'dm').isChecked()) throw new Error('the block did not persist');
    if (!(await box(meg.page, 'Bob Sales', 'call').isChecked())) throw new Error('calls should still be allowed');
  });
  await step('the block is real: the blocked person is gone from Ann\'s "New message" list', async () => {
    await ann.page.locator('.sidebar-foot .chan-row', { hasText: 'New message' }).click();
    await ann.page.locator('.pick-row', { hasText: 'Meg Manager' }).waitFor({ timeout: 8000 });
    if (await ann.page.locator('.pick-row', { hasText: 'Bob Sales' }).count()) throw new Error('Bob is still offered to Ann');
    await ann.page.keyboard.press('Escape'); await ann.page.locator('[aria-label="Close"]').first().click().catch(() => {});
  });
  await step('"Block all shown" with a role filter blocks that whole role; "Allow all shown" clears it', async () => {
    await meg.page.selectOption('[aria-label="Role"]', 'Sales');
    await meg.page.click(tid('access-block-all'));
    await meg.page.waitForFunction((sel) => { const rows = [...document.querySelectorAll(sel)]; return rows.length > 1 && rows.every((r) => [...r.querySelectorAll('input[data-kind]')].every((i) => !i.checked)); }, tid('access-row'), { timeout: 10000 });
    await meg.page.selectOption('[aria-label="Role"]', '');
    if (!(await box(meg.page, 'Meg Manager', 'dm').isChecked().catch(() => true))) throw new Error('someone outside the filter was blocked');
    if (!(await box(meg.page, 'Eli IT', 'dm').isChecked())) throw new Error('someone outside the filter was blocked');
    if (process.argv[2]) await meg.page.screenshot({ path: process.argv[2] });
    await meg.page.click(tid('access-allow-all'));
    await meg.page.waitForFunction((sel) => { const rows = [...document.querySelectorAll(sel)]; return rows.length > 1 && rows.every((r) => [...r.querySelectorAll('input[data-kind]')].every((i) => i.checked)); }, tid('access-row'), { timeout: 10000 });
  });
  await step('People list counts update, and the "All restrictions" tab still works', async () => {
    await box(meg.page, 'Cy Sales', 'call').click();
    await meg.page.waitForFunction((sel) => /is blocked: Calls/.test([...document.querySelectorAll(sel)].find((r) => /Cy Sales/.test(r.textContent))?.textContent || ''), tid('access-row'), { timeout: 8000 });
    await meg.page.locator('.admin-tab', { hasText: 'People' }).click();
    await meg.page.waitForFunction((sel) => /1 person/.test([...document.querySelectorAll(sel)].find((r) => /Ann Agent/.test(r.textContent))?.textContent || ''), tid('admin-person'), { timeout: 8000 });
    await meg.page.locator('.admin-tab', { hasText: 'All restrictions' }).click();
    await meg.page.getByText('Add a restriction').waitFor({ timeout: 8000 });
    await meg.page.locator('.admin-table', { hasText: 'Cy Sales' }).waitFor({ timeout: 8000 });
  });

  await browser.close();
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  console.log(`\nbrowser errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 'none'}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
