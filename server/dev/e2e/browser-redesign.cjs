// Real-browser check of the redesign's shell and message area against the local harness
// (node server/dev/local.mjs → http://localhost:5021): theme (light/dark, five accents, kept across
// reloads and devices), sidebar, header, side panels, day chips, the NEW line, hover actions,
// the emoji button, toasts, Ctrl+K, and the phone drawer.
//   node server/dev/e2e/browser-redesign.cjs
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
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function token(email) {
  const r = await fetch(`${BASE}/api/chat/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'local' }),
  });
  return (await r.json()).token;
}
const api = (t, method, url, body) =>
  fetch(`${BASE}/api/chat${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());

async function person(browser, email, label, options = {}) {
  const ctx = await browser.newContext(options);
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
  return { ctx, page, label };
}
const css = (page, selector, property) =>
  page.evaluate(([sel, prop]) => getComputedStyle(document.querySelector(sel))[prop], [selector, property]);
const variable = (page, name) =>
  page.evaluate((n) => getComputedStyle(document.body).getPropertyValue(n).trim().toLowerCase(), name);
const closeSettings = (page) => page.click('[role=dialog][aria-label="Settings"] [aria-label="Close"]');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  const megToken = await token('m@x');
  const annToken = await token('a@x');
  const bobToken = await token('b@x');
  const general = (await api(megToken, 'GET', '/channels')).channels.find((c) => c.name === 'general').id;
  // Unread messages waiting for Bob, so the NEW line has something to mark.
  await api(bobToken, 'POST', `/channels/${general}/read`);
  await api(megToken, 'POST', `/channels/${general}/messages`, { content: 'Read before Bob left' });
  await api(bobToken, 'POST', `/channels/${general}/read`);
  await wait(1100);
  await api(megToken, 'POST', `/channels/${general}/messages`, { content: 'First unread for Bob' });
  await api(annToken, 'POST', `/channels/${general}/messages`, { content: 'Second unread for Bob' });

  const meg = await person(browser, 'm@x', 'Meg', { viewport: { width: 1366, height: 800 } });
  await meg.page.locator('.chan-row', { hasText: 'General' }).first().click();
  await meg.page.waitForSelector('.feed .msg');

  // ---- theme ----------------------------------------------------------------
  await step('dark mode flips the whole workspace; light flips it back', async () => {
    const light = await css(meg.page, '.chat-main', 'backgroundColor');
    await meg.page.click('button[aria-label="Settings"]');
    await meg.page.click(tid('theme-mode-dark'));
    if ((await meg.page.getAttribute('body', 'data-mode')) !== 'dark') throw new Error('body is not in dark mode');
    const dark = await css(meg.page, '.chat-main', 'backgroundColor');
    if (dark === light) throw new Error(`main area did not change colour (${dark})`);
    const [r, g, b] = dark.match(/\d+/g).map(Number);
    if (r + g + b > 200) throw new Error(`main area is not dark: ${dark}`);
    const text = (await css(meg.page, '.msg-text', 'color')).match(/\d+/g).map(Number);
    if (text[0] + text[1] + text[2] < 500) throw new Error('message text is not light on dark');
    const dialog = (await css(meg.page, '.modal', 'backgroundColor')).match(/\d+/g).map(Number);
    if (dialog[0] + dialog[1] + dialog[2] > 220) throw new Error('the settings dialog stayed light');
    await meg.page.click(tid('theme-mode-light'));
    if ((await css(meg.page, '.chat-main', 'backgroundColor')) !== light)
      throw new Error('light mode did not come back');
  });
  await step('each of the five colours recolours the accent, buttons and sidebar', async () => {
    const seen = new Set();
    for (const accent of ['ocean', 'sunset', 'emerald', 'magenta', 'violet']) {
      await meg.page.click(tid(`theme-accent-${accent}`));
      seen.add(
        [
          await variable(meg.page, '--violet'),
          await variable(meg.page, '--side'),
          await css(meg.page, '.s-item.active', 'backgroundImage'),
        ].join('|'),
      );
    }
    if (seen.size !== 5) throw new Error(`only ${seen.size} distinct looks`);
  });
  await step('the choice survives a reload, with no flash of the wrong colours', async () => {
    await meg.page.click(tid('theme-mode-dark'));
    await meg.page.click(tid('theme-accent-emerald'));
    await closeSettings(meg.page);
    await wait(400);
    // The page-load script sets the theme before the app starts: check at the earliest moment.
    await meg.page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        window.__themeAtLoad = `${document.body.dataset.mode}/${document.body.dataset.accent}`;
      });
    });
    await meg.page.reload({ waitUntil: 'domcontentloaded' });
    await meg.page.waitForSelector('.sidebar-user');
    const early = await meg.page.evaluate(() => window.__themeAtLoad);
    if (early !== 'dark/emerald') throw new Error(`theme when the page loaded: ${early}`);
    if ((await variable(meg.page, '--violet')) !== '#0fb573') throw new Error('accent lost');
  });
  await step('the choice follows the person to another browser', async () => {
    const again = await person(browser, 'm@x', 'Meg (second device)');
    await again.page.waitForFunction(
      () => document.body.dataset.mode === 'dark' && document.body.dataset.accent === 'emerald',
      null,
      {
        timeout: 10000,
      },
    );
    await again.ctx.close();
  });
  await step('the sign-in page and the admin pages follow the theme too', async () => {
    await meg.page.locator('.chan-row', { hasText: 'Admin' }).click();
    await meg.page.waitForSelector('.admin-table');
    const bg = (await css(meg.page, '.admin-table-wrap', 'backgroundColor')).match(/\d+/g).map(Number);
    if (bg[0] + bg[1] + bg[2] > 220) throw new Error('admin table stayed light in dark mode');
    await meg.page.click('button[aria-label="Close admin"]');
    await meg.page.click('button[aria-label="Settings"]');
    await meg.page.click(tid('theme-mode-light'));
    await meg.page.click(tid('theme-accent-violet'));
    await closeSettings(meg.page);
  });

  // ---- shell ----------------------------------------------------------------
  await step('sidebar: brand, search bar, sections, own card with presence', async () => {
    for (const selector of ['.s-brand .s-logo', '.s-search button', '.s-sec', '.s-me .dot.online', '.s-me .uav'])
      await meg.page.waitForSelector(selector, { timeout: 5000 });
    const width = await meg.page.evaluate(() => document.querySelector('.chat-sidebar').offsetWidth);
    if (width !== 274) throw new Error(`sidebar is ${width}px wide`);
  });
  await step('Ctrl+K opens search; Escape closes it', async () => {
    await meg.page.locator('.chan-row', { hasText: 'General' }).first().click();
    await meg.page.keyboard.press('Control+k');
    await meg.page.waitForSelector(tid('search-input'));
    await meg.page.keyboard.press('Escape');
    await meg.page.waitForSelector(tid('search-input'), { state: 'detached' });
  });
  await step('header buttons open and close the Pinned and Details panels', async () => {
    await meg.page.click('button[aria-label="Pinned messages"]');
    await meg.page.waitForSelector('[aria-label="Pinned messages"].thread-panel');
    if (!(await meg.page.locator('button[aria-label="Pinned messages"].on').count()))
      throw new Error('pin button not lit');
    await meg.page.click('button[aria-label="Channel details"]');
    await meg.page.waitForSelector('[aria-label="Channel details"].thread-panel');
    await meg.page.locator('.mrow', { hasText: 'Meg Manager (you)' }).waitFor();
    await meg.page.click('button[aria-label="Channel details"]');
    await meg.page.waitForSelector('.thread-panel', { state: 'detached' });
  });

  // ---- messages -------------------------------------------------------------
  const bob = await person(browser, 'b@x', 'Bob', { viewport: { width: 1280, height: 760 } });
  await step('opening a channel with unread messages shows the NEW line above the first of them', async () => {
    await bob.page.locator('.chan-row', { hasText: 'General' }).first().click();
    await bob.page.waitForSelector(tid('new-divider'), { timeout: 10000 });
    const after = await bob.page.evaluate(
      (sel) => document.querySelector(sel).nextElementSibling.querySelector('.msg-text')?.textContent,
      tid('new-divider'),
    );
    if (after !== 'First unread for Bob') throw new Error(`NEW is above "${after}"`);
    if ((await bob.page.locator(tid('new-divider')).count()) !== 1) throw new Error('more than one NEW line');
  });
  await step('a day chip heads the messages, and the message area is the only thing that scrolls', async () => {
    const chip = await bob.page.locator('.feed .day span').first().textContent();
    if (chip !== 'Today') throw new Error(`chip says "${chip}"`);
    const overflow = await bob.page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 1);
    if (overflow) throw new Error('the page itself scrolls');
  });
  await step('hover actions: react from the bar; the reaction pill appears for everyone', async () => {
    const message = bob.page.locator('.feed .msg', { hasText: 'Second unread for Bob' });
    await message.hover();
    await message.locator('button[aria-label="React"]').click();
    await bob.page.locator('.epick button[aria-label="React 🎉"]').click();
    await message.locator('.rx.me', { hasText: '🎉' }).waitFor({ timeout: 8000 });
    await meg.page
      .locator('.feed .msg', { hasText: 'Second unread for Bob' })
      .locator('.rx', { hasText: '🎉' })
      .waitFor({ timeout: 8000 });
  });
  await step('own message: More menu edits it; the edit shows for others', async () => {
    await bob.page.fill('.panel > .input-bar textarea', 'Bob wrote this');
    await bob.page.keyboard.press('Enter');
    const sent = bob.page.locator('.feed .msg', { hasText: 'Bob wrote this' });
    await sent.waitFor();
    // By id from here on: while it is being edited its text is in a box, not on the page.
    const mine = bob.page.locator(`[id="${await sent.getAttribute('id')}"]`);
    await mine.hover();
    await mine.locator('button[aria-label="More"]').click();
    await bob.page.locator('.cmenu button[aria-label="Edit"]').click();
    await mine.locator('textarea').fill('Bob changed this');
    await mine.getByRole('button', { name: 'Save' }).click();
    await meg.page.locator('.feed .msg', { hasText: 'Bob changed this' }).locator('.ed').waitFor({ timeout: 8000 });
  });
  await step('the emoji button puts an emoji into the message box', async () => {
    await bob.page.fill('.panel > .input-bar textarea', 'Lunch');
    await bob.page.click('button[aria-label="Emoji"]');
    await bob.page.locator('.epick button[aria-label="Insert 👍"]').click();
    const value = await bob.page.inputValue('.panel > .input-bar textarea');
    if (value !== 'Lunch👍') throw new Error(`box holds "${value}"`);
    await bob.page.fill('.panel > .input-bar textarea', '');
  });
  await step('a message in another conversation shows a toast with Open, which goes there', async () => {
    await wait(1100);
    const dm = (await api(annToken, 'POST', '/channels/dm', { userId: 3 })).channel;
    await api(annToken, 'POST', `/channels/${dm.id}/messages`, { content: 'Toast me, Bob' });
    const toast = bob.page.locator(tid('toast'), { hasText: 'Toast me, Bob' });
    await toast.waitFor({ timeout: 8000 });
    await toast.getByRole('button', { name: 'Open' }).click();
    await bob.page.waitForFunction((id) => location.pathname.includes(id), dm.id, { timeout: 8000 });
    await bob.page.locator('.feed .msg', { hasText: 'Toast me, Bob' }).waitFor();
  });
  await step('an empty conversation shows the person, not a blank page', async () => {
    const dm = (await api(megToken, 'POST', '/channels/dm', { userId: 5 })).channel;
    await meg.page.goto(`${BASE}/channels/${dm.id}`);
    await meg.page.locator('.empty h3', { hasText: 'Cy Sales' }).waitFor({ timeout: 10000 });
  });

  // ---- phone ----------------------------------------------------------------
  const phone = await person(browser, 'c@x', 'Cy (phone)', {
    viewport: { width: 390, height: 800 },
    isMobile: true,
    hasTouch: true,
  });
  await step('phone: the sidebar is a drawer that opens from the burger and closes on the scrim', async () => {
    await phone.page.goto(`${BASE}/channels/${general}`);
    await phone.page.waitForSelector('.feed .msg');
    const hidden = await phone.page.evaluate(
      () => document.querySelector('.chat-sidebar').getBoundingClientRect().right <= 0,
    );
    if (!hidden) throw new Error('drawer is showing before the burger is pressed');
    await phone.page.click('button[aria-label="Channels"]');
    await phone.page.waitForFunction(() => document.querySelector('.chat-sidebar').getBoundingClientRect().left >= 0);
    await phone.page.waitForTimeout(350);
    await phone.page.click('.chat-scrim', { position: { x: 370, y: 400 } });
    await phone.page.waitForFunction(
      () => document.querySelector('.chat-sidebar').getBoundingClientRect().right <= 0,
      null,
      {
        timeout: 5000,
      },
    );
  });
  await step('phone: a side panel covers the screen and closes; nothing scrolls sideways', async () => {
    await phone.page.click('button[aria-label="Channel details"]');
    const width = await phone.page.evaluate(() => document.querySelector('.chat-panel').offsetWidth);
    if (width !== 390) throw new Error(`panel is ${width}px wide`);
    await phone.page.click('.thread-panel [aria-label="Close"]');
    const sideways = await phone.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    if (sideways) throw new Error('the page scrolls sideways');
    if (await phone.page.locator('.input-hint:visible').count()) throw new Error('formatting hint shown on a phone');
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
