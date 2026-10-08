// Real-browser check of the sidebar's conversation menu against the local harness
// (node server/dev/local.mjs → http://localhost:5021): favourites section, mark as read, mute,
// copy link, add people, leave — from the ⋯ button and from a right click.
//   node server/dev/e2e/browser-menu.cjs
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
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 760 },
    permissions: ['clipboard-read', 'clipboard-write'],
  });
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
const rowOf = (page, name) => page.locator('.s-row', { hasText: name }).first();
const openMenu = async (page, name) => {
  const row = rowOf(page, name);
  await row.hover();
  await row.locator(tid('chan-menu')).click();
  await page.waitForSelector('.chan-menu');
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  const meg = await person(browser, 'm@x', 'Meg');
  const ann = await person(browser, 'a@x', 'Ann');

  await step(
    'a channel can be made a favourite: a Favourites section appears at the top, and it leaves the Channels list',
    async () => {
      // Ann makes a channel with Meg so there is something besides General.
      await ann.page.click(tid('channels-add'));
      await ann.page.click(tid('menu-new-channel'));
      const dialog = ann.page.locator('[role=dialog][aria-label="New channel"]');
      await dialog.locator('input').first().fill('Rota');
      await dialog.locator('label.pick-row input[type=checkbox]').first().check();
      await dialog.locator('button', { hasText: /^Create/ }).click();
      await meg.page.locator('.chan-row', { hasText: 'Rota' }).waitFor({ timeout: 10000 });
      await openMenu(meg.page, 'Rota');
      await meg.page.click(tid('menu-favourite'));
      await meg.page.locator(`${tid('favourites')} .chan-row`, { hasText: 'Rota' }).waitFor({ timeout: 8000 });
      const groups = await meg.page.locator('.chan-group-title span:not(.cnt)').allInnerTexts();
      if (groups[0].toLowerCase() !== 'favourites') throw new Error(`sections: ${groups}`);
      if (
        (await meg.page
          .locator('.chan-group:not([data-testid="favourites"]) .chan-row', { hasText: 'Rota' })
          .count()) !== 0
      )
        throw new Error('the favourite is still listed under Channels too');
      if (await ann.page.locator(tid('favourites')).count())
        throw new Error('a favourite is personal, but Ann got it too');
      await meg.page.reload();
      await meg.page.locator(`${tid('favourites')} .chan-row`, { hasText: 'Rota' }).waitFor({ timeout: 10000 });
    },
  );

  await step('a right click opens the same menu; Remove from favourites puts it back under Channels', async () => {
    await rowOf(meg.page, 'Rota').click({ button: 'right' });
    await meg.page.waitForSelector('.chan-menu');
    await meg.page.locator(tid('menu-favourite'), { hasText: 'Remove from favourites' }).click();
    await meg.page.waitForSelector(tid('favourites'), { state: 'detached' });
    await meg.page.locator('.chan-group .chan-row', { hasText: 'Rota' }).waitFor();
  });

  await step('mark as read: the badge goes without opening the channel, and the person is not moved', async () => {
    await meg.page.locator('.chan-row', { hasText: 'General' }).first().click();
    await ann.page.locator('.chan-row', { hasText: 'Rota' }).first().click();
    await ann.page.fill('.panel > .input-bar textarea', 'Rota for next week is up');
    await ann.page.keyboard.press('Enter');
    await rowOf(meg.page, 'Rota').locator('.badge').waitFor({ timeout: 8000 });
    await openMenu(meg.page, 'Rota');
    await meg.page.click(tid('menu-read'));
    await rowOf(meg.page, 'Rota').locator('.badge').waitFor({ state: 'detached', timeout: 8000 });
    if (!/General/.test(await meg.page.locator('.chan-title').innerText()))
      throw new Error('marking read moved the person');
    // The server agrees: the channel is read for Meg on every device.
    await meg.page.reload({ waitUntil: 'domcontentloaded' });
    await meg.page.waitForSelector('.sidebar-user', { timeout: 15000 });
    await rowOf(meg.page, 'Rota').waitFor({ timeout: 8000 });
    if (await rowOf(meg.page, 'Rota').locator('.badge').count()) throw new Error('still unread after a reload');
  });

  await step(
    'mute shows the bell on the row and the menu offers Unmute; copy link puts the address on the clipboard',
    async () => {
      await openMenu(meg.page, 'Rota');
      await meg.page.click(tid('menu-mute'));
      await rowOf(meg.page, 'Rota').locator('[aria-label="Muted"]').waitFor({ timeout: 8000 });
      await openMenu(meg.page, 'Rota');
      await meg.page.locator(tid('menu-mute'), { hasText: 'Unmute' }).waitFor();
      await meg.page.click(tid('menu-mute'));
      await rowOf(meg.page, 'Rota').locator('[aria-label="Muted"]').waitFor({ state: 'detached', timeout: 8000 });
      await openMenu(meg.page, 'Rota');
      await meg.page.click(tid('menu-copy-link'));
      await meg.page.locator(tid('toast'), { hasText: 'Link copied' }).waitFor({ timeout: 5000 });
      const copied = await meg.page.evaluate(() => navigator.clipboard.readText());
      if (!/\/channels\/[0-9a-f-]{36}$/.test(copied)) throw new Error(`clipboard: ${copied}`);
    },
  );

  await step(
    'Add people opens the picker from the menu; a direct message has neither Add people nor Leave; General cannot be left',
    async () => {
      await openMenu(meg.page, 'Rota');
      await meg.page.click(tid('menu-add-people'));
      await meg.page.waitForSelector('[role=dialog][aria-label="Add people"]');
      await meg.page.locator('[role=dialog][aria-label="Add people"] [aria-label="Close"]').click();
      await openMenu(meg.page, 'General');
      if (await meg.page.locator(tid('menu-leave')).count()) throw new Error('General can be left');
      await meg.page.keyboard.press('Escape');
      await meg.page.click('button[aria-label="New message"]');
      await meg.page.locator('.pick-row', { hasText: 'Ann Agent' }).click();
      await meg.page.locator('.m-title', { hasText: 'Ann Agent' }).waitFor();
      await openMenu(meg.page, 'Ann Agent');
      if (await meg.page.locator(tid('menu-add-people')).count()) throw new Error('a direct message offers Add people');
      if (await meg.page.locator(tid('menu-leave')).count()) throw new Error('a direct message offers Leave');
      await meg.page.keyboard.press('Escape');
    },
  );

  await step('Leave channel asks first, then the channel is gone from the list', async () => {
    meg.page.once('dialog', (d) => d.accept());
    await openMenu(meg.page, 'Rota');
    await meg.page.click(tid('menu-leave'));
    await meg.page.locator('.chan-row', { hasText: 'Rota' }).waitFor({ state: 'detached', timeout: 8000 });
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
