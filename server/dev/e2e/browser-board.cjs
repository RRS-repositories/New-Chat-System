// Real-browser check of the call whiteboard against the local harness
// (node server/dev/local.mjs → http://localhost:5021), three people in a real call:
// drawing appears live on the others' boards, a late joiner sees the board as it is, undo takes
// back only your own stroke, only the host can clear, and a new call starts with an empty board.
//   node server/dev/e2e/browser-board.cjs
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
/** How much of the board is drawn on: the number of canvas pixels that are not empty. */
const ink = (page) =>
  page.evaluate((sel) => {
    const cv = document.querySelector(sel);
    if (!cv) return -1;
    const data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
  }, tid('wb-canvas'));
const waitInk = async (page, test, what) => {
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < 8000) {
    last = await ink(page);
    if (test(last)) return last;
    await page.waitForTimeout(200);
  }
  throw new Error(`${what}: the board has ${last} drawn pixels`);
};
/** Draws a straight line across part of the board with the mouse (positions are fractions of the board). */
async function draw(page, from, to) {
  const box = await page.locator(tid('wb-canvas')).boundingBox();
  const at = ([x, y]) => [box.x + x * box.width, box.y + y * box.height];
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  await page.mouse.move(x1, y1);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x1 + ((x2 - x1) * i) / 12, y1 + ((y2 - y1) * i) / 12);
  await page.mouse.up();
}
const near = (a, b) => Math.abs(a - b) <= Math.max(40, b * 0.03);

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
  let megOnly = 0;
  let megAndAnn = 0;

  await step('the host opens the whiteboard and draws; the other person is told and sees it on opening', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'));
    await ann.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await ann.page.click(tid('incoming-accept'));
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await bob.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await bob.page.click(tid('incoming-decline')); // Bob comes in later
    await meg.page.click(tid('call-board'));
    await meg.page.waitForSelector(tid('call-whiteboard'));
    if ((await ink(meg.page)) !== 0) throw new Error('a new board is not empty');
    await draw(meg.page, [0.1, 0.2], [0.5, 0.2]);
    megOnly = await waitInk(meg.page, (n) => n > 200, 'Meg’s own stroke');
    await ann.page.locator(tid('call-board-nudge'), { hasText: 'Meg is drawing' }).waitFor({ timeout: 8000 });
    await ann.page.locator(`${tid('call-board-nudge')} button`).click();
    await ann.page.waitForSelector(tid('call-whiteboard'));
    await waitInk(ann.page, (n) => n > 200, 'Ann sees Meg’s stroke');
    if ((await ann.page.locator(tid('call-participant')).count()) !== 2) throw new Error('the people strip is missing');
  });

  await step('a second person draws and it appears live on the first person’s board', async () => {
    await ann.page.locator(tid('wb-colour')).nth(2).click();
    await ann.page.locator(tid('wb-size')).nth(2).click();
    await draw(ann.page, [0.2, 0.6], [0.7, 0.8]);
    megAndAnn = await waitInk(meg.page, (n) => n > megOnly + 200, 'Meg sees Ann’s stroke');
  });

  await step('someone who joins the call later sees the board as it is', async () => {
    await bob.page.click(tid('call-banner-join'));
    await bob.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await bob.page.click(tid('call-board'));
    await bob.page.waitForSelector(tid('call-whiteboard'));
    await waitInk(bob.page, (n) => n > megOnly + 200, 'Bob sees both strokes');
  });

  await step('undo takes back only your own latest stroke, for everyone', async () => {
    await bob.page.click(tid('wb-undo')); // Bob has drawn nothing: nothing may change
    await bob.page.waitForTimeout(600);
    if (!near(await ink(meg.page), megAndAnn)) throw new Error('Bob’s undo removed someone else’s stroke');
    await ann.page.click(tid('wb-undo'));
    await waitInk(meg.page, (n) => near(n, megOnly), 'Meg’s board after Ann’s undo');
    await waitInk(bob.page, (n) => n > 200, 'Bob still sees Meg’s stroke');
    await ann.page.click(tid('wb-undo')); // Ann has none left
    await ann.page.waitForTimeout(600);
    if (!near(await ink(meg.page), megOnly)) throw new Error('a second undo removed Meg’s stroke');
  });

  await step('the eraser rubs out part of the drawing for everyone', async () => {
    await meg.page.click(tid('wb-eraser'));
    await draw(meg.page, [0.25, 0.1], [0.25, 0.3]);
    await waitInk(ann.page, (n) => n > 0 && n < megOnly - 20, 'Ann’s board after the eraser');
  });

  await step('only the host can clear the board; clearing empties it for everyone', async () => {
    for (const p of [ann, bob])
      if (!(await p.page.locator(tid('wb-clear')).isDisabled())) throw new Error(`${p.label} can clear the board`);
    await meg.page.click(tid('wb-clear'));
    for (const p of [meg, ann, bob]) await waitInk(p.page, (n) => n === 0, `${p.label}’s board after clear`);
  });

  await step('closing the board brings the people back; the drawing is kept; a new call starts empty', async () => {
    await meg.page.click(tid('wb-eraser')); // back to the pen
    await draw(meg.page, [0.3, 0.5], [0.6, 0.5]);
    await waitInk(meg.page, (n) => n > 200, 'Meg draws again');
    await meg.page.click(tid('wb-close'));
    await gone(meg.page, tid('call-whiteboard'));
    await meg.page.locator('.c-grid').waitFor();
    await meg.page.click(tid('call-board'));
    await waitInk(meg.page, (n) => n > 200, 'the drawing after reopening');
    for (const p of [meg, ann, bob]) await p.page.click(tid('call-leave'));
    for (const p of [meg, ann, bob]) await gone(p.page, tid('call-panel'), 15000);
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'));
    await meg.page.click(tid('call-board'));
    await meg.page.waitForSelector(tid('call-whiteboard'));
    await meg.page.waitForTimeout(500);
    if ((await ink(meg.page)) !== 0) throw new Error('the new call’s board is not empty');
    await meg.page.click(tid('call-leave'));
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
