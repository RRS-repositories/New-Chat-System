// Real-browser check of the picture viewer against the local harness
// (node server/dev/local.mjs → http://localhost:5021): a tall picture opens whole (not run off the
// bottom), a small one is enlarged but not past twice, zoom in/out/reset and double-click work,
// a zoomed picture scrolls, and Download is offered in the viewer and on the preview.
//   node server/dev/e2e/browser-viewer.cjs [screenshot.png]
const { chromium } = require('playwright-core');
const sharp = require('sharp');

const BASE = process.env.BASE || 'http://localhost:5021';
const VIEW = { width: 1280, height: 760 };
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
const IMG = tid('lightbox-image');

async function person(browser, email, label) {
  const ctx = await browser.newContext({ viewport: VIEW });
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
const png = (width, height, background) =>
  sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer();
async function post(page, name, buffer) {
  await page.setInputFiles('.panel > .input-bar input[type=file]', { name, mimeType: 'image/png', buffer });
  await page.locator('.pending-file', { hasText: name }).waitFor();
  await page.focus('.panel > .input-bar textarea');
  await page.keyboard.press('Enter');
  await page.locator(`.file-image[aria-label="Open ${name}"] img`).waitFor({ timeout: 15000 });
}
const imgBox = (page) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height, right: r.right, bottom: r.bottom, scale: Number(el.dataset.scale) };
  }, IMG);
const open = async (page, name) => {
  await page.click(`.file-image[aria-label="Open ${name}"]`);
  await page.waitForSelector(IMG);
  await page.waitForFunction((sel) => document.querySelector(sel).dataset.scale !== '1' || true, IMG);
  await page.waitForTimeout(150); // onLoad has set the opening size
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  const meg = await person(browser, 'm@x', 'Meg');
  const tall = await png(420, 1400, { r: 30, g: 40, b: 90 });
  const small = await png(300, 200, { r: 230, g: 80, b: 140 });

  await step('set-up: a tall screenshot and a small picture are posted', async () => {
    await post(meg.page, 'tall.png', tall);
    await post(meg.page, 'small.png', small);
  });
  await step('a tall picture opens whole: shrunk to the window, not run off the bottom', async () => {
    await open(meg.page, 'tall.png');
    const b = await imgBox(meg.page);
    if (b.bottom > VIEW.height || b.right > VIEW.width) throw new Error(`runs off the window: ${JSON.stringify(b)}`);
    if (b.scale >= 1) throw new Error(`not shrunk: scale ${b.scale}`);
    if (b.h < VIEW.height * 0.8) throw new Error(`smaller than it needs to be: ${b.h}px tall`);
  });
  await step('zoom in grows it and it then scrolls; the label shows the level; reset goes back', async () => {
    const before = await imgBox(meg.page);
    await meg.page.click('button[aria-label="Zoom in"]');
    await meg.page.click('button[aria-label="Zoom in"]');
    await meg.page.click('button[aria-label="Zoom in"]');
    const after = await imgBox(meg.page);
    if (after.w <= before.w) throw new Error('did not grow');
    const label = await meg.page.locator(tid('lightbox-zoom')).textContent();
    if (label !== `${Math.round(after.scale * 100)}%`) throw new Error(`label "${label}" for scale ${after.scale}`);
    const scrolls = await meg.page.evaluate(() => {
      const box = document.querySelector('.lightbox');
      return box.scrollHeight > box.clientHeight;
    });
    if (!scrolls) throw new Error('zoomed past the window but nothing to scroll');
    await meg.page.click(tid('lightbox-zoom'));
    const reset = await imgBox(meg.page);
    if (Math.abs(reset.w - before.w) > 1) throw new Error(`reset landed at ${reset.w}, opened at ${before.w}`);
  });
  await step('zoom out shrinks it; double-click goes to actual size and back', async () => {
    const opened = await imgBox(meg.page);
    await meg.page.click('button[aria-label="Zoom out"]');
    if ((await imgBox(meg.page)).w >= opened.w) throw new Error('did not shrink');
    await meg.page.dblclick(IMG);
    let b = await imgBox(meg.page);
    if (b.scale !== 1 || Math.abs(b.w - 420) > 1) throw new Error(`double-click: ${JSON.stringify(b)}`);
    await meg.page.dblclick(IMG);
    b = await imgBox(meg.page);
    if (Math.abs(b.w - opened.w) > 1) throw new Error(`back: ${b.w} vs ${opened.w}`);
  });
  await step('the viewer offers Download, saving under the file’s own name', async () => {
    const a = meg.page.locator(tid('lightbox-download'));
    if ((await a.getAttribute('download')) !== 'tall.png') throw new Error('wrong file name');
    if (!/^blob:/.test(await a.getAttribute('href'))) throw new Error('not the fetched picture');
    const [dl] = await Promise.all([meg.page.waitForEvent('download', { timeout: 8000 }), a.click()]);
    if (dl.suggestedFilename() !== 'tall.png') throw new Error(`saved as ${dl.suggestedFilename()}`);
  });
  if (process.argv[2]) await meg.page.screenshot({ path: process.argv[2] });
  await step('Escape closes it', async () => {
    await meg.page.keyboard.press('Escape');
    await meg.page.waitForSelector(IMG, { state: 'detached', timeout: 5000 });
  });
  await step('a small picture is enlarged to read, but only to twice its size', async () => {
    await open(meg.page, 'small.png');
    const b = await imgBox(meg.page);
    if (b.scale !== 2 || Math.abs(b.w - 600) > 1) throw new Error(`opened at ${JSON.stringify(b)}`);
    await meg.page.keyboard.press('Escape');
    await meg.page.waitForSelector(IMG, { state: 'detached' });
  });
  await step('the preview in the feed has its own Download button', async () => {
    const btn = meg.page.locator(`${tid('image-download')}[aria-label="Download small.png"]`);
    if (!(await btn.count())) throw new Error('no button');
    await meg.page.locator('.file-image[aria-label="Open small.png"]').hover();
    const [dl] = await Promise.all([meg.page.waitForEvent('download', { timeout: 10000 }), btn.click()]);
    if (dl.suggestedFilename() !== 'small.png') throw new Error(`saved as ${dl.suggestedFilename()}`);
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
