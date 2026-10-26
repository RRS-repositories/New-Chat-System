// Real-browser check of the draggable minimised-call pill against the local harness
// (node server/dev/local.mjs → http://localhost:5021), two people in a real call:
// the pill can be dragged anywhere, stays inside the window, its buttons still click,
// it no longer covers the Send button once moved, and it comes back where it was left.
//   node server/dev/e2e/browser-pill.cjs [screenshot.png]
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
const PILL = `${tid('call-panel')}[data-minimised="true"]`;
const VIEW = { width: 1280, height: 760 };

async function person(browser, email, label) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'notifications'], viewport: VIEW });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource|Permissions policy violation: camera/.test(m.text()))
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

/** Where the pill is, measured once its rise-in animation has finished (it shifts the pill while it plays). */
const rect = (page) =>
  page.evaluate(async (sel) => {
    const el = document.querySelector(sel);
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }, PILL);
const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
/** Drags the pill by its name area (never a button) to put its top-left corner at (x, y). */
async function dragPillTo(page, x, y) {
  const r = await rect(page);
  const grab = await page.evaluate((sel) => {
    const g = document.querySelector(`${sel} .mi-i`).getBoundingClientRect();
    return { x: g.left + 8, y: g.top + g.height / 2 };
  }, PILL);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(grab.x + (x - r.left), grab.y + (y - r.top), { steps: 12 });
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: !process.env.HEADED,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const meg = await person(browser, 'm@x', 'Meg');
  const ann = await person(browser, 'a@x', 'Ann');

  await step('a call, minimised, starts as a pill in the bottom-right corner', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'));
    await ann.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await ann.page.click(tid('incoming-accept'));
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await meg.page.waitForSelector(tid('call-minimise'), { timeout: 15000 });
    await meg.page.click(tid('call-minimise'));
    await meg.page.waitForSelector(PILL);
    const r = await rect(meg.page);
    if (!near(VIEW.width - r.right, 16) || !near(VIEW.height - r.bottom, 16))
      throw new Error(`not in the corner: ${JSON.stringify(r)}`);
  });
  await step('dragging the pill puts it where the pointer lets go', async () => {
    await dragPillTo(meg.page, 300, 120);
    const r = await rect(meg.page);
    if (!near(r.left, 300) || !near(r.top, 120)) throw new Error(`landed at ${r.left},${r.top}`);
  });
  await step('moved out of the corner, the Send button is no longer under the pill', async () => {
    const clear = await meg.page.evaluate(() => {
      const b = document.querySelector('.panel > .input-bar .sendb');
      const r = b.getBoundingClientRect();
      return b.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
    });
    if (!clear) throw new Error('something still covers the Send button');
  });
  await step('the buttons on the pill still click, and a click does not move it', async () => {
    const before = await rect(meg.page);
    await meg.page.locator(`${PILL} ${tid('call-mute')}`).click();
    if ((await meg.page.locator(`${PILL} ${tid('call-mute')}`).getAttribute('aria-pressed')) !== 'true')
      throw new Error('mute did not take');
    await meg.page.locator(`${PILL} ${tid('call-mute')}`).click();
    const after = await rect(meg.page);
    if (!near(after.left, before.left) || !near(after.top, before.top)) throw new Error('the pill moved on a click');
  });
  await step('it cannot be dragged off the screen: it stops a little short of the edge', async () => {
    await dragPillTo(meg.page, -400, -400);
    let r = await rect(meg.page);
    if (!near(r.left, 8) || !near(r.top, 8)) throw new Error(`top-left: ${r.left},${r.top}`);
    await dragPillTo(meg.page, 5000, 5000);
    r = await rect(meg.page);
    if (!near(VIEW.width - r.right, 8) || !near(VIEW.height - r.bottom, 8))
      throw new Error(`bottom-right: right gap ${VIEW.width - r.right}, bottom gap ${VIEW.height - r.bottom}`);
  });
  await step('a smaller window pulls the pill back inside', async () => {
    await meg.page.setViewportSize({ width: 700, height: 500 });
    await meg.page.waitForTimeout(150);
    const r = await rect(meg.page);
    if (r.right > 700 - 8 + 1 || r.bottom > 500 - 8 + 1) throw new Error(`outside: ${JSON.stringify(r)}`);
    await meg.page.setViewportSize(VIEW);
  });
  await step('expand, minimise again: the pill comes back where it was left, and survives a reload', async () => {
    await dragPillTo(meg.page, 420, 200);
    await meg.page.click(`${PILL} ${tid('call-expand')}`);
    await meg.page.waitForSelector(tid('call-minimise'));
    await meg.page.click(tid('call-minimise'));
    await meg.page.waitForSelector(PILL);
    const r = await rect(meg.page);
    if (!near(r.left, 420) || !near(r.top, 200)) throw new Error(`came back at ${r.left},${r.top}`);
    const saved = await meg.page.evaluate(() => localStorage.getItem('chat.callPill'));
    if (!saved || JSON.parse(saved).x !== 420) throw new Error(`not remembered: ${saved}`);
  });
  if (process.argv[2]) await meg.page.screenshot({ path: process.argv[2] });
  await step('the call still works from the moved pill: Leave hangs up', async () => {
    await meg.page.click(`${PILL} ${tid('call-leave')}`);
    await meg.page.waitForSelector(tid('call-panel'), { state: 'detached', timeout: 10000 });
    await ann.page.click(tid('call-leave'));
    await ann.page.waitForSelector(tid('call-panel'), { state: 'detached', timeout: 10000 });
  });

  await browser.close();
  for (const [status, name] of results) console.log(`${status}  ${name}`);
  if (errors.length) console.log('\nBrowser errors:\n' + errors.join('\n'));
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(
    `\n${results.length - failed} of ${results.length} checks passed${errors.length ? `, ${errors.length} browser errors` : ''}.`,
  );
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
