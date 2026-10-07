// Real-browser check against the local harness (node server/dev/local.mjs → http://localhost:5021):
// adding people to an existing channel, the "only people who have signed in" rule, and
// Management or IT setting a person's password from the admin screen.
//   node server/dev/e2e/browser-people.cjs
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5021';
const results = [];
const errors = [];
const step = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
  } catch (e) {
    results.push([
      'FAIL',
      `${name} — ${String(e.message)
        .split('\n')
        .slice(0, process.env.VERBOSE ? 9 : 1)
        .join(' | ')}`,
    ]);
  }
};
const tid = (id) => `[data-testid="${id}"]`;

async function person(browser, email, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`${label} console: ${m.text().slice(0, 200)}`);
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'local');
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar-user', { timeout: 20000 });
  await page.locator('.chan-row', { hasText: 'General' }).first().click();
  await page.waitForSelector('.panel > .input-bar textarea');
  return { ctx, page, label };
}
const names = (page, selector) => page.locator(`${selector} .pi b`).allInnerTexts();

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  // Meg (Management) and Ann sign in. Bob never does: the rule says he is not offered.
  const meg = await person(browser, 'm@x', 'Meg');
  const ann = await person(browser, 'a@x', 'Ann');

  await step('New message offers only people who have signed in to the chat', async () => {
    await meg.page.click('button[aria-label="New message"]');
    await meg.page.waitForSelector('.pick-row');
    const offered = await names(meg.page, '.pick-row');
    if (!offered.includes('Ann Agent')) throw new Error(`Ann (signed in) is not offered: ${offered}`);
    if (offered.includes('Bob Sales')) throw new Error('Bob, who never signed in, is offered');
    await meg.page.locator('[role=dialog][aria-label="New message"] [aria-label="Close"]').click();
    await meg.page.waitForSelector('[role=dialog][aria-label="New message"]', { state: 'detached' });
  });

  await step('a channel’s details have “Add people”; it lists people not in the channel, and adds them', async () => {
    // Meg makes a private channel with nobody else, then adds Ann from its details.
    await meg.page.click(tid('channels-add'));
    await meg.page.click(tid('menu-new-channel'));
    const dialog = meg.page.locator('[role=dialog][aria-label="New channel"]');
    await dialog.locator('input').first().fill('Rota');
    await dialog.locator('label.check-row input[type=checkbox]').first().check();
    await dialog.locator('button', { hasText: /^Create/ }).click();
    await meg.page.locator('.chan-title', { hasText: 'Rota' }).waitFor({ timeout: 10000 });
    await meg.page.click('button[aria-label="Channel details"]');
    await meg.page.waitForSelector(tid('add-members'));
    await meg.page.click(tid('add-members'));
    await meg.page.waitForSelector(tid('add-members-list'));
    const offered = await names(meg.page, `${tid('add-members-list')} .pick-row`);
    if (!offered.includes('Ann Agent')) throw new Error(`Ann is not offered: ${offered}`);
    if (offered.includes('Meg Manager')) throw new Error('a member is offered');
    if (offered.includes('Bob Sales')) throw new Error('Bob, who never signed in, is offered');
    await meg.page.locator(`${tid('add-members-person')}[data-user-id="2"]`).check();
    await meg.page.click(tid('add-members-save'));
    await meg.page.waitForSelector('[role=dialog][aria-label="Add people"]', { state: 'detached' });
    await meg.page.locator('.mrow', { hasText: 'Ann Agent' }).waitFor({ timeout: 8000 });
    await ann.page.locator('.chan-row', { hasText: 'Rota' }).waitFor({ timeout: 10000 });
  });

  await step('Admin → People says who has never signed in; a person’s page offers “Set a password”', async () => {
    await meg.page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await meg.page.waitForSelector(tid('admin-people'));
    const bob = meg.page.locator(tid('admin-person'), { hasText: 'Bob Sales' });
    await bob.locator('.pill.never').waitFor({ timeout: 8000 });
    const annRow = meg.page.locator(tid('admin-person'), { hasText: 'Ann Agent' });
    if (await annRow.locator('.pill.never').count())
      throw new Error('Ann, who is signed in, is shown as never signed in');
    await bob.click();
    await meg.page.waitForSelector(tid('set-password'));
    await meg.page.click(tid('set-password-open'));
    await meg.page.fill(tid('set-password-new'), 'short');
    await meg.page.fill(tid('set-password-again'), 'short');
    await meg.page.click(tid('set-password-save'));
    await meg.page.locator('.error', { hasText: 'at least 8' }).waitFor({ timeout: 8000 });
    await meg.page.fill(tid('set-password-new'), 'Correct-Horse-9');
    await meg.page.fill(tid('set-password-again'), 'Correct-Horse-9');
    await meg.page.click(tid('set-password-save'));
    await meg.page
      .locator(tid('set-password-done'), { hasText: 'Password set for Bob Sales' })
      .waitFor({ timeout: 8000 });
  });

  await step(
    'Management (or IT) deactivate a person: gone from People, listed under Deactivated, back again on Reactivate',
    async () => {
      await meg.page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
      await meg.page.waitForSelector(tid('admin-people'));
      meg.page.once('dialog', (d) => d.accept());
      await meg.page.locator(tid('admin-person'), { hasText: 'Bob Sales' }).locator(tid('deactivate')).click();
      await meg.page
        .locator(tid('admin-person'), { hasText: 'Bob Sales' })
        .waitFor({ state: 'detached', timeout: 8000 });
      await meg.page.locator('.admin-tabs button', { hasText: 'Deactivated' }).click();
      const bob = meg.page.locator(tid('admin-person'), { hasText: 'Bob Sales' });
      await bob.waitFor({ timeout: 8000 });
      meg.page.once('dialog', (d) => d.accept());
      await bob.locator(tid('reactivate')).click();
      await bob.waitFor({ state: 'detached', timeout: 8000 });
      await meg.page.locator('.admin-tabs button', { hasText: 'People' }).click();
      await meg.page.locator(tid('admin-person'), { hasText: 'Bob Sales' }).waitFor({ timeout: 8000 });
      if (await meg.page.locator(tid('admin-person'), { hasText: 'Meg Manager' }).locator(tid('deactivate')).count())
        throw new Error('Meg can deactivate herself');
    },
  );

  await step('IT sees the admin people list and can set a password, but not the restrictions', async () => {
    const eli = await person(browser, 'eli@x', 'Eli');
    await eli.page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await eli.page.waitForSelector(tid('admin-people'));
    if (await eli.page.locator('.admin-tabs button', { hasText: 'All restrictions' }).count())
      throw new Error('IT sees the restrictions tab');
    if (!(await eli.page.locator(tid('admin-person'), { hasText: 'Bob Sales' }).locator(tid('deactivate')).count()))
      throw new Error('IT has no Deactivate button');
    await eli.page.locator(tid('admin-person'), { hasText: 'Bob Sales' }).click();
    await eli.page.waitForSelector(tid('set-password'));
    if (await eli.page.locator(tid('access-row')).count()) throw new Error('IT sees who Bob may contact');
    await eli.page.click(tid('set-password-open'));
    await eli.page.fill(tid('set-password-new'), 'Correct-Horse-9');
    await eli.page.fill(tid('set-password-again'), 'Correct-Horse-9');
    await eli.page.click(tid('set-password-save'));
    await eli.page.locator(tid('set-password-done')).waitFor({ timeout: 8000 });
  });

  await step('someone who is not Management or IT gets "Management or IT only" at /admin', async () => {
    await ann.page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
    await ann.page.locator('.admin-body', { hasText: 'Management or IT only' }).waitFor({ timeout: 8000 });
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
