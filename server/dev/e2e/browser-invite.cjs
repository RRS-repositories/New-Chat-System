// Real-browser check of the incoming-call card, add-to-call and merge against the local harness
// (node server/dev/local.mjs → http://localhost:5021), five people:
// the card with Accept / Decline / Message, ringing a person from outside the conversation into a
// call, taking the ring back, declining with a message, joining later from the "Join my call" card,
// bringing a one-to-one caller into the call you are in, and the 30-second ring running out.
//   node server/dev/e2e/browser-invite.cjs
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
const tile = (page, name) => page.locator(tid('call-participant'), { hasText: name });
const ringingTile = (page, name) => page.locator(`${tid('call-participant')}[data-state="ringing"]`, { hasText: name });
const tiles = (page) => page.locator(tid('call-participant')).count();
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
const openDm = async (page, name) => {
  await page.click('button[aria-label="New message"]');
  await page.locator('.pick-row', { hasText: name }).click();
  await page.locator('.m-title', { hasText: name }).waitFor();
};
const addToCall = async (page, name) => {
  await page.click(tid('call-add'));
  await page.locator(tid('call-add-person'), { hasText: name }).click();
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
  const bob = await person(browser, 'b@x', 'Bob');
  const cy = await person(browser, 'c@x', 'Cy');
  const dee = await person(browser, 'dee@x', 'Dee');

  await step(
    'an incoming call is a centred card: who is calling, a countdown, and Decline / Message / Accept',
    async () => {
      await openDm(meg.page, 'Ann Agent');
      await meg.page.click(tid('call-start'));
      const card = ann.page.locator(tid('incoming-call'));
      await card.waitFor({ timeout: 15000 });
      if ((await card.locator('h2').innerText()) !== 'Meg Manager') throw new Error('the caller is not named');
      if (!/Incoming voice call · \d+s/.test(await card.locator('.inc-sub').innerText()))
        throw new Error(`sub line: ${await card.locator('.inc-sub').innerText()}`);
      for (const id of ['incoming-decline', 'incoming-message', 'incoming-accept'])
        if (!(await card.locator(tid(id)).isVisible())) throw new Error(`${id} missing`);
      const box = await card.boundingBox();
      const centre = box.x + box.width / 2;
      if (Math.abs(centre - 640) > 4 || box.width > 420) throw new Error(`not a centred card: ${JSON.stringify(box)}`);
      await ann.page.click(tid('incoming-accept'));
      await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
      await waitAudio(meg.page, 1, 'Meg hears Ann');
    },
  );

  await step(
    'Add to call lists people who are not in the call; picking one rings them and shows a Ringing tile to the call',
    async () => {
      await meg.page.click(tid('call-add'));
      const menu = meg.page.locator(tid('call-add-menu'));
      await menu.waitFor();
      const names = await menu.locator(tid('call-add-person')).allInnerTexts();
      if (names.some((n) => /Ann Agent|Meg Manager/.test(n)))
        throw new Error(`people in the call are offered: ${names}`);
      if (!names.some((n) => /Bob Sales/.test(n))) throw new Error(`Bob is not offered: ${names}`);
      await menu.locator(tid('call-add-person'), { hasText: 'Bob Sales' }).click();
      for (const p of [meg, ann]) await ringingTile(p.page, 'Bob Sales').waitFor({ timeout: 8000 });
      const card = bob.page.locator(tid('incoming-call'));
      await card.waitFor({ timeout: 10000 });
      if (!/Asks you to join their call/.test(await card.locator('.inc-sub').innerText()))
        throw new Error('the card does not say it is an invitation into a call');
    },
  );

  await step('the person who rang can stop the ring from the tile’s menu', async () => {
    const t = ringingTile(meg.page, 'Bob Sales');
    await t.hover();
    await t.locator(tid('call-tile-menu')).click();
    await meg.page.click(tid('call-cancel-ring'));
    await gone(bob.page, tid('incoming-call'));
    for (const p of [meg, ann]) await ringingTile(p.page, 'Bob Sales').waitFor({ state: 'detached', timeout: 8000 });
    if ((await tiles(meg.page)) !== 2) throw new Error('the call lost or kept a tile it should not');
  });

  await step('Message: a quick reply declines the call and lands in the conversation with the caller', async () => {
    await addToCall(meg.page, 'Bob Sales');
    await bob.page.waitForSelector(tid('incoming-call'), { timeout: 10000 });
    await bob.page.click(tid('incoming-message'));
    const replies = bob.page.locator(tid('incoming-reply'));
    if ((await replies.count()) !== 3) throw new Error('three quick replies expected');
    await bob.page.waitForSelector(tid('incoming-reply-input'));
    await replies.nth(2).click();
    await gone(bob.page, tid('incoming-call'));
    await ringingTile(meg.page, 'Bob Sales').waitFor({ state: 'detached', timeout: 8000 });
    await bob.page.locator(tid('toast'), { hasText: 'Sent to Meg' }).waitFor({ timeout: 8000 });
    await bob.page.locator('.chan-row', { hasText: 'Meg Manager' }).first().click();
    await bob.page.locator('.msg-text', { hasText: 'Give me 5 minutes' }).waitFor({ timeout: 8000 });
  });

  await step('the "Join my call" card in the conversation still lets them in after the ring', async () => {
    const card = bob.page.locator(tid('call-invite-card')).last();
    await card.waitFor({ timeout: 8000 });
    if (!/Meg Manager asked you to join their call/.test(await card.innerText()))
      throw new Error(await card.innerText());
    await card.locator(tid('call-invite-join')).click();
    await bob.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    for (const p of [meg, ann, bob]) await waitAudio(p.page, 2, `${p.label} hears two`);
    if ((await tiles(bob.page)) !== 3) throw new Error(`Bob sees ${await tiles(bob.page)} tiles`);
  });

  await step('call waiting: a one-to-one caller is shown over the call, and Accept brings them into it', async () => {
    await openDm(dee.page, 'Ann Agent');
    await dee.page.click(tid('call-start'));
    await dee.page.waitForSelector(tid('call-ringing-out'), { timeout: 10000 });
    const card = ann.page.locator(tid('incoming-call'));
    await card.waitFor({ timeout: 15000 });
    if (!/Incoming while you’re on a call/.test(await card.locator('.inc-sub').innerText()))
      throw new Error('the card does not say a call is already going on');
    if (!(await ann.page.locator(tid('call-panel')).isVisible())) throw new Error('the call screen went away');
    if (!/Add to my call/.test(await card.locator('.inc-acts').innerText()))
      throw new Error('Accept is not labelled as adding');
    await ann.page.click(tid('incoming-accept'));
    await gone(ann.page, tid('incoming-call'));
    await tile(ann.page, 'Dee').waitFor({ timeout: 15000 });
    for (const p of [meg, ann, bob, dee]) await waitAudio(p.page, 3, `${p.label} hears three`);
    if ((await tiles(dee.page)) !== 4) throw new Error(`Dee sees ${await tiles(dee.page)} tiles`);
  });

  await step('a one-to-one call that grew goes on when its starter leaves', async () => {
    await meg.page.click(tid('call-leave'));
    await gone(meg.page, tid('call-panel'));
    await tile(ann.page, 'Meg Manager').waitFor({ state: 'detached', timeout: 10000 });
    await ann.page.waitForTimeout(1500);
    for (const p of [ann, bob, dee])
      if (!(await p.page.locator(tid('call-panel')).isVisible())) throw new Error(`${p.label} was dropped`);
    await waitAudio(ann.page, 2, 'Ann still hears two');
  });

  await step('nobody answers: after 30 seconds the ring ends by itself on both sides', async () => {
    await addToCall(ann.page, 'Cy Sales');
    await cy.page.waitForSelector(tid('incoming-call'), { timeout: 10000 });
    await ringingTile(bob.page, 'Cy Sales').waitFor({ timeout: 8000 });
    await gone(cy.page, tid('incoming-call'), 40000);
    for (const p of [ann, bob]) await ringingTile(p.page, 'Cy Sales').waitFor({ state: 'detached', timeout: 8000 });
  });

  await step('when the call is over, the join card says so', async () => {
    // Three are left. Two leave; the call then ends by itself for the last one.
    for (const p of [ann, bob]) await p.page.click(tid('call-leave'));
    for (const p of [ann, bob, dee]) await gone(p.page, tid('call-panel'), 15000);
    const card = bob.page.locator(tid('call-invite-card')).last();
    await card.locator(tid('call-invite-join')).click();
    await card.locator(tid('call-invite-over')).waitFor({ timeout: 8000 });
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
