// Real-browser check of profile photos against the local harness
// (node server/dev/local.mjs → http://localhost:5021): upload in Settings, the photo appears on
// the person's own messages and sidebar card at once and for other people without a reload,
// removing it brings the initials back, and a file that is not a picture is refused.
//   node server/dev/e2e/browser-avatars.cjs [screenshot.png]
const { chromium } = require('playwright-core');
const sharp = require('sharp');

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
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
/** True when the avatar inside `scope` is showing a loaded photo (an <img> that has a picture in it). */
const hasPhoto = (page, scope) =>
  page.evaluate((sel) => {
    const img = document.querySelector(`${sel} .uav img`);
    return !!img && img.complete && img.naturalWidth > 0;
  }, scope);
const waitPhoto = (page, scope, want = true) =>
  page.waitForFunction(
    ([sel, expected]) => {
      const img = document.querySelector(`${sel} .uav img`);
      return (!!img && img.complete && img.naturalWidth > 0) === expected;
    },
    [scope, want],
    { timeout: 10000 },
  );

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  const ann = await person(browser, 'a@x', 'Ann');
  const bob = await person(browser, 'b@x', 'Bob');
  const photo = await sharp({ create: { width: 900, height: 500, channels: 3, background: { r: 230, g: 80, b: 140 } } })
    .png()
    .toBuffer();

  await step('set-up: Ann has posted, so her avatar is on screen for both', async () => {
    await ann.page.fill('.panel > .input-bar textarea', 'Ann before her photo');
    await ann.page.keyboard.press('Enter');
    await bob.page.locator('.feed .msg', { hasText: 'Ann before her photo' }).waitFor({ timeout: 10000 });
    if (await hasPhoto(ann.page, '.s-me')) throw new Error('Ann already has a photo');
    const initials = await ann.page.locator('.s-me .uav').textContent();
    if (initials !== 'AA') throw new Error(`initials are "${initials}"`);
  });
  await step(
    'Ann uploads a photo in Settings: it shows in Settings, on her card and on her messages at once',
    async () => {
      await ann.page.click('button[aria-label="Settings"]');
      await ann.page.setInputFiles(tid('profile-photo-input'), {
        name: 'me.png',
        mimeType: 'image/png',
        buffer: photo,
      });
      await waitPhoto(ann.page, tid('profile-photo'));
      await ann.page.waitForSelector(tid('profile-photo-remove'));
      await ann.page.click('[role=dialog][aria-label="Settings"] [aria-label="Close"]');
      await waitPhoto(ann.page, '.s-me');
      await waitPhoto(ann.page, '.feed .msg.first');
      const size = await ann.page.evaluate(() => {
        const img = document.querySelector('.s-me .uav img');
        return `${img.naturalWidth}x${img.naturalHeight}`;
      });
      if (size !== '256x256') throw new Error(`stored photo is ${size}`);
    },
  );
  await step('Bob sees it without reloading: on her messages and in the members list', async () => {
    await waitPhoto(bob.page, '.feed .msg.first');
    await bob.page.click('button[aria-label="Channel details"]');
    const row = bob.page.locator('.mrow', { hasText: 'Ann Agent' });
    await row.waitFor();
    await bob.page.waitForFunction(
      () => {
        const row = [...document.querySelectorAll('.mrow')].find((r) => r.textContent.includes('Ann Agent'));
        const img = row && row.querySelector('.uav img');
        return !!img && img.complete && img.naturalWidth > 0;
      },
      null,
      { timeout: 10000 },
    );
    const others = await bob.page.evaluate(
      () =>
        [...document.querySelectorAll('.mrow')].filter(
          (r) => !r.textContent.includes('Ann Agent') && r.querySelector('.uav img'),
        ).length,
    );
    if (others) throw new Error(`${others} other people show a photo`);
    await bob.page.click('.thread-panel [aria-label="Close"]');
  });
  if (process.argv[2]) await bob.page.screenshot({ path: process.argv[2] });
  await step('someone who signs in afterwards sees it too', async () => {
    const meg = await person(browser, 'm@x', 'Meg');
    await waitPhoto(meg.page, '.feed .msg.first');
    await meg.ctx.close();
  });
  await step('a file that is not a picture is refused with a clear message, and the photo stays', async () => {
    await ann.page.click('button[aria-label="Settings"]');
    await ann.page.setInputFiles(tid('profile-photo-input'), {
      name: 'notes.png',
      mimeType: 'image/png',
      buffer: Buffer.from('this is not a picture at all'),
    });
    await ann.page.getByText(/not a picture this browser can read/).waitFor({ timeout: 8000 });
    if (!(await hasPhoto(ann.page, tid('profile-photo')))) throw new Error('the photo was lost');
  });
  await step('Ann removes her photo: initials come back for her and for Bob', async () => {
    await ann.page.click(tid('profile-photo-remove'));
    await waitPhoto(ann.page, tid('profile-photo'), false);
    await ann.page.click('[role=dialog][aria-label="Settings"] [aria-label="Close"]');
    await waitPhoto(ann.page, '.s-me', false);
    await waitPhoto(bob.page, '.feed .msg.first', false);
    const initials = await bob.page.locator('.feed .msg.first .uav').first().textContent();
    if (initials !== 'AA') throw new Error(`Bob sees "${initials}"`);
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
