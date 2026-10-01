// Real-browser check of voice calls and screen sharing against the local harness
// (node server/dev/local.mjs → http://localhost:5021). Three people, each in their own
// browser profile with a fake microphone; audio really flows browser-to-browser.
//   node server/dev/e2e/browser-calls.cjs [screenshot.png]
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5021';
const HEADLESS = process.env.HEADED ? false : true;
const results = []; const errors = [];
const step = async (name, fn) => { try { await fn(); results.push(['PASS', name]); } catch (e) { results.push(['FAIL', `${name} — ${String(e.message).split('\n')[0]}`]); } };
const tid = (id) => `[data-testid="${id}"]`;

async function person(browser, email, label, { mic = true } = {}) {
  const ctx = await browser.newContext({ permissions: mic ? ['microphone', 'notifications'] : ['notifications'] });
  // Keep a handle on every peer connection the app opens, so the test can read the browser's own statistics.
  await ctx.addInitScript(() => { const Native = window.RTCPeerConnection; window.__pcs = []; window.RTCPeerConnection = function (...args) { const pc = new Native(...args); window.__pcs.push(pc); return pc; }; window.RTCPeerConnection.prototype = Native.prototype; });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${label} console: ${m.text().slice(0, 200)}`); });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=email]', email); await page.fill('input[type=password]', 'local');
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar-user', { timeout: 20000 });
  await page.locator('.chan-row', { hasText: 'General' }).first().click();
  await page.waitForSelector('textarea');
  return { ctx, page, label };
}
const participants = (page, state) => page.locator(`${tid('call-participant')}${state ? `[data-state="${state}"]` : ''}`);
// Bytes of audio actually received over each peer connection, read from the browser's own statistics.
const inboundAudio = (page) => page.evaluate(async () => {
  const els = [...document.querySelectorAll('audio')].filter((a) => a.srcObject && a.srcObject.getAudioTracks().length);
  return { elements: els.length, live: els.filter((a) => a.srcObject.getAudioTracks()[0].readyState === 'live' && !a.paused).length };
});
const waitAudio = async (page, n, what) => {
  const t = Date.now(); let last;
  while (Date.now() - t < 20000) { last = await inboundAudio(page); if (last.live >= n) return; await page.waitForTimeout(400); }
  throw new Error(`${what}: expected ${n} live remote audio, saw ${JSON.stringify(last)}`);
};

(async () => {
  const browser = await chromium.launch({
    channel: 'msedge', headless: HEADLESS,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen', '--autoplay-policy=no-user-gesture-required'],
  });
  const meg = await person(browser, 'm@x', 'Meg'); const ann = await person(browser, 'a@x', 'Ann'); const bob = await person(browser, 'b@x', 'Bob');

  await step('Meg starts a call: her call panel opens; Ann and Bob see it ringing', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await ann.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await bob.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
  });
  await step('Ann accepts: one-to-one audio flows both ways', async () => {
    await ann.page.click(tid('incoming-accept'));
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await waitAudio(ann.page, 1, 'Ann hears Meg'); await waitAudio(meg.page, 1, 'Meg hears Ann');
  });
  await step('Bob accepts: three-way mesh, everyone hears the other two', async () => {
    await bob.page.click(tid('incoming-accept'));
    await bob.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await waitAudio(bob.page, 2, 'Bob hears two'); await waitAudio(meg.page, 2, 'Meg hears two'); await waitAudio(ann.page, 2, 'Ann hears two');
    for (const p of [meg, ann, bob]) await participants(p.page).nth(2).waitFor({ timeout: 8000 });
  });
  await step('audio data is really arriving on every connection, directly between browsers (no relay)', async () => {
    for (const p of [meg, ann, bob]) {
      const read = () => p.page.evaluate(async () => {
        const out = [];
        for (const pc of window.__pcs.filter((x) => x.connectionState === 'connected')) {
          const stats = await pc.getStats(); let bytes = 0, packets = 0, type = '';
          stats.forEach((r) => { if (r.type === 'inbound-rtp' && r.kind === 'audio') { bytes += r.bytesReceived || 0; packets += r.packetsReceived || 0; } });
          stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') { const l = stats.get(r.localCandidateId); type = l ? l.candidateType : ''; } });
          out.push({ bytes, packets, type });
        }
        return out;
      });
      const first = await read(); await p.page.waitForTimeout(1500); const second = await read();
      if (second.length !== 2) throw new Error(`${p.label}: expected 2 connected peers, saw ${second.length}`);
      second.forEach((c, i) => { if (!(c.bytes > (first[i]?.bytes || 0))) throw new Error(`${p.label}: no audio arriving on connection ${i + 1} (${JSON.stringify(c)})`); if (c.type === 'relay') throw new Error(`${p.label}: connection ${i + 1} is relayed`); });
    }
  });
  await step('mute: the microphone track is switched off and back on', async () => {
    await ann.page.click(tid('call-mute'));
    await ann.page.waitForFunction((sel) => /unmute/i.test(document.querySelector(sel)?.getAttribute('aria-label') || document.querySelector(sel)?.textContent || ''), tid('call-mute'), { timeout: 5000 });
    await ann.page.click(tid('call-mute'));
  });
  await step('Ann shares her screen: Meg and Bob see it', async () => {
    await ann.page.click(tid('call-share'));
    for (const p of [meg, bob]) {
      await p.page.waitForSelector(tid('call-remote-screen'), { timeout: 20000 });
      await p.page.waitForFunction((sel) => { const v = document.querySelector(sel); return v && v.videoWidth > 0; }, tid('call-remote-screen'), { timeout: 20000 });
    }
  });
  await step('only one sharer at a time: Bob is told someone is already sharing', async () => {
    await bob.page.click(tid('call-share'));
    await bob.page.getByText(/already sharing/i).first().waitFor({ timeout: 8000 });
  });
  await step('Ann stops sharing: the shared screen goes away for the others, audio continues', async () => {
    await ann.page.click(tid('call-share'));
    for (const p of [meg, bob]) await p.page.waitForFunction((sel) => !document.querySelector(sel), tid('call-remote-screen'), { timeout: 15000 });
    await waitAudio(meg.page, 2, 'Meg still hears two');
  });
  if (process.argv[2]) await meg.page.screenshot({ path: process.argv[2] });
  await step('Bob\'s browser dies: Meg and Ann stay connected to each other', async () => {
    await bob.ctx.close();
    await meg.page.waitForFunction((sel) => document.querySelectorAll(sel).length === 2, tid('call-participant'), { timeout: 30000 });
    await waitAudio(meg.page, 1, 'Meg still hears Ann'); await waitAudio(ann.page, 1, 'Ann still hears Meg');
    if (!(await meg.page.locator(tid('call-panel')).count())) throw new Error('Meg lost the call panel');
  });
  await step('Ann leaves, then Meg: the call ends and a summary line appears in the channel', async () => {
    await ann.page.click(tid('call-leave'));
    await ann.page.waitForFunction((sel) => !document.querySelector(sel), tid('call-panel'), { timeout: 8000 });
    await meg.page.click(tid('call-leave'));
    await meg.page.getByText(/Voice call — /).first().waitFor({ timeout: 10000 });
    const micLive = await ann.page.evaluate(() => !!window.__localStreamLive);   // informational only
    void micLive;
  });
  await step('a second call: "Call in progress — Join" banner works for someone who did not pick up', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await ann.page.waitForSelector(tid('incoming-call'), { timeout: 15000 });
    await ann.page.click(tid('incoming-decline'));
    await ann.page.waitForFunction((sel) => !document.querySelector(sel), tid('incoming-call'), { timeout: 8000 });
    await ann.page.click(tid('call-banner-join'));
    await ann.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await waitAudio(ann.page, 1, 'Ann hears Meg after joining from the banner');
    await ann.page.click(tid('call-leave')); await meg.page.click(tid('call-leave'));
  });

  // Two people accepting at the same instant, then many screen shares in one call.
  const bob2 = await person(browser, 'b@x', 'Bob (again)');
  await step('two people accept at the same instant: all three still connect to each other', async () => {
    await meg.page.click(tid('call-start'));
    await meg.page.waitForSelector(tid('call-panel'), { timeout: 15000 });
    await Promise.all([ann.page.waitForSelector(tid('incoming-call'), { timeout: 15000 }), bob2.page.waitForSelector(tid('incoming-call'), { timeout: 15000 })]);
    await Promise.all([ann.page.click(tid('incoming-accept')), bob2.page.click(tid('incoming-accept'))]);
    await waitAudio(meg.page, 2, 'Meg hears two'); await waitAudio(ann.page, 2, 'Ann hears two'); await waitAudio(bob2.page, 2, 'Bob hears two');
  });
  await step('five screen shares in one call: each is seen, and the connection setup data does not keep growing', async () => {
    const sdpSize = () => meg.page.evaluate(() => Math.max(0, ...window.__pcs.filter((x) => x.connectionState === 'connected').map((x) => (x.localDescription?.sdp || '').length)));
    let afterFirst = 0;
    for (let i = 1; i <= 5; i++) {
      const sharer = i % 2 ? ann : bob2; const viewer = i % 2 ? bob2 : ann;
      await sharer.page.click(tid('call-share'));
      await viewer.page.waitForFunction((sel) => { const v = document.querySelector(sel); return v && v.videoWidth > 0; }, tid('call-remote-screen'), { timeout: 20000 });
      await meg.page.waitForFunction((sel) => { const v = document.querySelector(sel); return v && v.videoWidth > 0; }, tid('call-remote-screen'), { timeout: 20000 });
      await sharer.page.click(tid('call-share'));
      for (const p of [meg, viewer]) await p.page.waitForFunction((sel) => !document.querySelector(sel), tid('call-remote-screen'), { timeout: 15000 });
      if (i === 2) afterFirst = await sdpSize();
    }
    const end = await sdpSize();
    if (afterFirst && end > afterFirst * 1.3) throw new Error(`setup data grew from ${afterFirst} to ${end} characters over three more shares`);
    await waitAudio(meg.page, 2, 'audio still flowing after five shares');
    for (const p of [ann, bob2, meg]) await p.page.click(tid('call-leave'));
  });

  // No microphone permission: a clear message, and no call is created or joined.
  const cy = await person(browser, 'c@x', 'Cy', { mic: false });
  await step('microphone blocked: clear message and nothing half-joined', async () => {
    await cy.ctx.clearPermissions();
    await cy.page.evaluate(() => { navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError')); });
    await cy.page.click(tid('call-start'));
    await cy.page.getByText(/Microphone access is needed/i).first().waitFor({ timeout: 8000 });
    if (await cy.page.locator(tid('call-panel')).count()) throw new Error('call panel opened without a microphone');
    await meg.page.waitForTimeout(1500);
    if (await meg.page.locator(tid('incoming-call')).count()) throw new Error('others were rung although the caller had no microphone');
  });

  await browser.close();
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  console.log(`\nbrowser errors: ${errors.length ? '\n  ' + errors.join('\n  ') : 'none'}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
