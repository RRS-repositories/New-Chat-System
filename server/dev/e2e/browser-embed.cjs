// Real-browser check of the chat inside the CRM: a parent page (stood in for by a page on the same
// address) frames the chat, hands it the session by window message, gets the waiting count back,
// and can switch the chat to another person. Against the local harness
// (node server/dev/local.mjs → http://localhost:5021).
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

/** Signs in through the API the way the CRM would already have: a token and who the person is. */
async function sessionFor(email) {
  const r = await fetch(`${BASE}/api/chat/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'local' }),
  });
  const d = await r.json();
  const { id, fullName, role } = d.user;
  return { token: d.token, user: { id, fullName, role, email } };
}

// The stand-in CRM page: frames the chat and speaks the same messages the CRM's ChatPanel does.
const PARENT_HTML = `<!doctype html><title>CRM stand-in</title>
<style>html,body,iframe{margin:0;height:100%;width:100%;border:0}</style>
<iframe id="chat" src="${BASE}/" allow="microphone; display-capture; autoplay"></iframe>
<script>
  window.__badges = []; window.__authErrors = 0; window.__session = null;
  const chat = () => document.getElementById('chat').contentWindow;
  window.sendSession = (s) => chat().postMessage({ type: 'crm-chat:session', ...s }, '${BASE}');
  window.addEventListener('message', (e) => {
    if (e.origin !== '${BASE}') return;
    const d = e.data || {};
    if (d.type === 'crm-chat:ready' && window.__session) window.sendSession(window.__session);
    else if (d.type === 'crm-chat:badge') window.__badges.push(d.count);
    else if (d.type === 'crm-chat:auth-error') window.__authErrors += 1;
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
  const meg = await sessionFor('m@x');
  const ann = await sessionFor('a@x');
  const chat = page.frameLocator('#chat');

  await step('the server lets the CRM frame the chat, and nobody else', async () => {
    const r = await fetch(`${BASE}/`);
    const csp = r.headers.get('content-security-policy') || '';
    if (!/frame-ancestors 'self' https:\/\/crm\.rowanroseclaims\.co\.uk https:\/\/rowanroseclaims\.co\.uk/.test(csp))
      throw new Error(`frame-ancestors: ${csp}`);
    if (r.headers.get('x-frame-options')) throw new Error('X-Frame-Options is still sent');
  });

  await step('framed by the CRM, the chat asks for the session and opens signed in, with no sign-in form', async () => {
    await page.goto(`${BASE}/crm-stand-in`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((s) => {
      window.__session = s;
    }, meg);
    await chat.locator('.sidebar-user', { hasText: 'Meg Manager' }).waitFor({ timeout: 15000 });
    if (await chat.locator('input[type=password]').count()) throw new Error('a sign-in form is shown');
  });

  await step('the chat reports its waiting count to the CRM', async () => {
    await page.waitForFunction(() => window.__badges.length > 0, null, { timeout: 8000 });
    const last = await page.evaluate(() => window.__badges[window.__badges.length - 1]);
    if (typeof last !== 'number') throw new Error(`count is ${JSON.stringify(last)}`);
  });

  await step(
    'a session for another person replaces the one the chat had (a shared browser never shows the previous person)',
    async () => {
      await page.evaluate((s) => window.sendSession(s), ann);
      await chat.locator('.sidebar-user', { hasText: 'Ann Agent' }).waitFor({ timeout: 15000 });
      if (await chat.locator('.sidebar-user', { hasText: 'Meg Manager' }).count()) throw new Error('still Meg');
    },
  );

  await step(
    'opened again later, the chat is still signed in and asks the CRM for nothing it does not need',
    async () => {
      await page.evaluate((s) => {
        window.__session = s;
      }, ann);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await chat.locator('.sidebar-user', { hasText: 'Ann Agent' }).waitFor({ timeout: 15000 });
      if (await page.evaluate(() => window.__authErrors)) throw new Error('the chat reported an auth error');
    },
  );

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
