// Real-browser check of the three Phase 5 items against the local harness
// (node server/dev/local.mjs → http://localhost:5021):
//   1. search finds messages by part of a word, and people and channels by name
//   2. the person sharing sees their own screen
//   3. the call host can mute and remove others; a removed person asks to come back
//   node server/dev/e2e/browser-host.cjs [screenshot.png]
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5021';
const HEADLESS = process.env.HEADED ? false : true;
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
const gone = (page, selector, timeout = 10000) =>
  page.waitForFunction((sel) => !document.querySelector(sel), selector, { timeout });

async function person(browser, email, label) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'notifications'] });
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
  await page.waitForSelector('textarea');
  return { ctx, page, label };
}
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
const row = (page, name) => page.locator(tid('call-participant'), { hasText: name });
const inCallCount = (page, n) =>
  page.waitForFunction(
    ([sel, count]) => document.querySelectorAll(sel).length === count,
    [tid('call-participant'), n],
    {
      timeout: 15000,
    },
  );
const micLabel = (page) => page.locator(tid('call-mute')).getAttribute('aria-label');

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: HEADLESS,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--auto-select-desktop-capture-source=Entire screen',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const meg = await person(browser, 'm@x', 'Meg');
  const ann = await person(browser, 'a@x', 'Ann');
  const bob = await person(browser, 'b@x', 'Bob');

  // ---- 1. search -----------------------------------------------------------
  const openSearch = async (page) => {
    await page.click('button[aria-label="Search messages"]');
    await page.waitForSelector(tid('search-input'));
  };
  await step('search: part of a word finds the message, with the typed part marked', async () => {
    await meg.page.fill('textarea', 'The Vanquis invoice is overdue');
    await meg.page.keyboard.press('Enter');
    await ann.page.getByText('The Vanquis invoice is overdue').first().waitFor({ timeout: 10000 });
    await openSearch(ann.page);
    await ann.page.fill(tid('search-input'), 'invo');
    const hit = ann.page.locator(tid('search-hit')).first();
    await hit.waitFor({ timeout: 10000 });
    const marked = await hit.locator('mark').first().textContent();
    if (marked.toLowerCase() !== 'invo') throw new Error(`marked "${marked}"`);
  });
  await step('search: a person’s name finds the person and what they wrote', async () => {
    await ann.page.fill(tid('search-input'), 'meg');
    await ann.page.locator(tid('search-person'), { hasText: 'Meg Manager' }).waitFor({ timeout: 10000 });
    await ann.page.locator(tid('search-hit'), { hasText: 'Vanquis' }).first().waitFor({ timeout: 10000 });
  });
  await step('search: a channel name finds the channel', async () => {
    await ann.page.fill(tid('search-input'), 'gen');
    await ann.page.locator(tid('search-channel'), { hasText: 'General' }).waitFor({ timeout: 10000 });
  });
  await step('search: choosing a person opens the conversation with them', async () => {
    await ann.page.fill(tid('search-input'), 'bob sal');
    await ann.page.locator(tid('search-person'), { hasText: 'Bob Sales' }).click();
    await gone(ann.page, tid('search-input'));
    await ann.page.locator('.chan-row', { hasText: 'Bob Sales' }).first().waitFor({ timeout: 10000 });
    await ann.page.waitForFunction(() => /\/channels\//.test(location.pathname), null, { timeout: 10000 });
    await ann.page.locator('.chan-row', { hasText: 'General' }).first().click();
    await ann.page.waitForSelector('textarea');
  });

  // ---- 2. own screen --------------------------------------------------------
  await step('a three-person call is up (Meg started it, so Meg is the host)', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    for (const p of [ann, bob]) {
      await p.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
      await p.page.click(tid('incoming-accept'));
      await p.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    }
    for (const p of [meg, ann, bob]) await waitAudio(p.page, 2, `${p.label} hears two`);
  });
  await step('the sharer sees their own shared screen; it goes when the share stops', async () => {
    await ann.page.click(tid('call-share'));
    await ann.page.waitForFunction(
      (sel) => {
        const video = document.querySelector(sel);
        return video && video.videoWidth > 0;
      },
      tid('call-own-screen'),
      { timeout: 20000 },
    );
    await meg.page.waitForSelector(tid('call-remote-screen'), { timeout: 20000 });
    if (await meg.page.locator(tid('call-own-screen')).count()) throw new Error('a viewer got an own-screen preview');
    if (process.argv[2]) await ann.page.screenshot({ path: process.argv[2] });
    await ann.page.click(tid('call-share'));
    await gone(ann.page, tid('call-own-screen'));
    await gone(meg.page, tid('call-remote-screen'), 15000);
  });

  // ---- 3. host controls -----------------------------------------------------
  await step('everyone sees who the host is; only the host has the mute and remove buttons', async () => {
    for (const p of [meg, ann, bob]) {
      await row(p.page, 'Meg Manager').locator('.call-host-tag').waitFor({ timeout: 8000 });
      const tags = await p.page.locator('.call-host-tag').count();
      if (tags !== 1) throw new Error(`${p.label} sees ${tags} host tags`);
    }
    if ((await meg.page.locator(tid('call-host-mute')).count()) !== 2) throw new Error('host lacks mute buttons');
    if ((await meg.page.locator(tid('call-host-remove')).count()) !== 2) throw new Error('host lacks remove buttons');
    for (const p of [ann, bob])
      if (await p.page.locator(`${tid('call-host-mute')}, ${tid('call-host-remove')}`).count())
        throw new Error(`${p.label} has host buttons`);
  });
  await step('the host mutes Ann: Ann is muted and told so; the host has no way to unmute her', async () => {
    await row(meg.page, 'Ann Agent').locator(tid('call-host-mute')).click();
    await ann.page.waitForFunction(
      (sel) => document.querySelector(sel)?.getAttribute('aria-label') === 'Unmute',
      tid('call-mute'),
      { timeout: 8000 },
    );
    await ann.page.locator(tid('call-panel-note'), { hasText: 'muted you' }).waitFor({ timeout: 8000 });
    await row(meg.page, 'Ann Agent').locator('[aria-label="muted"]').waitFor({ timeout: 8000 });
    await row(bob.page, 'Ann Agent').locator('[aria-label="muted"]').waitFor({ timeout: 8000 });
    if (!(await row(meg.page, 'Ann Agent').locator(tid('call-host-mute')).isDisabled()))
      throw new Error('the host can still press mute on a muted person');
  });
  await step('Ann unmutes herself', async () => {
    await ann.page.click(tid('call-mute'));
    if ((await micLabel(ann.page)) !== 'Mute') throw new Error('Ann could not unmute');
    await meg.page.waitForFunction(
      ([sel, name]) => {
        const li = [...document.querySelectorAll(sel)].find((el) => el.textContent.includes(name));
        return li && !li.querySelector('[aria-label="muted"]');
      },
      [tid('call-participant'), 'Ann Agent'],
      { timeout: 8000 },
    );
  });
  await step('removing asks first: "No" keeps the person in the call', async () => {
    await row(meg.page, 'Bob Sales').locator(tid('call-host-remove')).click();
    await meg.page.getByRole('button', { name: 'No, keep them in the call' }).click();
    await meg.page.waitForTimeout(500);
    await inCallCount(meg.page, 3);
    if (!(await bob.page.locator(tid('call-panel')).count())) throw new Error('Bob was removed on "No"');
  });
  await step('the host removes Bob: Bob is out and told why; the call goes on for the others', async () => {
    await row(meg.page, 'Bob Sales').locator(tid('call-host-remove')).click();
    await meg.page.click(tid('call-host-remove-yes'));
    await gone(bob.page, tid('call-panel'));
    await bob.page.getByText('The host removed you from the call').first().waitFor({ timeout: 8000 });
    await inCallCount(meg.page, 2);
    await inCallCount(ann.page, 2);
    await waitAudio(meg.page, 1, 'Meg still hears Ann');
    await waitAudio(ann.page, 1, 'Ann still hears Meg');
  });
  await step('Bob cannot simply join back: his button says "Ask to join", and asking makes him wait', async () => {
    const join = bob.page.locator(tid('call-banner-join'));
    await join.waitFor({ timeout: 8000 });
    if ((await join.textContent()).trim() !== 'Ask to join')
      throw new Error(`button says "${await join.textContent()}"`);
    await join.click();
    await bob.page.waitForSelector(tid('call-banner-waiting'), { timeout: 8000 });
    if (await bob.page.locator(tid('call-panel')).count()) throw new Error('Bob got into the call without the host');
    await meg.page.locator(tid('call-request'), { hasText: 'Bob Sales asks to rejoin' }).waitFor({ timeout: 8000 });
    if (await ann.page.locator(tid('call-request')).count()) throw new Error('a non-host sees the request');
  });
  await step('the host lets Bob in: he is back in the call with audio', async () => {
    await meg.page.click(tid('call-request-accept'));
    await bob.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await gone(meg.page, tid('call-request'));
    for (const p of [meg, ann, bob]) await waitAudio(p.page, 2, `${p.label} hears two again`);
  });
  await step(
    'removed again (and Bob reloads his page): still has to ask; the host refuses; Bob stays out and is told',
    async () => {
      await row(meg.page, 'Bob Sales').locator(tid('call-host-remove')).click();
      await meg.page.click(tid('call-host-remove-yes'));
      await gone(bob.page, tid('call-panel'));
      // Bob reloads the page, so his browser no longer knows he was removed: the server still does.
      await bob.page.reload({ waitUntil: 'domcontentloaded' });
      await bob.page.waitForSelector('.sidebar-user', { timeout: 20000 });
      await bob.page.locator('.chan-row', { hasText: 'General' }).first().click();
      await bob.page.click(tid('call-banner-join'));
      await bob.page.waitForSelector(tid('call-banner-waiting'), { timeout: 15000 });
      if (await bob.page.locator(tid('call-panel')).count()) throw new Error('Bob got in after reloading the page');
      await meg.page.locator(tid('call-request')).waitFor({ timeout: 8000 });
      await meg.page.click(tid('call-request-refuse'));
      await bob.page.getByText('The host did not let you back in').first().waitFor({ timeout: 8000 });
      await gone(bob.page, tid('call-banner-waiting'));
      await bob.page.click(tid('call-banner-join'));
      await bob.page.getByText('You can ask again in a minute').first().waitFor({ timeout: 8000 });
      if (await bob.page.locator(tid('call-panel')).count()) throw new Error('Bob got in after a refusal');
    },
  );
  await step('a person who simply left joins back freely, with no request', async () => {
    await ann.page.click(tid('call-leave'));
    await gone(ann.page, tid('call-panel'));
    const join = ann.page.locator(tid('call-banner-join'));
    await join.waitFor({ timeout: 8000 });
    if ((await join.textContent()).trim() !== 'Join') throw new Error(`button says "${await join.textContent()}"`);
    await join.click();
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await waitAudio(ann.page, 1, 'Ann hears Meg again');
    if (await meg.page.locator(tid('call-request')).count()) throw new Error('the host was asked about a free rejoin');
  });
  await step('the call ends: Bob’s "Ask to join" goes away with it', async () => {
    await ann.page.click(tid('call-leave'));
    await meg.page.click(tid('call-leave'));
    await gone(bob.page, tid('call-banner-join'));
  });

  await browser.close();
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  console.log(`\nbrowser errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 'none'}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
