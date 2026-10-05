// Real-browser check of call recording against the local harness
// (node server/dev/local.mjs → http://localhost:5021), three people in a real call:
// only the host can record, everyone sees the REC pill and is told (late joiners too), stopping
// puts a playable file into the conversation, and leaving mid-recording still saves it.
//   node server/dev/e2e/browser-record.cjs
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
const gone = (page, selector, timeout = 10000) => page.waitForSelector(selector, { state: 'detached', timeout });

async function person(browser, email, label) {
  const ctx = await browser.newContext({
    permissions: ['microphone', 'notifications'],
    viewport: { width: 1280, height: 760 },
  });
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
const recordings = (page) => page.locator('.msg', { hasText: 'Call recording' });

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
  const bob = await person(browser, 'b@x', 'Bob');

  await step('only the host can record; when recording starts everyone sees REC and is told', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'));
    await ann.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await ann.page.click(tid('incoming-accept'));
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await bob.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await bob.page.click(tid('incoming-decline')); // Bob comes in later
    await ann.page.waitForSelector(`${tid('call-mute')}:not([disabled])`);
    if (!(await ann.page.locator(tid('call-record')).isDisabled()))
      throw new Error('someone who is not the host can record');
    await meg.page.waitForSelector(`${tid('call-record')}:not([disabled])`);
    await meg.page.click(tid('call-record'));
    for (const p of [meg, ann])
      await p.page.locator(tid('call-rec-pill'), { hasText: 'REC' }).waitFor({ timeout: 8000 });
    await ann.page.locator(tid('toast'), { hasText: 'This call is being recorded' }).waitFor({ timeout: 8000 });
    await meg.page.locator(tid('toast'), { hasText: 'Recording started' }).waitFor({ timeout: 8000 });
    if ((await meg.page.locator(tid('call-record')).getAttribute('aria-label')) !== 'Stop recording')
      throw new Error('the host’s button does not offer to stop');
  });

  await step('someone who joins while it is recording sees REC and is told too', async () => {
    await bob.page.click(tid('call-banner-join'));
    await bob.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await bob.page.locator(tid('call-rec-pill')).waitFor({ timeout: 8000 });
    await bob.page.locator(tid('toast'), { hasText: 'This call is being recorded' }).waitFor({ timeout: 8000 });
  });

  await step('stopping saves the recording into the conversation as a file that plays', async () => {
    await meg.page.waitForTimeout(3000); // a few seconds of call to record
    await meg.page.click(tid('call-record'));
    for (const p of [meg, ann, bob]) await gone(p.page, tid('call-rec-pill'));
    await meg.page
      .locator(tid('toast'), { hasText: 'Recording saved to the conversation' })
      .last()
      .waitFor({ timeout: 15000 });
    // The call screen covers the conversation: Ann minimises it and looks.
    await ann.page.click(tid('call-minimise'));
    const message = recordings(ann.page).last();
    await message.waitFor({ timeout: 10000 });
    const card = message.locator('.file-card');
    if (!/Call recording .*\.webm/.test(await card.innerText()))
      throw new Error(`file card: ${await card.innerText()}`);
    await card.click();
    const video = message.locator('video.file-video');
    await video.waitFor({ timeout: 10000 });
    await ann.page.waitForFunction(
      (el) => el.readyState >= 2 && !el.error && el.currentTime > 0,
      await video.elementHandle(),
      { timeout: 10000 },
    );
    await ann.page.click(tid('call-expand'));
  });

  await step('the host leaving in the middle of a recording still saves it', async () => {
    const before = await recordings(meg.page).count();
    await meg.page.click(tid('call-record'));
    await ann.page.locator(tid('call-rec-pill')).waitFor({ timeout: 8000 });
    await meg.page.waitForTimeout(2500);
    await meg.page.click(tid('call-leave'));
    await gone(meg.page, tid('call-panel'));
    await gone(ann.page, tid('call-rec-pill'));
    await meg.page
      .locator(tid('toast'), { hasText: 'Recording saved to the conversation' })
      .last()
      .waitFor({ timeout: 15000 });
    await meg.page.waitForFunction(
      (n) => [...document.querySelectorAll('.msg')].filter((m) => /Call recording/.test(m.textContent)).length > n,
      before,
      { timeout: 10000 },
    );
    if (!(await ann.page.locator(tid('call-panel')).isVisible())) throw new Error('the call ended for the others');
    for (const p of [ann, bob]) await p.page.click(tid('call-leave'));
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
