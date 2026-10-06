// Real-browser check of messaging, unread-while-not-looking, mentions in the tab title, presence dots
// and settings, against the local harness (node server/dev/local.mjs → http://localhost:5021).
//   node server/dev/e2e/browser-notify.cjs [screenshot.png]
// Uses the Edge already installed on the machine (no browser download).
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
  const ctx = await browser.newContext({ permissions: ['notifications'] });
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
  await page.waitForSelector('textarea');
  return { ctx, page };
}
const send = async (page, text) => {
  await page.fill('textarea', text);
  await page.keyboard.press('Enter');
};
// "Not being looked at" = the tab has lost focus. Headless pages always report focus, so simulate the blur.
const lookAway = (page) =>
  page.evaluate(() => {
    window.__hasFocus = window.__hasFocus || Document.prototype.hasFocus;
    Document.prototype.hasFocus = () => false;
    window.dispatchEvent(new Event('blur'));
  });
const lookBack = (page) =>
  page.evaluate(() => {
    Document.prototype.hasFocus = window.__hasFocus;
    window.dispatchEvent(new Event('focus'));
  });
const generalRow = (page) => page.locator('.chan-list .chan-row', { hasText: 'General' }).first();

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ann = await signIn(browser, 'a@x', 'Ann');
  const meg = await signIn(browser, 'm@x', 'Meg');

  await step('a message sent by one person appears for the other without a reload', async () => {
    await send(meg.page, 'hello from Meg');
    await ann.page.locator('.msg', { hasText: 'hello from Meg' }).waitFor({ timeout: 8000 });
  });
  await step('while the channel is open and being looked at, no unread badge appears', async () => {
    await ann.page.waitForTimeout(1200);
    if (await generalRow(ann.page).locator('.badge').count()) throw new Error('badge shown while looking');
  });
  await step('not looking at the chat: the open channel is NOT marked read, the badge counts up', async () => {
    await lookAway(ann.page);
    await meg.page.waitForTimeout(1100);
    await send(meg.page, 'are you there?');
    await generalRow(ann.page).locator('.badge', { hasText: '1' }).waitFor({ timeout: 8000 });
  });
  await step('a mention while not looking shows in the tab title', async () => {
    await meg.page.waitForTimeout(1100);
    await send(meg.page, '@Ann Agent please look');
    await ann.page.waitForFunction(() => /^\(1\) Chat/.test(document.title), null, { timeout: 8000 });
    await generalRow(ann.page).locator('.badge.mention').waitFor({ timeout: 4000 });
  });
  await step('looking again marks it read: badge and title clear', async () => {
    await lookBack(ann.page);
    await ann.page.waitForFunction(() => document.title === 'Chat', null, { timeout: 8000 });
    await ann.page.waitForFunction(() => !document.querySelector('.chan-list .chan-row .badge'), null, {
      timeout: 8000,
    });
  });
  await step('presence: a direct-message row shows the other person Online', async () => {
    await ann.page.locator('.sidebar-head button[aria-label="New message"]').click();
    await ann.page.locator('.pick-row', { hasText: 'Meg Manager' }).click();
    await ann.page
      .locator('.chan-list .chan-row', { hasText: 'Meg Manager' })
      .locator('.dot.online')
      .waitFor({ timeout: 8000 });
  });
  await step('settings: sound preference saves and survives a reload', async () => {
    await ann.page.locator('button[aria-label="Settings"]').click();
    const box = ann.page.locator('label.check-row', { hasText: 'Sounds' }).locator('input');
    await box.waitFor();
    if (!(await box.isChecked())) throw new Error('expected sound on by default');
    await box.uncheck();
    await ann.page.waitForTimeout(800);
    await ann.page.keyboard.press('Escape');
    await ann.page.waitForFunction(() => !document.querySelector('[aria-label="Settings"][role=dialog]'), null, {
      timeout: 4000,
    });
    await ann.page.reload({ waitUntil: 'domcontentloaded' });
    await ann.page.waitForSelector('.sidebar-user');
    await ann.page.locator('button[aria-label="Settings"]').click();
    const again = ann.page.locator('label.check-row', { hasText: 'Sounds' }).locator('input');
    await again.waitFor();
    if (await again.isChecked()) throw new Error('sound setting did not persist');
    await ann.page.keyboard.press('Escape');
  });
  await step('settings: own status shows to the other person', async () => {
    await meg.page.locator('button[aria-label="Settings"]').click();
    await meg.page.fill('[aria-label="Status text"]', 'In court today');
    const save = meg.page
      .locator('[role=dialog][aria-label="Settings"] button', { hasText: /save|set|update/i })
      .first();
    if (await save.count()) await save.click();
    else await meg.page.keyboard.press('Enter');
    await meg.page.waitForTimeout(1000);
    await meg.page.keyboard.press('Escape');
    const row = ann.page.locator('.chan-list .chan-row', { hasText: 'Meg Manager' });
    await ann.page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('.chan-list .chan-row')].some(
            (r) =>
              /Meg Manager/.test(r.textContent) &&
              r.querySelector('[title*="In court today"], [aria-label*="In court today"]'),
          ),
        null,
        { timeout: 8000 },
      )
      .catch(async () => {
        throw new Error(`status not visible on the DM row (row html: ${(await row.innerHTML()).slice(0, 200)})`);
      });
  });
  await step('the service worker is registered (notifications allowed in this test browser)', async () => {
    const ok = await ann.page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()));
    if (!ok) throw new Error('no service worker registration');
  });
  if (process.argv[2]) await ann.page.screenshot({ path: process.argv[2] });
  await step("presence: closing the other person's browser shows them Offline", async () => {
    await meg.ctx.close();
    await ann.page
      .locator('.chan-list .chan-row', { hasText: 'Meg Manager' })
      .locator('.dot.offline')
      .waitFor({ timeout: 12000 });
  });

  await browser.close();
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  console.log(`\nbrowser errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 'none'}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
