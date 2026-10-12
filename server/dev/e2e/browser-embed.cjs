// Real-browser check of the chat inside the CRM: a parent page (stood in for by a page on the same
// address) frames the chat; the person signs in to their own account inside the frame; the browser
// remembers it; the waiting count is reported to the parent; signing out offers the form again.
// Against the local harness (node server/dev/local.mjs → http://localhost:5021).
//   node server/dev/e2e/browser-embed.cjs
const { chromium } = require('playwright-core');
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

// The stand-in CRM page: frames the chat and listens the way the CRM's ChatPanel does.
const PARENT_HTML = `<!doctype html><title>CRM stand-in</title>
<style>html,body,iframe{margin:0;height:100%;width:100%;border:0}</style>
<iframe id="chat" src="${BASE}/" allow="microphone; display-capture; autoplay"></iframe>
<script>
  window.__badges = []; window.__other = [];
  window.addEventListener('message', (e) => {
    if (e.origin !== '${BASE}') return;
    const d = e.data || {};
    if (d.type === 'crm-chat:badge') window.__badges.push(d.count);
    else window.__other.push(d.type);
  });
</script>`;

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 760 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text()))
      errors.push(`console: ${m.text().slice(0, 160)}`);
  });
  await page.route(`${BASE}/crm-stand-in`, (route) => route.fulfill({ contentType: 'text/html', body: PARENT_HTML }));
  const chat = page.frameLocator('#chat');

  await step('the server lets the CRM frame the chat, and nobody else', async () => {
    const r = await fetch(`${BASE}/`);
    const csp = r.headers.get('content-security-policy') || '';
    if (!/frame-ancestors 'self' https:\/\/crm\.rowanroseclaims\.co\.uk https:\/\/rowanroseclaims\.co\.uk/.test(csp))
      throw new Error(`frame-ancestors: ${csp}`);
    if (r.headers.get('x-frame-options')) throw new Error('X-Frame-Options is still sent');
  });

  await step('framed by the CRM, the chat offers its own sign-in, saying this browser will remember it', async () => {
    await page.goto(`${BASE}/crm-stand-in`, { waitUntil: 'domcontentloaded' });
    await chat.locator('input[type=password]').waitFor({ timeout: 15000 });
    const text = await chat.locator('.login-card').innerText();
    if (!/remembers it/.test(text)) throw new Error(`no note: ${text.slice(0, 120)}`);
  });

  await step('the person signs in as themselves and the chat opens as them', async () => {
    await chat.locator('input[type=email]').fill('b@x');
    await chat.locator('input[type=password]').fill('local');
    await chat.locator('button[type=submit]').click();
    await chat.locator('.sidebar-user', { hasText: 'Bob Sales' }).waitFor({ timeout: 15000 });
  });

  await step('the chat reports its waiting count to the CRM, and nothing else', async () => {
    await page.waitForFunction(() => window.__badges.length > 0, null, { timeout: 8000 });
    const last = await page.evaluate(() => window.__badges[window.__badges.length - 1]);
    if (typeof last !== 'number') throw new Error(`count is ${JSON.stringify(last)}`);
    const other = await page.evaluate(() => window.__other);
    if (other.length) throw new Error(`other messages sent: ${other}`);
  });

  await step('opened again later, this browser is still signed in as the same person', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await chat.locator('.sidebar-user', { hasText: 'Bob Sales' }).waitFor({ timeout: 15000 });
    if (await chat.locator('input[type=password]').count()) throw new Error('asked to sign in again');
  });

  await step('signing out inside the frame offers the sign-in form again (another person can sign in)', async () => {
    await chat.locator('.s-me').click();
    await chat.locator('[data-testid="sign-out"]').click();
    await chat.locator('input[type=password]').waitFor({ timeout: 15000 });
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
