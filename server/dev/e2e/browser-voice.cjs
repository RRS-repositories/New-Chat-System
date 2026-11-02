// Real-browser check of the composer's dictation and voice notes against the local harness
// (node server/dev/local.mjs → http://localhost:5021).
// Dictation drives the browser's speech recognition, which cannot hear a fake microphone, so a
// stand-in recognition class is put in Meg's page and fed results the way the real one fires them;
// the voice note records Edge's fake microphone for real and the file is played back by Ann.
//   node server/dev/e2e/browser-voice.cjs
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
const BOX = '.panel > .input-bar textarea';

/** A stand-in for the browser's SpeechRecognition: the page talks to it, the test fires its events. */
const FAKE_RECOGNITION = `
  class FakeRecognition {
    constructor() { this.lang = ''; this.continuous = false; this.interimResults = false; this.started = 0; this.stopped = 0;
      this.onstart = null; this.onresult = null; this.onerror = null; this.onend = null; (window.__recs ||= []).push(this); }
    start() { this.started++; this.onstart && this.onstart(); }
    stop() { this.stopped++; this.onend && this.onend(); }
    abort() { this.stop(); }
  }
  Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: FakeRecognition, configurable: true });
`;
const NO_RECOGNITION = `
  Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
  Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
`;

async function person(browser, email, label, { init = null, viewport = { width: 1280, height: 760 } } = {}) {
  const ctx = await browser.newContext({ permissions: ['microphone', 'notifications'], viewport });
  if (init) await ctx.addInitScript(init);
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
  await page.waitForSelector(BOX);
  return { ctx, page, label };
}

/** Fires a result event on the newest stand-in recognition, the way the browser does. */
const hear = (page, results, resultIndex = 0) =>
  page.evaluate(
    ({ results, resultIndex }) => {
      const rec = window.__recs.at(-1);
      const list = results.map(([transcript, isFinal]) => Object.assign([{ transcript }], { isFinal }));
      rec.onresult({ resultIndex, results: list });
    },
    { results, resultIndex },
  );
const recState = (page) =>
  page.evaluate(() => {
    const r = window.__recs.at(-1);
    return {
      n: window.__recs.length,
      lang: r.lang,
      continuous: r.continuous,
      interim: r.interimResults,
      started: r.started,
      stopped: r.stopped,
    };
  });
