// Real-browser check of four polish items (12 Oct 2026): quick reactions on the hover bar, dragging
// sidebar rows into an order that survives a reload, the All / Recent switch on Direct messages, and
// landing on the first unread message with the "N new" pill.
// Against the local harness (node server/dev/local.mjs → http://localhost:5021).
//   node server/dev/e2e/browser-ux.cjs
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
const tid = (id) => `[data-testid="${id}"]`;

async function token(email) {
  const r = await fetch(`${BASE}/api/chat/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'local' }),
  });
  return (await r.json()).token;
}
async function person(browser, email, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
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
  await page.waitForSelector('.sidebar-user', { timeout: 20000 });
  await page.locator('.chan-row', { hasText: 'General' }).first().click();
  await page.waitForSelector('.panel > .input-bar textarea');
  return { ctx, page, label, token: await token(email) };
}
const row = (page, name) => page.locator('.chan-list .chan-row', { hasText: name }).first();
const send = async (page, text) => {
  await page.fill('.panel > .input-bar textarea', text);
  await page.keyboard.press('Enter');
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  const meg = await person(browser, 'm@x', 'Meg');
  const ann = await person(browser, 'a@x', 'Ann');
  let rotaId = '';

  await step('set-up: a channel "Rota" with Meg and Ann', async () => {
    const r = await fetch(`${BASE}/api/chat/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${meg.token}` },
      body: JSON.stringify({ displayName: 'Rota', type: 'private', memberIds: [2] }),
    });
    rotaId = (await r.json()).channel.id;
    await meg.page.reload({ waitUntil: 'domcontentloaded' });
    await row(meg.page, 'Rota').waitFor({ timeout: 15000 });
    await row(ann.page, 'Rota').waitFor({ timeout: 15000 });
  });

  await step('quick reactions: three one-tap emojis on the hover bar; the first reacts at once', async () => {
    await send(meg.page, 'quick react me');
    const msg = ann.page.locator('.msg', { hasText: 'quick react me' }).last();
    await msg.waitFor({ timeout: 8000 });
    await msg.hover();
    const quick = msg.locator(tid('quick-react'));
    if ((await quick.count()) !== 3) throw new Error(`${await quick.count()} quick reactions`);
    const emoji = await quick.first().innerText();
    await quick.first().click();
    await meg.page
      .locator('.msg', { hasText: 'quick react me' })
      .last()
      .locator('.reaction-pill .e', { hasText: emoji })
      .waitFor({ timeout: 8000 });
  });

  await step('drag a sidebar row: Rota above General; the order survives a reload', async () => {
    const names = async (page) => page.locator('.chan-group').nth(0).locator('.chan-name').allInnerTexts();
    const before = await names(meg.page);
    if (before[0] === 'Rota') throw new Error(`Rota is already first: ${before}`);
    await row(meg.page, 'Rota').locator('..').dragTo(row(meg.page, 'General').locator('..'));
    await meg.page.waitForFunction(
      () => document.querySelector('.chan-group .chan-name')?.textContent === 'Rota',
      null,
      { timeout: 5000 },
    );
    await meg.page.reload({ waitUntil: 'domcontentloaded' });
    await row(meg.page, 'Rota').waitFor({ timeout: 15000 });
    const after = await names(meg.page);
    if (after[0] !== 'Rota') throw new Error(`after reload: ${after}`);
  });

  await step('Direct messages: the All / Recent switch, and "Show all" when some are hidden', async () => {
    // Meg opens a direct message with Ann so the section exists.
    await meg.page.click('button[aria-label="New message"]');
    await meg.page.locator('.pick-row', { hasText: 'Ann Agent' }).click();
    await meg.page.locator('.chan-title', { hasText: 'Ann Agent' }).waitFor({ timeout: 8000 });
    const sw = meg.page.locator(tid('dms-recent'));
    await sw.waitFor({ timeout: 5000 });
    if ((await sw.innerText()).trim().toLowerCase() !== 'all') throw new Error(`switch says ${await sw.innerText()}`);
    await sw.click();
    if ((await sw.innerText()).trim().toLowerCase() !== 'recent') throw new Error('did not switch to Recent');
    // The open conversation stays visible under Recent.
    await row(meg.page, 'Ann Agent').waitFor({ timeout: 5000 });
    await meg.page.reload({ waitUntil: 'domcontentloaded' });
    await meg.page.locator(tid('dms-recent')).waitFor({ timeout: 15000 });
    if ((await meg.page.locator(tid('dms-recent')).innerText()).trim().toLowerCase() !== 'recent')
      throw new Error('Recent was not remembered');
    await meg.page.locator(tid('dms-recent')).click();
  });

  await step('opening a channel with many unread lands on the NEW line and shows the "N new" pill', async () => {
    await meg.page.locator('.chan-row', { hasText: 'Rota' }).first().click();
    await meg.page.locator('.chan-title', { hasText: 'Rota' }).waitFor({ timeout: 8000 });
    // Ann stays on General while 26 messages arrive in Rota (one a second is the limit).
    for (let i = 1; i <= 26; i++) {
      await send(meg.page, `rota line ${i}`);
      await meg.page.waitForTimeout(1050);
    }
    await row(ann.page, 'Rota').locator('.badge', { hasText: '26' }).waitFor({ timeout: 10000 });
    await row(ann.page, 'Rota').click();
    const line = ann.page.locator(tid('new-divider'));
    await line.waitFor({ timeout: 10000 });
    const feed = await ann.page.locator('.feed').boundingBox();
    const box = await line.boundingBox();
    if (!box || !feed || box.y < feed.y || box.y > feed.y + feed.height / 2)
      throw new Error(
        `the NEW line is not near the top of the feed: ${JSON.stringify(box)} in ${JSON.stringify(feed)}`,
      );
    const pill = ann.page.locator(tid('new-pill'));
    await pill.waitFor({ timeout: 5000 });
    if (!/26 new/.test(await pill.innerText())) throw new Error(`pill says ${await pill.innerText()}`);
    // Well above the newest message: the bar at the top says so and "Go to latest" brings you down.
    const bar = ann.page.locator(tid('older-bar'));
    await bar.waitFor({ timeout: 5000 });
    if (!/older messages/.test(await bar.innerText())) throw new Error(`bar says ${await bar.innerText()}`);
    await ann.page.locator(tid('go-latest')).click();
    await bar.waitFor({ state: 'detached', timeout: 5000 });
    await pill.waitFor({ state: 'detached', timeout: 5000 });
    await ann.page.locator('.msg', { hasText: 'rota line 26' }).waitFor({ timeout: 5000 });
    // Scrolling back up brings the bar back; at the bottom it goes.
    await ann.page.locator('.feed').evaluate((el) => {
      el.scrollTop = 0;
    });
    await bar.waitFor({ timeout: 5000 });
    await ann.page.locator('.feed').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await bar.waitFor({ state: 'detached', timeout: 5000 });
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
