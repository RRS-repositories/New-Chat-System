// Real-browser check of breakout groups against the local harness
// (node server/dev/local.mjs → http://localhost:5021), four people in a real call:
// the host makes a group and opens it, people then send their voice only to their own room
// (checked on the real connections), a live move changes rooms at once, sharing and the
// whiteboard wait, others see the arrangement but cannot change it, and everyone comes back.
//   node server/dev/e2e/browser-breakout.cjs
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
  // Every connection the page makes is kept, so the check can look at what is really being sent on it.
  await ctx.addInitScript(() => {
    const Real = window.RTCPeerConnection;
    window.__pcs = [];
    window.RTCPeerConnection = function (...args) {
      const pc = new Real(...args);
      window.__pcs.push(pc);
      return pc;
    };
    window.RTCPeerConnection.prototype = Real.prototype;
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
/** On how many of this person's live connections their microphone is really being sent. */
const sendingTo = (page) =>
  page.evaluate(
    () =>
      window.__pcs.filter(
        (pc) =>
          pc.connectionState === 'connected' &&
          pc.getSenders().some((s) => s.track && s.track.kind === 'audio' && s.track.readyState === 'live'),
      ).length,
  );
const waitSending = async (p, n) => {
  const started = Date.now();
  let last = -1;
  while (Date.now() - started < 10000) {
    last = await sendingTo(p.page);
    if (last === n) return;
    await p.page.waitForTimeout(250);
  }
  throw new Error(`${p.label} sends their voice to ${last} people, expected ${n}`);
};
const tiles = (page) => page.locator(tid('call-participant')).count();
const waitTiles = async (p, n) => {
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if ((await tiles(p.page)) === n) return;
    await p.page.waitForTimeout(200);
  }
  throw new Error(`${p.label} sees ${await tiles(p.page)} tiles, expected ${n}`);
};
const playing = (page) => page.locator('audio').count();

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
  const all = [meg, ann, bob, cy];

  await step('four people in a call: everyone sends their voice to the three others', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'));
    for (const p of [ann, bob, cy]) {
      await p.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
      await p.page.click(tid('incoming-accept'));
      await p.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    }
    for (const p of all) await waitSending(p, 3);
  });

  await step('the host makes a group and puts two people in it; the others see it but cannot change it', async () => {
    await meg.page.click(tid('call-rooms'));
    await meg.page.waitForSelector(tid('bo-panel'));
    await meg.page.click(tid('bo-add-group'));
    await meg.page.locator(tid('bo-group')).first().waitFor();
    if (!(await meg.page.locator(tid('bo-start')).isDisabled()))
      throw new Error('the groups can be opened with nobody in them');
    for (const name of ['Ann Agent', 'Bob Sales']) {
      await meg.page.locator(tid('bo-add-people')).first().click();
      await meg.page.locator(tid('bo-add-person'), { hasText: name }).click();
      await meg.page.locator(`${tid('bo-group')} ${tid('bo-person')}`, { hasText: name.split(' ')[0] }).waitFor();
    }
    await ann.page.click(tid('call-rooms'));
    const seen = ann.page.locator(tid('bo-panel'));
    await seen.locator(tid('bo-group'), { hasText: 'Group 1' }).waitFor({ timeout: 8000 });
    if ((await seen.locator(`${tid('bo-group')} ${tid('bo-person')}`).count()) !== 2)
      throw new Error('Ann does not see the two people');
    for (const id of ['bo-add-group', 'bo-start', 'bo-remove-group', 'bo-add-people'])
      if (await seen.locator(tid(id)).count()) throw new Error(`someone who is not the host has ${id}`);
    if (!(await seen.locator(tid('bo-person')).first().isDisabled())) throw new Error('Ann can move people');
    await ann.page.click(tid('bo-close'));
    for (const p of all) await waitSending(p, 3); // planning changes nothing yet
  });

  await step(
    'opening the groups: each person’s voice goes only to their own room, and they see only that room',
    async () => {
      await meg.page.click(tid('bo-start'));
      for (const p of all)
        await p.page.locator(tid('bo-banner'), { hasText: 'Breakouts live' }).waitFor({ timeout: 8000 });
      // Ann and Bob hear each other; Meg (host) and Cy are together in the main room.
      for (const p of all) await waitSending(p, 1);
      for (const p of all) await waitTiles(p, 2);
      for (const p of all)
        if ((await playing(p.page)) !== 1) throw new Error(`${p.label} plays ${await playing(p.page)} voices`);
      await ann.page.locator(tid('bo-banner'), { hasText: 'You are in Group 1' }).waitFor();
      await ann.page.locator(tid('call-bo-pill'), { hasText: 'Group 1' }).waitFor();
      if (await ann.page.locator(tid('bo-banner-end')).count())
        throw new Error('someone who is not the host can end the groups');
    },
  );

  await step('while the groups are open, sharing and the whiteboard wait', async () => {
    if (await ann.page.locator(tid('call-share')).count()) throw new Error('screen sharing is offered');
    await ann.page.click(tid('call-board'));
    await ann.page.locator('.c-note', { hasText: 'paused while breakout groups are open' }).waitFor({ timeout: 5000 });
    if (await ann.page.locator(tid('call-whiteboard')).count()) throw new Error('the whiteboard opened');
  });

  await step('the host moves someone while the groups are open: their room changes at once', async () => {
    await meg.page.locator(`${tid('bo-group')} ${tid('bo-person')}`, { hasText: 'Bob' }).click();
    await meg.page.click(tid('bo-move-main'));
    await waitSending(bob, 2); // Bob is now with Meg and Cy
    await waitSending(meg, 2);
    await waitSending(cy, 2);
    await waitSending(ann, 0); // Ann is alone in her group
    await waitTiles(ann, 1);
    await waitTiles(bob, 3);
    if (await bob.page.locator(tid('call-bo-pill'), { hasText: 'Group 1' }).count())
      throw new Error('Bob is still shown in Group 1');
  });

  await step('someone whose connection drops for a moment comes back into the same room', async () => {
    await ann.ctx.setOffline(true);
    await ann.page.waitForTimeout(2500);
    await ann.ctx.setOffline(false);
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await ann.page.locator(tid('bo-banner'), { hasText: 'You are in Group 1' }).waitFor({ timeout: 20000 });
    await ann.page.waitForTimeout(4000);
    await waitSending(ann, 0);
    await waitSending(bob, 2);
    if (!(await ann.page.locator(tid('call-panel')).isVisible())) throw new Error('Ann fell out of the call');
  });

  await step('the host brings everyone back: one room again, everyone hears everyone', async () => {
    // The open panel sits over the right end of the banner, so the host uses the panel's own button.
    if (!(await meg.page.locator(tid('bo-banner-end')).count()))
      throw new Error('the banner has no button for the host');
    await meg.page.click(tid('bo-end'));
    for (const p of all) await gone(p.page, tid('bo-banner'));
    for (const p of all) await waitSending(p, 3);
    for (const p of all) await waitTiles(p, 4);
    for (const p of all)
      if ((await playing(p.page)) !== 3) throw new Error(`${p.label} plays ${await playing(p.page)} voices`);
    await ann.page.waitForSelector(tid('call-share'));
    for (const p of all) await p.page.click(tid('call-leave'));
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