const boxValue = (page) => page.inputValue(BOX);
const voiceNotes = (page) => page.locator('.msg', { hasText: 'Voice note' });

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
  const meg = await person(browser, 'm@x', 'Meg', { init: FAKE_RECOGNITION });
  const ann = await person(browser, 'a@x', 'Ann', { init: NO_RECOGNITION });

  await step('the two buttons sit just left of Emoji: dictate, then voice note', async () => {
    const labels = await meg.page.$$eval('.panel > .input-bar .input-row button', (bs) =>
      bs.map((b) => b.getAttribute('aria-label')),
    );
    const want = ['Attach files', 'Dictate', 'Record a voice note', 'Emoji', 'Send'];
    if (JSON.stringify(labels) !== JSON.stringify(want)) throw new Error(`buttons: ${labels.join(', ')}`);
  });

  await step(
    'dictate: the browser’s recognition starts in British English, listening for guesses; the box says so',
    async () => {
      await meg.page.fill(BOX, 'Note:');
      await meg.page.click(tid('dictate'));
      await meg.page.waitForSelector(`${tid('dictate')}[aria-pressed="true"]`, { timeout: 5000 });
      const s = await recState(meg.page);
      if (!(s.n === 1 && s.lang === 'en-GB' && s.continuous && s.interim && s.started === 1))
        throw new Error(`recognition: ${JSON.stringify(s)}`);
      if ((await meg.page.getAttribute(BOX, 'placeholder')) !== 'Listening…') throw new Error('placeholder');
      if (!(await meg.page.locator(`${tid('dictate')}.live`).count())) throw new Error('the mic is not shown live');
    },
  );

  await step('words appear as they are guessed and settle in place; spoken marks become marks', async () => {
    await hear(meg.page, [['hello', false]]);
    if ((await boxValue(meg.page)) !== 'Note: hello') throw new Error(`after a guess: "${await boxValue(meg.page)}"`);
    await hear(meg.page, [['hello team', true]]);
    if ((await boxValue(meg.page)) !== 'Note: hello team') throw new Error(`settled: "${await boxValue(meg.page)}"`);
    await hear(
      meg.page,
      [
        ['hello team', true],
        ['comma the file is attached full stop', true],
      ],
      1,
    );
    if ((await boxValue(meg.page)) !== 'Note: hello team, the file is attached.')
      throw new Error(`marks: "${await boxValue(meg.page)}"`);
    await hear(
      meg.page,
      [
        ['hello team', true],
        ['comma the file is attached full stop', true],
        ['thanks', false],
      ],
      2,
    );
    if ((await boxValue(meg.page)) !== 'Note: hello team, the file is attached. Thanks')
      throw new Error(`capital after a full stop: "${await boxValue(meg.page)}"`);
  });

  await step(
    'when the browser stops by itself, listening quietly starts again and the guess in progress goes',
    async () => {
      await meg.page.evaluate(() => window.__recs.at(-1).onend());
      await meg.page.waitForFunction(() => window.__recs.length === 2, null, { timeout: 5000 });
      if ((await meg.page.getAttribute(tid('dictate'), 'aria-pressed')) !== 'true')
        throw new Error('not pressed any more');
      if ((await boxValue(meg.page)) !== 'Note: hello team, the file is attached.')
        throw new Error(`"${await boxValue(meg.page)}"`);
      await hear(meg.page, [['thanks', true]]);
      if ((await boxValue(meg.page)) !== 'Note: hello team, the file is attached. Thanks')
        throw new Error(`"${await boxValue(meg.page)}"`);
    },
  );

  await step('pressing the mic again stops it; Enter sends the dictated words and Ann reads them', async () => {
    await meg.page.click(tid('dictate'));
    await meg.page.waitForSelector(`${tid('dictate')}[aria-pressed="false"]`, { timeout: 5000 });
    const s = await recState(meg.page);
    if (!(s.n === 2 && s.stopped === 1)) throw new Error(`recognition: ${JSON.stringify(s)}`);
    await meg.page.focus(BOX);
    await meg.page.keyboard.press('Enter');
    await ann.page
      .locator('.msg', { hasText: 'Note: hello team, the file is attached. Thanks' })
      .waitFor({ timeout: 10000 });
    if ((await boxValue(meg.page)) !== '') throw new Error('the box did not clear');
  });

  await step('a browser without speech recognition: the button is there but off, and says why', async () => {
    const b = ann.page.locator(tid('dictate'));
    if (!(await b.isDisabled())) throw new Error('enabled');
    if (!/not available/.test(await b.getAttribute('title')))
      throw new Error(`title: ${await b.getAttribute('title')}`);
    if (await ann.page.locator(tid('voice-start')).isDisabled()) throw new Error('the voice note is off too');
  });

  await step('voice note: the bar takes the box’s place, the clock runs and the bars move to the sound', async () => {
    await meg.page.click(tid('voice-start'));
    await meg.page.waitForSelector(`${tid('voice-bar')}.recording`, { timeout: 8000 });
    if (await meg.page.locator(BOX).count()) throw new Error('the text box is still there');
    await meg.page.waitForFunction(
      (sel) => /^0:0[2-9]$/.test(document.querySelector(sel).textContent),
      tid('voice-time'),
      { timeout: 6000 },
    );
    // Edge's fake microphone beeps on and off, so the bars are watched for a moment rather than read once.
    await meg.page
      .waitForFunction(
        () =>
          [...document.querySelectorAll('.voice-bars i')].some(
            (b) => parseFloat((b.style.transform.match(/scaleY\(([\d.]+)\)/) || [])[1] || '0') > 0.14,
          ),
        null,
        { timeout: 6000, polling: 100 },
      )
      .catch(() => {
        throw new Error('the bars do not move to the sound');
      });
  });

  await step('Discard throws it away: the box is back and nothing was sent', async () => {
    const before = await voiceNotes(ann.page).count();
    await meg.page.click(tid('voice-discard'));
    await gone(meg.page, tid('voice-bar'));
    await meg.page.waitForSelector(BOX);
    await meg.page.waitForTimeout(800);
    if ((await voiceNotes(ann.page).count()) !== before) throw new Error('something was sent');
  });

  await step('Escape discards too', async () => {
    await meg.page.click(tid('voice-start'));
    await meg.page.waitForSelector(`${tid('voice-bar')}.recording`, { timeout: 8000 });
    await meg.page.keyboard.press('Escape');
    await gone(meg.page, tid('voice-bar'));
  });

  await step('Stop lets you listen back; Send puts a voice note into the conversation that plays for Ann', async () => {
    await meg.page.click(tid('voice-start'));
    await meg.page.waitForSelector(`${tid('voice-bar')}.recording`, { timeout: 8000 });
    await meg.page.waitForTimeout(2600);
    await meg.page.click(tid('voice-stop'));
    await meg.page.waitForSelector(`${tid('voice-bar')}.preview`, { timeout: 8000 });
    const src = await meg.page.getAttribute(tid('voice-preview'), 'src');
    if (!/^blob:/.test(src || '')) throw new Error(`preview src: ${src}`);
    const clock = await meg.page.textContent(tid('voice-time'));
    if (!/^0:0[2-4]$/.test(clock)) throw new Error(`clock after stop: ${clock}`);
    await meg.page.waitForFunction(
      (sel) => {
        const a = document.querySelector(sel);
        return a && a.readyState >= 1 && !a.error;
      },
      tid('voice-preview'),
      { timeout: 8000 },
    );
    await meg.page.click(tid('voice-send'));
    await gone(meg.page, tid('voice-bar'));
    const message = voiceNotes(ann.page).last();
    await message.waitFor({ timeout: 10000 });
    const card = message.locator('.file-card');
    const text = await card.innerText();
    if (!/Voice note \d{4}-\d{2}-\d{2} \d{2}\.\d{2}\.webm/.test(text) || !/· Voice note ·/.test(text))
      throw new Error(`file card: ${text.replace(/\n/g, ' ')}`);
    await card.click();
    const audio = message.locator('audio.file-audio');
    await audio.waitFor({ timeout: 10000 });
    await ann.page.waitForFunction(
      (el) => el.readyState >= 2 && !el.error && el.currentTime > 0,
      await audio.elementHandle(),
      { timeout: 10000 },
    );
  });

  await step('Send straight from recording, with the typed words as the caption; the box clears', async () => {
    const before = await voiceNotes(ann.page).count();
    await meg.page.fill(BOX, 'Caption here');
    await meg.page.click(tid('voice-start'));
    await meg.page.waitForSelector(`${tid('voice-bar')}.recording`, { timeout: 8000 });
    await meg.page.waitForTimeout(1600);
    await meg.page.click(tid('voice-send'));
    await gone(meg.page, tid('voice-bar'));
    await ann.page.waitForFunction(
      (n) => [...document.querySelectorAll('.msg')].filter((m) => /Voice note/.test(m.textContent)).length > n,
      before,
      { timeout: 10000 },
    );
    const message = voiceNotes(ann.page).last();
    if (!/Caption here/.test(await message.innerText())) throw new Error('the caption is not with the note');
    if ((await boxValue(meg.page)) !== '') throw new Error('the box did not clear');
  });

  await step('on a phone-width screen the dictate button is hidden, the voice note stays', async () => {
    const bob = await person(browser, 'b@x', 'Bob');
    await bob.page.setViewportSize({ width: 390, height: 800 });
    await bob.page.waitForSelector(BOX);
    if (await bob.page.locator(tid('dictate')).isVisible()) throw new Error('dictate shows on a phone');
    if (!(await bob.page.locator(tid('voice-start')).isVisible())) throw new Error('no voice note on a phone');
    await bob.ctx.close();
  });

  await browser.close();
  for (const [s, n] of results) console.log(`${s}  ${n}`);
  if (errors.length) console.log(`\nBrowser errors:\n${[...new Set(errors)].join('\n')}`);
  const failed = results.filter(([s]) => s === 'FAIL').length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exit(failed || errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
