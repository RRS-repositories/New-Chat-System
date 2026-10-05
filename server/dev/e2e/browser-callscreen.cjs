// Real-browser check of the redesigned call screen against the local harness
// (node server/dev/local.mjs → http://localhost:5021), three people in a real call:
// the tile grid, speaking lights from real audio, reactions, raised hands, minimise and restore,
// the stand-in host when the starter leaves, the phone layout, and the eight-person grid.
//   node server/dev/e2e/browser-callscreen.cjs [screenshot.png]
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
const gone = (page, selector, timeout = 10000) => page.waitForSelector(selector, { state: 'detached', timeout });

async function person(browser, email, label, viewport = { width: 1280, height: 760 }) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'notifications'], viewport });
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
  // On a phone the channel list is a drawer; the app opens General by itself.
  if (viewport.width >= 760) await page.locator('.chan-row', { hasText: 'General' }).first().click();
  await page.waitForSelector('.panel > .input-bar textarea');
  return { ctx, page, label };
}
const tile = (page, name) => page.locator(tid('call-participant'), { hasText: name });
const liveAudio = (page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll('audio')].filter(
        (a) => a.srcObject && a.srcObject.getAudioTracks()[0]?.readyState === 'live' && !a.paused,
      ).length,
  );
const waitAudio = async (page, n, what) => {
  const started = Date.now();
  let last = 0;
  while (Date.now() - started < 20000) {
    last = await liveAudio(page);
    if (last >= n) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`${what}: expected ${n} live remote audio, saw ${last}`);
};

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
  const bob = await person(browser, 'b@x', 'Bob', { width: 390, height: 800 });

  await step('the call opens as a full dark stage; each person is a tile that has real height', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'));
    for (const p of [ann, bob]) {
      await p.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
      await p.page.click(tid('incoming-accept'));
      await p.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    }
    for (const p of [meg, ann, bob]) await waitAudio(p.page, 2, `${p.label} hears two`);
    const sizes = await meg.page.evaluate(
      (sel) => [...document.querySelectorAll(sel)].map((el) => [el.offsetWidth, el.offsetHeight]),
      tid('call-participant'),
    );
    if (sizes.length !== 3) throw new Error(`${sizes.length} tiles`);
    if (sizes.some(([w, h]) => w < 200 || h < 150)) throw new Error(`a tile is too small: ${JSON.stringify(sizes)}`);
    const covers = await meg.page.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return r.width === window.innerWidth && r.height === window.innerHeight;
    }, tid('call-panel'));
    if (!covers) throw new Error('the call screen does not cover the app');
  });
  await step('a tile lights up while that person is speaking, and never while they are muted', async () => {
    // The fake microphone beeps: other people's tiles must light at some point.
    await meg.page.waitForSelector(`${tid('call-participant')}.speaking`, { timeout: 15000 });
    await ann.page.click(tid('call-mute'));
    await tile(meg.page, 'Ann Agent').locator('[aria-label="muted"]').waitFor({ timeout: 8000 });
    for (let i = 0; i < 12; i++) {
      if (await meg.page.locator(`${tid('call-participant')}.speaking`, { hasText: 'Ann Agent' }).count())
        throw new Error('a muted person is shown as speaking');
      await meg.page.waitForTimeout(250);
    }
    await ann.page.click(tid('call-mute'));
  });
  await step('a reaction floats up on everyone’s screen with the sender’s name', async () => {
    await ann.page.click(tid('call-react'));
    await ann.page.locator('.crpick button[aria-label="React 🎉"]').click();
    await meg.page
      .locator('.remoji', { hasText: '🎉' })
      .locator('small', { hasText: 'Ann' })
      .waitFor({ timeout: 8000 });
    await ann.page.locator('.remoji', { hasText: 'You' }).waitFor({ timeout: 8000 });
    await meg.page.waitForSelector('.remoji', { state: 'detached', timeout: 8000 });
  });
  await step('raising a hand puts the badge on that tile for everyone; lowering removes it', async () => {
    await ann.page.click(tid('call-hand'));
    await tile(meg.page, 'Ann Agent').locator(tid('call-hand-up')).waitFor({ timeout: 8000 });
    await tile(bob.page, 'Ann Agent').locator(tid('call-hand-up')).waitFor({ timeout: 8000 });
    if ((await meg.page.locator(tid('call-hand-up')).count()) !== 1) throw new Error('more than one hand shown');
    if ((await ann.page.locator(tid('call-hand')).getAttribute('aria-label')) !== 'Lower hand')
      throw new Error('Ann’s button does not offer to lower her hand');
    await ann.page.click(tid('call-hand'));
    await gone(meg.page, tid('call-hand-up'));
  });
  await step('a menu opened inside the call is drawn above the call screen', async () => {
    await tile(meg.page, 'Ann Agent').hover();
    await tile(meg.page, 'Ann Agent').locator(tid('call-tile-menu')).click();
    const onTop = await meg.page.evaluate(() => {
      const menu = document.querySelector('.cmenu');
      const r = menu.getBoundingClientRect();
      return menu.contains(document.elementFromPoint(r.left + r.width / 2, r.top + 12));
    });
    if (!onTop) throw new Error('the menu is hidden behind the call');
    await meg.page.keyboard.press('Escape');
  });
  if (process.argv[2]) await meg.page.screenshot({ path: process.argv[2] });
  await step('minimise: the call becomes a small pill, the chat is usable, and the audio keeps playing', async () => {
    await meg.page.click(tid('call-minimise'));
    await meg.page.waitForSelector(`${tid('call-panel')}[data-minimised="true"]`);
    await meg.page.fill('.panel > .input-bar textarea', 'typed while on the call');
    await meg.page.keyboard.press('Enter');
    await meg.page.locator('.feed .msg', { hasText: 'typed while on the call' }).waitFor({ timeout: 8000 });
    await waitAudio(meg.page, 2, 'Meg still hears two while minimised');
    const clock = await meg.page.locator('.mini .mi-i span span').last().textContent();
    if (!/^\d\d:\d\d$/.test(clock)) throw new Error(`the pill shows "${clock}"`);
    await meg.page.click(tid('call-expand'));
    await meg.page.waitForSelector(`${tid('call-participant')}`);
    if ((await meg.page.locator(tid('call-participant')).count()) !== 3) throw new Error('people were lost on restore');
    if ((await ann.page.locator(tid('call-participant')).count()) !== 3)
      throw new Error('minimising dropped Meg from the call');
  });
  await step('phone: two columns of tiles, and the dock fits on the screen', async () => {
    const layout = await bob.page.evaluate((sel) => {
      const tiles = [...document.querySelectorAll(sel)].map((el) => el.getBoundingClientRect());
      const dock = document.querySelector('.c-dockin').getBoundingClientRect();
      return {
        columns: new Set(tiles.map((r) => Math.round(r.left))).size,
        smallest: Math.min(...tiles.map((r) => r.height)),
        dockInside: dock.left >= 0 && dock.right <= window.innerWidth + 1,
        leaveVisible: !!document.querySelector('[data-testid="call-leave"]').offsetWidth,
      };
    }, tid('call-participant'));
    if (layout.columns !== 2) throw new Error(`${layout.columns} columns`);
    if (layout.smallest < 100) throw new Error(`a tile is ${layout.smallest}px high`);
    if (!layout.dockInside || !layout.leaveVisible) throw new Error('the dock does not fit');
  });
  await step('eight people: four columns, two rows, and no tile collapses to nothing', async () => {
    const sizes = await ann.page.evaluate((sel) => {
      const grid = document.querySelector('.c-grid');
      const model = grid.querySelector(sel);
      const added = [];
      while (grid.children.length < 8) added.push(grid.appendChild(model.cloneNode(true)));
      grid.style.setProperty('--cols', '4');
      const out = [...grid.children].map((el) => [Math.round(el.offsetWidth), Math.round(el.offsetHeight)]);
      for (const el of added) el.remove();
      grid.style.setProperty('--cols', '2');
      return out;
    }, tid('call-participant'));
    if (sizes.length !== 8) throw new Error(`${sizes.length} tiles`);
    if (sizes.some(([w, h]) => h < 120 || w < 150)) throw new Error(`collapsed tile: ${JSON.stringify(sizes)}`);
  });
  await step('the starter leaves: the person in the call longest becomes host, and has the host menu', async () => {
    await meg.page.click(tid('call-leave'));
    await gone(meg.page, tid('call-panel'));
    await tile(ann.page, 'Ann Agent').locator('.call-host-tag').waitFor({ timeout: 8000 });
    await tile(bob.page, 'Ann Agent').locator('.call-host-tag').waitFor({ timeout: 8000 });
    await tile(ann.page, 'Bob Sales').hover();
    await tile(ann.page, 'Bob Sales').locator(tid('call-tile-menu')).click();
    await ann.page.waitForSelector(tid('call-host-mute'));
    await ann.page.keyboard.press('Escape');
  });
  await step('the starter comes back and is the host again', async () => {
    await meg.page.click(tid('call-banner-join'));
    await meg.page.waitForSelector(tid('call-panel'));
    await tile(ann.page, 'Meg Manager').locator('.call-host-tag').waitFor({ timeout: 10000 });
    if (await tile(ann.page, 'Ann Agent').locator('.call-host-tag').count())
      throw new Error('Ann is still marked host');
    for (const p of [meg, ann, bob]) await p.page.click(tid('call-leave'));
    await meg.page
      .getByText(/Voice call — /)
      .first()
      .waitFor({ timeout: 10000 });
  });

  // A one-to-one call shows "Calling…" until the other person answers.
  const cy = await person(browser, 'c@x', 'Cy');
  await step('one-to-one: the caller sees "Calling…" with Cancel until it is answered', async () => {
    await meg.page.click('button[aria-label="New message"]');
    await meg.page.locator('.pick-row', { hasText: 'Cy Sales' }).click();
    await meg.page.waitForFunction(() => /\/channels\//.test(location.pathname));
    await meg.page.locator('.m-title', { hasText: 'Cy Sales' }).waitFor();
    await meg.page.click(tid('call-start'));
    await meg.page.locator(tid('call-ringing-out'), { hasText: 'Cy Sales' }).waitFor({ timeout: 10000 });
    await cy.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await cy.page.click(tid('incoming-accept'));
    await gone(meg.page, tid('call-ringing-out'), 15000);
    await waitAudio(meg.page, 1, 'Meg hears Cy');
    await meg.page.click(tid('call-leave'));
    await gone(cy.page, tid('call-panel'), 15000);
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
