// Real-browser check against the local harness (node server/dev/local.mjs → http://localhost:5021):
// the person card (click a name or photo → card → Message opens the conversation) and the line that
// asks to turn notifications on.
//   node server/dev/e2e/browser-profile.cjs
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

async function person(browser, email, label, permissions = []) {
  // An empty permissions list makes Chromium report notifications as denied, so it is left out when there is nothing to grant.
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 760 },
    ...(permissions.length ? { permissions } : {}),
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

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  const meg = await person(browser, 'm@x', 'Meg'); // no notification permission yet
  const ann = await person(browser, 'a@x', 'Ann', ['notifications']);

  await step('without notification permission a line asks to turn them on; with permission there is none', async () => {
    await meg.page.waitForSelector(tid('notify-nudge'));
    if (await ann.page.locator(tid('notify-nudge')).count())
      throw new Error('Ann already has permission and still sees the line');
  });

  await step('"Not now" hides the line and it stays hidden after a reload', async () => {
    await meg.page.click(tid('notify-nudge-later'));
    await meg.page.waitForSelector(tid('notify-nudge'), { state: 'detached' });
    await meg.page.reload();
    await meg.page.waitForSelector('.panel > .input-bar textarea');
    await meg.page.waitForTimeout(500);
    if (await meg.page.locator(tid('notify-nudge')).count()) throw new Error('the line came back after Not now');
  });

  await step('clicking a name on a message opens the person’s card with their presence', async () => {
    await ann.page.fill('.panel > .input-bar textarea', 'hello from Ann');
    await ann.page.keyboard.press('Enter');
    const msg = meg.page.locator('.msg', { hasText: 'hello from Ann' }).last();
    await msg.waitFor({ timeout: 8000 });
    await msg.locator('.msg-author').click();
    const card = meg.page.locator(tid('profile-card'));
    await card.waitFor();
    if (!/Ann Agent/.test(await card.innerText())) throw new Error(`card: ${await card.innerText()}`);
    await card.locator('.pc-pres', { hasText: 'Online' }).waitFor({ timeout: 8000 });
    await card.locator('.pc-role', { hasText: 'cs_agent' }).waitFor({ timeout: 8000 });
  });

  await step('Message on the card opens the direct conversation with that person', async () => {
    await meg.page.click(tid('profile-message'));
    await meg.page.locator('.m-title', { hasText: 'Ann Agent' }).waitFor({ timeout: 10000 });
    await meg.page.waitForFunction(() => /\/channels\//.test(location.pathname));
  });

  await step('clicking the photo works too, your own card has no Message button, and Escape closes it', async () => {
    await meg.page.locator('.chan-row', { hasText: 'General' }).first().click();
    await meg.page.fill('.panel > .input-bar textarea', 'my own message');
    await meg.page.keyboard.press('Enter');
    const mine = meg.page.locator('.msg', { hasText: 'my own message' }).last();
    await mine.waitFor({ timeout: 8000 });
    await mine.locator('.gav .person-btn').click();
    const card = meg.page.locator(tid('profile-card'));
    await card.waitFor();
    if (!/\(you\)/.test(await card.innerText())) throw new Error('own card not marked as you');
    if (await meg.page.locator(tid('profile-message')).count()) throw new Error('a Message button to yourself');
    await meg.page.keyboard.press('Escape');
    await meg.page.waitForSelector(tid('profile-card'), { state: 'detached' });
  });

  await step('the members list opens the card as well', async () => {
    await meg.page.click('button[aria-label="Channel details"]');
    await meg.page.locator('.mrow', { hasText: 'Ann Agent' }).locator('.person-btn').click();
    await meg.page.locator(tid('profile-card'), { hasText: 'Ann Agent' }).waitFor();
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
