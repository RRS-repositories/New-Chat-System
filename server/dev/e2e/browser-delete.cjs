// Real-browser check that only the people named in CHAT_CHANNEL_DELETERS see and can use "Delete
// channel", against the local harness (node server/dev/local.mjs → http://localhost:5021, where
// Meg, m@x, is the one person named).
//   node server/dev/e2e/browser-delete.cjs
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
const rowOf = (page, name) => page.locator('.s-row', { hasText: name }).first();
const openMenu = async (page, name) => {
  const row = rowOf(page, name);
  await row.hover();
  await row.locator(tid('chan-menu')).click();
  await page.waitForSelector('.chan-menu');
};
/** The person's own sign-in token, as the app keeps it in the browser. */
const tokenOf = (page) =>
  page.evaluate(() => {
    for (let i = 0; i < localStorage.length; i++) {
      try {
        const v = JSON.parse(localStorage.getItem(localStorage.key(i)));
        if (v && typeof v.token === 'string') return v.token;
      } catch {}
    }
    return null;
  });

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  const meg = await person(browser, 'm@x', 'Meg');
  const ann = await person(browser, 'a@x', 'Ann');
  const NAME = 'Old rota';
  let channelId = null;

  await step('Ann (not named) makes a channel with Meg; her ⋯ menu has Leave but no Delete', async () => {
    await ann.page.click(tid('channels-add'));
    await ann.page.click(tid('menu-new-channel'));
    const dialog = ann.page.locator('[role=dialog][aria-label="New channel"]');
    await dialog.locator('input').first().fill(NAME);
    await dialog.locator('label.pick-row input[type=checkbox]').first().check();
    await dialog.locator('button', { hasText: /^Create/ }).click();
    await rowOf(ann.page, NAME).waitFor({ timeout: 10000 });
    await rowOf(meg.page, NAME).waitFor({ timeout: 10000 });
    await openMenu(ann.page, NAME);
    await ann.page.waitForSelector(tid('menu-leave'));
    if (await ann.page.locator(tid('menu-delete')).count()) throw new Error('Ann is offered Delete channel');
    await ann.page.keyboard.press('Escape');
  });

  await step('the server refuses Ann too, naming the rule', async () => {
    await rowOf(ann.page, NAME).click();
    await ann.page.waitForURL(/\/channels\/[0-9a-f-]+/, { timeout: 8000 });
    channelId = ann.page.url().match(/\/channels\/([0-9a-f-]+)/)[1];
    const token = await tokenOf(ann.page);
    if (!token) throw new Error('no token in storage');
    const r = await ann.page.evaluate(
      async ([id, t]) => {
        const res = await fetch(`/api/chat/channels/${id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${t}` },
        });
        return { status: res.status, body: await res.json() };
      },
      [channelId, token],
    );
    if (r.status !== 403 || r.body.code !== 'forbidden') throw new Error(`got ${r.status} ${JSON.stringify(r.body)}`);
    if (!/people the owner named/.test(r.body.message)) throw new Error(`message: ${r.body.message}`);
  });

  await step('Meg (named) sees Delete channel in the ⋯ menu, and /users/me says so', async () => {
    const token = await tokenOf(meg.page);
    const me = await meg.page.evaluate(
      async (t) => (await fetch('/api/chat/users/me', { headers: { Authorization: `Bearer ${t}` } })).json(),
      token,
    );
    if (me.user?.canDeleteChannels !== true) throw new Error(`me: ${JSON.stringify(me.user)}`);
    await openMenu(meg.page, NAME);
    await meg.page.waitForSelector(tid('menu-delete'), { timeout: 5000 });
    await meg.page.keyboard.press('Escape');
  });

  await step('Meg deletes it: the channel leaves both sidebars', async () => {
    meg.page.once('dialog', (d) => d.accept());
    await openMenu(meg.page, NAME);
    await meg.page.click(tid('menu-delete'));
    await rowOf(meg.page, NAME).waitFor({ state: 'detached', timeout: 10000 });
    await rowOf(ann.page, NAME).waitFor({ state: 'detached', timeout: 10000 });
  });

  await browser.close();
  for (const [s, n] of results) console.log(s, n);
  if (errors.length) console.log('page errors:', errors.join('\n  '));
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(`${results.length - failed}/${results.length} passed`);
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
