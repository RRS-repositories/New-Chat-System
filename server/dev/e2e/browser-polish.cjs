// Real-browser check of: only the message list scrolls, collapsible sidebar sections,
// and viewing a shared screen full-screen or in its own window. Local harness on http://localhost:5021.
//   node server/dev/e2e/browser-polish.cjs [screenshot.png]
const { chromium } = require('playwright-core');
const BASE = process.env.BASE || 'http://localhost:5021';
const results = []; const errors = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', `${name} — ${String(e.message).split('\n')[0]}`]); } };
const tid = (id) => `[data-testid="${id}"]`;

async function person(browser, email, label) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'notifications'], viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'local');
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar-user', { timeout: 20000 });
  await page.locator('.chan-row', { hasText: 'General' }).first().click();
  await page.waitForSelector('textarea');
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required'] });
  const meg = await person(browser, 'm@x', 'Meg'); const ann = await person(browser, 'a@x', 'Ann');

  await step('a long conversation scrolls inside the message list; the page itself does not scroll', async () => {
    for (let i = 0; i < 3; i++) { await meg.page.fill('textarea', Array.from({ length: 40 }, (_, n) => `line ${i}-${n}`).join('\n')); await meg.page.locator('[aria-label="Send"]').click(); await meg.page.waitForTimeout(1200); }
    const m = await meg.page.evaluate(() => {
      const feed = document.querySelector('.feed'); const r = (s) => document.querySelector(s)?.getBoundingClientRect();
      window.scrollTo(0, 99999);
      return { pageScrolls: document.documentElement.scrollHeight > window.innerHeight + 1 || window.scrollY > 0, feedScrolls: feed.scrollHeight > feed.clientHeight + 50,
        headTop: r('.chan-head').top, sideHeadTop: r('.sidebar-head').top, composerBottom: r('textarea').bottom, footBottom: r('.sidebar-foot').bottom, vh: window.innerHeight };
    });
    if (m.pageScrolls) throw new Error(`the page scrolls (${JSON.stringify(m)})`);
    if (!m.feedScrolls) throw new Error('the message list is not the scrolling element');
    if (m.headTop < 0 || m.sideHeadTop < 0 || m.composerBottom > m.vh + 1 || m.footBottom > m.vh + 1) throw new Error(`header/composer/sidebar moved off screen (${JSON.stringify(m)})`);
  });
  await step('sidebar sections collapse and expand on click, and the choice survives a reload', async () => {
    await ann.page.locator('.sidebar-foot .chan-row', { hasText: 'New message' }).click();
    await ann.page.locator('.pick-row', { hasText: 'Meg Manager' }).click();
    const dmTitle = ann.page.locator('button.chan-group-title', { hasText: 'Direct messages' });
    const chTitle = ann.page.locator('button.chan-group-title', { hasText: 'Channels' });
    await chTitle.click();
    if ((await chTitle.getAttribute('aria-expanded')) !== 'false') throw new Error('Channels did not collapse');
    await ann.page.waitForFunction(() => ![...document.querySelectorAll('.chan-list .chan-row')].some((r) => /General/.test(r.textContent)), null, { timeout: 4000 });
    await ann.page.reload({ waitUntil: 'domcontentloaded' }); await ann.page.waitForSelector('.sidebar-user');
    if ((await ann.page.locator('button.chan-group-title', { hasText: 'Channels' }).getAttribute('aria-expanded')) !== 'false') throw new Error('collapse not remembered after reload');
    await ann.page.locator('button.chan-group-title', { hasText: 'Channels' }).click();
    await ann.page.locator('.chan-list .chan-row', { hasText: 'General' }).first().waitFor({ timeout: 4000 });
    await dmTitle.click(); await dmTitle.click();
    await ann.page.locator('.chan-list .chan-row', { hasText: 'General' }).first().click();
  });
  await step('a shared screen can be opened in its own window and shows the live picture there', async () => {
    await meg.page.locator('.chan-row', { hasText: 'General' }).first().click();
    await meg.page.click(tid('call-start')); await meg.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await ann.page.waitForSelector(tid('incoming-call'), { timeout: 15000 }); await ann.page.click(tid('incoming-accept'));
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await ann.page.click(tid('call-share'));
    await meg.page.waitForFunction((sel) => { const v = document.querySelector(sel); return v && v.videoWidth > 0; }, tid('call-remote-screen'), { timeout: 20000 });
    const [popup] = await Promise.all([meg.ctx.waitForEvent('page', { timeout: 10000 }), meg.page.click(tid('call-screen-pop'))]);
    await popup.waitForFunction(() => { const v = document.querySelector('video'); return v && v.videoWidth > 0 && !v.paused; }, null, { timeout: 15000 });
    await meg.page.locator(tid('call-screen-back')).waitFor({ timeout: 4000 });
    if (process.argv[2]) await popup.screenshot({ path: process.argv[2] });
    meg.popup = popup;
  });
  await step('when the sharing stops, the separate window closes by itself', async () => {
    await ann.page.click(tid('call-share'));
    const t = Date.now(); while (!meg.popup.isClosed() && Date.now() - t < 15000) await meg.page.waitForTimeout(300);
    if (!meg.popup.isClosed()) throw new Error('the separate window stayed open after the share ended');
  });
  await step('full screen: the shared screen fills the monitor', async () => {
    await ann.page.click(tid('call-share'));
    await meg.page.waitForFunction((sel) => { const v = document.querySelector(sel); return v && v.videoWidth > 0; }, tid('call-remote-screen'), { timeout: 20000 });
    await meg.page.click(tid('call-screen-full'));
    await meg.page.waitForFunction((sel) => document.fullscreenElement === document.querySelector(sel), tid('call-remote-screen'), { timeout: 6000 });
    await meg.page.evaluate(() => document.exitFullscreen());
    await ann.page.click(tid('call-leave')); await meg.page.click(tid('call-leave'));
  });

  await browser.close();
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  console.log(`\nbrowser errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 'none'}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
