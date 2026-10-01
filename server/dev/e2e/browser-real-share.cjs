// Real screen capture (not the fake device) in a two-person call against the local harness
// (node server/dev/local.mjs → http://localhost:5021), to prove the security headers do not block
// screen sharing. The microphone is a generated tone, so no audio device is needed; the SCREEN is
// the real one. Needs a desktop session: it opens a real browser window (moved off-screen).
//   node server/dev/e2e/browser-real-share.cjs [screenshot.png]
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5021';
const SOURCES = (process.env.SOURCE ? [process.env.SOURCE] : ['Entire screen', 'Screen 1']).slice();
const tid = (id) => `[data-testid="${id}"]`;
const errors = [];

async function person(browser, email, label) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'notifications'] });
  // A real audio track without a microphone: a quiet generated tone.
  await ctx.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audio = new AudioContext();
      const tone = audio.createOscillator();
      const quiet = audio.createGain();
      quiet.gain.value = 0.01;
      const out = audio.createMediaStreamDestination();
      tone.connect(quiet).connect(out);
      tone.start();
      return out.stream;
    };
  });
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
const hasPicture = (page, testId, timeout = 20000) =>
  page.waitForFunction(
    (sel) => {
      const video = document.querySelector(sel);
      return video && video.videoWidth > 0 && video.videoHeight > 0;
    },
    tid(testId),
    { timeout },
  );

async function attempt(source, screenshot) {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: false,
    args: [
      '--use-fake-ui-for-media-stream', // answers the permission prompts; does NOT replace the devices
      `--auto-select-desktop-capture-source=${source}`,
      '--autoplay-policy=no-user-gesture-required',
      '--window-position=-2400,-2400',
    ],
  });
  try {
    const meg = await person(browser, 'm@x', 'Meg');
    const ann = await person(browser, 'a@x', 'Ann');
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await ann.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await ann.page.click(tid('incoming-accept'));
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await ann.page
      .locator(`${tid('call-participant')}[data-state="connected"]`)
      .nth(1)
      .waitFor({ timeout: 20000 });
    await ann.page.click(tid('call-share'));
    await hasPicture(ann.page, 'call-own-screen');
    await hasPicture(meg.page, 'call-remote-screen');
    const size = await meg.page.evaluate((sel) => {
      const video = document.querySelector(sel);
      return `${video.videoWidth}x${video.videoHeight}`;
    }, tid('call-remote-screen'));
    const settings = await ann.page.evaluate((sel) => {
      const track = document.querySelector(sel).srcObject.getVideoTracks()[0];
      return { label: track.label, surface: track.getSettings().displaySurface || null };
    }, tid('call-own-screen'));
    if (screenshot) await meg.page.screenshot({ path: screenshot });
    await ann.page.click(tid('call-share'));
    await ann.page.click(tid('call-leave'));
    await meg.page.click(tid('call-leave'));
    return { ok: true, size, settings };
  } catch (e) {
    return { ok: false, error: String(e.message).split('\n')[0] };
  } finally {
    await browser.close();
  }
}

(async () => {
  let result = { ok: false, error: 'no capture source tried' };
  for (const source of SOURCES) {
    errors.length = 0;
    result = await attempt(source, process.argv[2]);
    console.log(`source "${source}": ${JSON.stringify(result)}`);
    if (result.ok) break;
  }
  console.log(`browser errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 'none'}`);
  const real = result.ok && result.settings.surface === 'monitor';
  console.log(
    result.ok ? (real ? 'PASS  a real screen was shared and seen' : 'PASS?  shared, but not a real monitor') : 'FAIL',
  );
  process.exit(result.ok ? 0 : 1);
})().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
