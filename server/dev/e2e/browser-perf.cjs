// Speed check with heavy data. Start the local chat loaded with far more than the office has:
//   SEED_HEAVY=1 node server/dev/local.mjs
// then:
//   node server/dev/e2e/browser-perf.cjs            (prints the numbers; fails if a limit is broken)
//   PAGES=80 node server/dev/e2e/browser-perf.cjs   (scroll further back)
// It measures the server's answers, then a real browser: opening the chat, scrolling far back in a
// 100,000-message channel, typing while a lot is loaded, and messages arriving meanwhile.
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5021';
const PAGES = Number(process.env.PAGES || 40); // how many times to scroll up for older messages
const rows = [];
/** One measured value, with the most it may be. */
const record = (what, value, unit, limit) =>
  rows.push({ what, value, unit, limit, ok: limit == null || value <= limit });
const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];

async function signIn(email) {
  const r = await fetch(`${BASE}/api/chat/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'local' }),
  });
  const body = await r.json();
  if (!body.token) throw new Error(`sign-in failed for ${email}`);
  return body.token;
}
async function timed(token, path, runs = 5) {
  const times = [];
  let last;
  for (let i = 0; i < runs; i++) {
    const t = performance.now();
    const r = await fetch(`${BASE}/api/chat${path}`, { headers: { Authorization: `Bearer ${token}` } });
    last = await r.json();
    if (!r.ok) throw new Error(`${path} → ${r.status}`);
    times.push(performance.now() - t);
  }
  return { ms: Math.round(median(times)), body: last };
}

async function serverTimes() {
  const meg = await signIn('m@x');
  const bob = await signIn('b@x');
  const list = await timed(meg, '/channels');
  record(`channel list (${list.body.channels.length} channels)`, list.ms, 'ms', 400);
  const behind = await timed(bob, '/channels');
  const general = behind.body.channels.find((c) => c.name === 'general');
  record(`channel list for someone 100,000 messages behind (badge shows ${general.unreadCount})`, behind.ms, 'ms', 400);
  const newest = await timed(meg, `/channels/${general.id}/messages`);
  record('newest page of messages', newest.ms, 'ms', 150);
  let cursor = newest.body.nextCursor;
  for (let i = 0; i < 30 && cursor; i++)
    cursor = (await timed(meg, `/channels/${general.id}/messages?before=${encodeURIComponent(cursor)}`, 1)).body
      .nextCursor;
  const deep = await timed(meg, `/channels/${general.id}/messages?before=${encodeURIComponent(cursor)}`);
  record('a page of messages 1,500 messages back', deep.ms, 'ms', 150);
  for (const [label, q] of [
    ['part of a word ("invo")', 'invo'],
    ['two words ("vanquis 512")', 'vanquis 512'],
    ['a person ("person 007")', 'person 007'],
    ['a rare word, this channel only', `Message%2099999&channelId=${general.id}`],
  ]) {
    const found = await timed(meg, `/search?q=${q.includes('%') ? q : encodeURIComponent(q)}`, 3);
    record(`search: ${label} (${found.body.hits.length} shown)`, found.ms, 'ms', 800);
  }
  return { meg, bob, generalId: general.id };
}

// Runs in the page: watches every frame, and reports the longest gap between two frames.
const frameWatch = () => {
  window.__frames = { worst: 0, slow: 0, on: true };
  let last = performance.now();
  const tick = (now) => {
    const gap = now - last;
    last = now;
    if (gap > window.__frames.worst) window.__frames.worst = gap;
    if (gap > 100) window.__frames.slow++;
    if (window.__frames.on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};
const frameResult = () => {
  window.__frames.on = false;
  return { worst: Math.round(window.__frames.worst), slow: window.__frames.slow };
};
const counts = (page) =>
  page.evaluate(() => ({
    messages: document.querySelectorAll('.feed [id^="msg-"]').length,
    nodes: document.querySelectorAll('*').length,
    heapMb: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0,
  }));

async function browserTimes({ generalId }) {
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: !process.env.HEADED,
    args: ['--enable-precise-memory-info', '--js-flags=--expose-gc'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  let t = Date.now();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('input[type=email]', 'm@x');
  await page.fill('input[type=password]', 'local');
  t = Date.now();
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar-user', { timeout: 30000 });
  record('sign-in to the channel list on screen', Date.now() - t, 'ms', 2500);

  t = Date.now();
  await page.goto(`${BASE}/channels/${generalId}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.feed [id^="msg-"]', { timeout: 30000 });
  record('reload straight into the 100,000-message channel', Date.now() - t, 'ms', 2500);
  const start = await counts(page);
  record('messages on the page after opening', start.messages, '', 60);
  record('page elements after opening', start.nodes, '', 6000);

  // Typing with only the newest page loaded: the yardstick for typing later with a lot loaded.
  const SENTENCE = 'Typing a normal sentence while a great deal of the channel is loaded on the page.';
  const typeIt = async () => {
    await page.click('textarea');
    await page.evaluate(frameWatch);
    const t0 = Date.now();
    await page.keyboard.type(SENTENCE, { delay: 15 });
    const took = Date.now() - t0;
    const frames = await page.evaluate(frameResult);
    await page.fill('textarea', '');
    return { took, worst: frames.worst };
  };
  const light = await typeIt();
  record(`typing ${SENTENCE.length} characters with one page loaded (the yardstick)`, light.took, 'ms');

  // Scroll far back.
  const pageTimes = [];
  let moved = 0; // how far the message being read shifted on screen when older ones loaded above it
  const topOf = (id) =>
    page.evaluate((el) => Math.round(document.getElementById(el)?.getBoundingClientRect().top ?? -1), id);
  await page.evaluate(frameWatch);
  for (let i = 0; i < PAGES; i++) {
    const before = await page.evaluate(() => document.querySelector('.feed [id^="msg-"]')?.id);
    const t0 = Date.now();
    await page.evaluate(() => {
      const feed = document.querySelector('.feed');
      feed.scrollTop = 0;
      feed.dispatchEvent(new Event('scroll'));
    });
    const topBefore = await topOf(before);
    try {
      await page.waitForFunction((id) => document.querySelector('.feed [id^="msg-"]')?.id !== id, before, {
        timeout: 10000,
      });
    } catch {
      break;
    }
    pageTimes.push(Date.now() - t0);
    moved = Math.max(moved, Math.abs((await topOf(before)) - topBefore));
  }
  const scrollFrames = await page.evaluate(frameResult);
  record('  the message being read stays where it was on screen (most it moved)', moved, 'px', 3);
  const far = await counts(page);
  record(`scrolled back ${pageTimes.length} pages: slowest page`, Math.max(...pageTimes), 'ms', 600);
  record('  longest freeze while scrolling back', scrollFrames.worst, 'ms', 250);
  record('  messages kept on the page', far.messages, '', 400);
  record('  page elements', far.nodes, '', 25000);
  if (far.heapMb) record('  memory used by the page', far.heapMb, 'MB', 120);

  // Typing while all of that is loaded: must feel the same as with one page.
  const heavy = await typeIt();
  record(
    'typing the same with all that loaded: extra time over the yardstick',
    Math.max(0, heavy.took - light.took),
    'ms',
    300,
  );
  record('  longest freeze while typing', heavy.worst, 'ms', 120);

  // Other people post while it is all loaded.
  const tokens = [];
  for (const email of ['a@x', 'b@x', 'c@x', 'dee@x', 'eli@x', 'fay@x']) tokens.push(await signIn(email));
  await page.evaluate(frameWatch);
  for (let round = 0; round < 2; round++) {
    await Promise.all(
      tokens.map((token, i) =>
        fetch(`${BASE}/api/chat/channels/${generalId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ content: `Incoming ${round}-${i} while a lot is loaded` }),
        }),
      ),
    );
    await page.waitForTimeout(1100);
  }
  const incoming = await page.evaluate(frameResult);
  record('12 messages arriving meanwhile: longest freeze', incoming.worst, 'ms', 150);

  // Scroll down again: the window follows, loading newer pages and letting go of older ones.
  const downTimes = [];
  await page.evaluate(frameWatch);
  for (let i = 0; i < 10; i++) {
    const last = await page.evaluate(() => [...document.querySelectorAll('.feed [id^="msg-"]')].at(-1)?.id);
    const t0 = Date.now();
    await page.evaluate(() => {
      const feed = document.querySelector('.feed');
      feed.scrollTop = feed.scrollHeight;
      feed.dispatchEvent(new Event('scroll'));
    });
    try {
      await page.waitForFunction((id) => [...document.querySelectorAll('.feed [id^="msg-"]')].at(-1)?.id !== id, last, {
        timeout: 10000,
      });
    } catch {
      break;
    }
    downTimes.push(Date.now() - t0);
  }
  const downFrames = await page.evaluate(frameResult);
  const down = await counts(page);
  record(
    `scrolled down again ${downTimes.length} pages: slowest page`,
    downTimes.length ? Math.max(...downTimes) : 99999,
    'ms',
    600,
  );
  record('  longest freeze while scrolling down', downFrames.worst, 'ms', 250);
  record('  messages kept on the page', down.messages, '', 400);

  // Leave the channel and come back.
  t = Date.now();
  await page.locator('.chan-row', { hasText: 'Team 0001' }).first().click();
  await page.getByText('Update 20 in Team 0001').first().waitFor({ timeout: 15000 });
  record('open another channel', Date.now() - t, 'ms', 800);
  t = Date.now();
  await page.locator('.chan-row', { hasText: 'General' }).first().click();
  await page.getByText('Incoming 1-5 while a lot is loaded').first().waitFor({ timeout: 15000 });
  record('back to the big channel, at its newest messages', Date.now() - t, 'ms', 800);
  const back = await counts(page);
  record('  messages on the page after coming back', back.messages, '', 60);
  if (back.heapMb) record('  memory used by the page', back.heapMb, 'MB', 120);

  // From a search result deep in old history: the message is shown, newer ones load on scrolling
  // down, and "Jump to latest" returns to the newest end, where live messages appear again.
  t = Date.now();
  await page.click('button[aria-label="Search messages"]');
  await page.fill('[data-testid="search-input"]', 'Message 5001 about');
  await page.locator('[data-testid="search-hit"]', { hasText: 'Message 5001 about' }).first().click();
  await page.locator('.feed .msg.highlight', { hasText: 'Message 5001 about' }).waitFor({ timeout: 15000 });
  record('search for a message 95,000 back and jump to it', Date.now() - t, 'ms', 2500);
  const lastShown = () =>
    page.evaluate(() => [...document.querySelectorAll('.feed [id^="msg-"] .msg-text')].at(-1)?.textContent || '');
  const firstWindow = await lastShown();
  await page.waitForTimeout(2200); // the highlight ends; scrolling is the person's again
  await page.evaluate(() => {
    const feed = document.querySelector('.feed');
    feed.scrollTop = feed.scrollHeight;
    feed.dispatchEvent(new Event('scroll'));
  });
  await page.waitForFunction(
    (was) => ([...document.querySelectorAll('.feed [id^="msg-"] .msg-text')].at(-1)?.textContent || '') !== was,
    firstWindow,
    { timeout: 10000 },
  );
  const further = Number(((await lastShown()).match(/Message (\d+)/) || [])[1] || 0);
  record('  scrolling down from there continues with the next messages (last one shown)', further, '', 5200);
  if (further <= 5026) throw new Error(`scrolling down from a search result did not load newer messages (${further})`);
  await page.getByRole('button', { name: /Jump to latest/ }).click();
  await page.getByText('Incoming 1-5 while a lot is loaded').first().waitFor({ timeout: 15000 });
  await fetch(`${BASE}/api/chat/channels/${generalId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens[0]}` },
    body: JSON.stringify({ content: 'Live again at the newest end' }),
  });
  await page.getByText('Live again at the newest end').first().waitFor({ timeout: 10000 });

  await browser.close();
  return errors;
}

(async () => {
  const ids = await serverTimes();
  const errors = await browserTimes(ids);
  const width = Math.max(...rows.map((r) => r.what.length));
  for (const r of rows)
    console.log(
      `${r.ok ? 'ok  ' : 'SLOW'}  ${r.what.padEnd(width)}  ${String(r.value).padStart(7)} ${r.unit.padEnd(2)}  ${r.limit == null ? '' : `(limit ${r.limit})`}`,
    );
  console.log(`\npage errors: ${errors.length ? errors.join(' | ') : 'none'}`);
  const slow = rows.filter((r) => !r.ok).length;
  console.log(`\n${rows.length - slow}/${rows.length} within their limit`);
  process.exit(slow || errors.length ? 1 : 0);
})().catch((e) => {
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'SLOW'}  ${r.what}  ${r.value} ${r.unit}`);
  console.error('FAILED', e);
  process.exit(1);
});
