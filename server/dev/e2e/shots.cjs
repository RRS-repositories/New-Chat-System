// Takes screenshots of the main screens against the local harness (node server/dev/local.mjs →
// http://localhost:5021), for comparing the app with the approved design by eye. Not a pass/fail check.
//   node server/dev/e2e/shots.cjs <folder>
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright-core');

const BASE = process.env.BASE || 'http://localhost:5021';
const OUT = process.argv[2] || 'shots';
fs.mkdirSync(OUT, { recursive: true });
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

async function signIn(email) {
  const r = await fetch(`${BASE}/api/chat/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'local' }),
  });
  return (await r.json()).token;
}
const api = (token, method, url, body) =>
  fetch(`${BASE}/api/chat${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then((r) => r.json());
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed() {
  const [meg, ann, bob, cy] = await Promise.all(['m@x', 'a@x', 'b@x', 'c@x'].map(signIn));
  const channels = (await api(meg, 'GET', '/channels')).channels;
  const general = channels.find((c) => c.name === 'general').id;
  const say = async (token, content, extra = {}) => {
    const r = await api(token, 'POST', `/channels/${general}/messages`, { content, ...extra });
    await wait(1050);
    return r.message;
  };
  const welcome = await say(meg, 'Welcome to the new chat. Try search, threads, reactions and pins.');
  await api(meg, 'POST', `/messages/${welcome.id}/pin`);
  await say(ann, 'Morning all — the deploy went out clean last night.');
  await say(ann, 'No errors in the logs so far.');
  const nice = await say(bob, 'Nice work 👏');
  await api(meg, 'POST', `/messages/${nice.id}/reactions`, { emoji: '👍' });
  await api(cy, 'POST', `/messages/${nice.id}/reactions`, { emoji: '👍' });
  const question = await say(cy, 'Can we talk about the mobile layout at some point today?');
  await say(meg, 'Yes — grab me after lunch.', { threadId: question.id });
  await say(cy, 'Perfect, will do.', { threadId: question.id });
  await say(
    meg,
    'The form is at https://example.com/forms/dsar and it is **very important**.\n- call the client\n- send the letter',
  );
  await api(meg, 'POST', '/channels', { displayName: 'Design', type: 'private', memberIds: [2, 3] });
  await api(meg, 'POST', '/channels', { displayName: 'IT support', type: 'public', memberIds: [2, 3, 5] });
  const dm = (await api(ann, 'POST', '/channels/dm', { userId: 1 })).channel;
  await api(ann, 'POST', `/channels/${dm.id}/messages`, { content: 'Hello — got a minute for the rota?' });
  await api(bob, 'PATCH', '/users/me/status', { statusText: 'In a meeting', statusEmoji: '📅' });
  return { general };
}

async function open(browser, email, viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await shotIfFirst(page);
  await page.fill('input[type=email]', email);
  await page.fill('input[type=password]', 'local');
  await page.click('button[type=submit]');
  await page.waitForSelector('.sidebar-user', { timeout: 20000 });
  return { ctx, page };
}
let signInShot = false;
async function shotIfFirst(page) {
  if (signInShot) return;
  signInShot = true;
  await page.waitForSelector('input[type=email]');
  await shot(page, '00-sign-in');
}

(async () => {
  const { general } = await seed();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  // Ann and Bob are simply present, so presence dots are real.
  const others = [
    await open(browser, 'a@x', { width: 900, height: 700 }),
    await open(browser, 'b@x', { width: 900, height: 700 }),
  ];
  const { page } = await open(browser, 'm@x', { width: 1366, height: 800 });
  await page.goto(`${BASE}/channels/${general}`);
  await page.waitForSelector('.feed .msg');
  await wait(900);
  await shot(page, '01-main-light');
  await page.locator('.feed .msg', { hasText: 'Nice work' }).hover();
  await shot(page, '02-hover-actions');
  await page.click('button[aria-label="Channel details"]');
  await wait(500);
  await shot(page, '03-details');
  await page.click('button[aria-label="Pinned messages"]');
  await wait(400);
  await shot(page, '04-pins');
  await page.locator('.thlink').first().click();
  await wait(500);
  await shot(page, '05-thread');
  await page.keyboard.press('Control+k');
  await page.fill('[data-testid="search-input"]', 'the');
  await wait(900);
  await shot(page, '06-search');
  await page.keyboard.press('Escape');
  await page.click('button[aria-label="Settings"]');
  await wait(400);
  await shot(page, '07-settings');
  await page.click('[data-testid="theme-mode-dark"]');
  await page.click('[role=dialog][aria-label="Settings"] [aria-label="Close"]');
  await wait(400);
  await shot(page, '08-main-dark');
  await page.click('button[aria-label="Settings"]');
  await page.click('[data-testid="theme-accent-ocean"]');
  await page.click('[data-testid="theme-mode-light"]');
  await page.click('[role=dialog][aria-label="Settings"] [aria-label="Close"]');
  await wait(300);
  await shot(page, '09-ocean');
  await page.click('button[aria-label="Settings"]');
  await page.click('[data-testid="theme-accent-violet"]');
  await page.click('[role=dialog][aria-label="Settings"] [aria-label="Close"]');
  await page.locator('.chan-row', { hasText: 'New channel' }).click();
  await wait(300);
  await shot(page, '10-new-channel');
  await page.keyboard.press('Escape');
  await page.click('[role=dialog] [aria-label="Close"]').catch(() => {});
  await page.locator('[data-testid="sidebar-admin"]').click();
  await wait(700);
  await shot(page, '11-admin');

  const phone = await open(browser, 'c@x', { width: 390, height: 800 }, { isMobile: true, hasTouch: true });
  await phone.page.goto(`${BASE}/channels/${general}`);
  await phone.page.waitForSelector('.feed .msg');
  await wait(700);
  await shot(phone.page, '12-mobile-main');
  await phone.page.click('button[aria-label="Channels"]');
  await wait(500);
  await shot(phone.page, '13-mobile-drawer');

  for (const o of others) await o.ctx.close();
  await browser.close();
  console.log(`screenshots in ${OUT}`);
})().catch((e) => {
  console.error('FAILED', e.message.split('\n')[0]);
  process.exit(1);
});
