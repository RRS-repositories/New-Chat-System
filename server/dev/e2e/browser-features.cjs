// Real-browser check of message formatting and channel housekeeping against the local harness
// (node server/dev/local.mjs → http://localhost:5021):
//   - links are clickable (and safe), **bold**, `code`, code blocks and lists are shown as such
//   - nothing typed in a message can run as code
//   - a channel can be renamed, left and archived, by the right people
//   node server/dev/e2e/browser-features.cjs [screenshot.png]
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
const tid = (id) => `[data-testid="${id}"]`;
const gone = (locator, timeout = 10000) => locator.waitFor({ state: 'detached', timeout });

async function person(browser, email, label) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('dialog', (d) => {
    errors.push(`${label} saw a dialog: ${d.message()}`);
    void d.dismiss();
  });
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
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('chat_session')).token);
  return { ctx, page, label, token };
}
const send = async (page, text) => {
  await page.waitForTimeout(1100); // one message a second per person
  await page.fill('.input-row textarea', text);
  await page.keyboard.press('Enter');
};
const openOptions = async (page, channelName) => {
  await page.locator('.chan-row', { hasText: channelName }).first().click();
  await page.click('button[aria-label="Channel details"]');
  await page.click(tid('channel-options-tab'));
};

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: !process.env.HEADED });
  const meg = await person(browser, 'm@x', 'Meg');
  const ann = await person(browser, 'a@x', 'Ann');
  const bob = await person(browser, 'b@x', 'Bob');
  const last = (page) => page.locator('.feed .msg').last();

  // ---- formatting -----------------------------------------------------------
  await step('a web address is a link that opens in a new tab; the full stop after it is not part of it', async () => {
    await send(meg.page, 'The form is at https://example.com/forms/dsar?id=7.');
    const link = ann.page.locator('.feed a.msg-link', { hasText: 'https://example.com/forms/dsar?id=7' }).last();
    await link.waitFor({ timeout: 10000 });
    const attrs = await link.evaluate((a) => ({
      href: a.getAttribute('href'),
      target: a.target,
      rel: a.rel,
      text: a.textContent,
    }));
    if (attrs.href !== 'https://example.com/forms/dsar?id=7') throw new Error(`href ${attrs.href}`);
    if (attrs.target !== '_blank' || !/noopener/.test(attrs.rel) || !/noreferrer/.test(attrs.rel))
      throw new Error(`target/rel ${attrs.target} ${attrs.rel}`);
    if (!(await last(ann.page).textContent()).includes('?id=7.')) throw new Error('the full stop was lost');
  });
  await step('**bold** and `code` are shown as bold and code, without the marks', async () => {
    await send(meg.page, 'This is **very important** and the command is `npm test`');
    await ann.page.locator('.feed .msg strong', { hasText: 'very important' }).last().waitFor({ timeout: 10000 });
    await ann.page
      .locator('.feed .msg code.msg-inline-code', { hasText: 'npm test' })
      .last()
      .waitFor({ timeout: 5000 });
    const shown = await last(ann.page).locator('.msg-text').textContent();
    if (shown.includes('**') || shown.includes('`')) throw new Error(`marks still shown: ${shown}`);
  });
  await step('lines starting with a dash become a list; a numbered list keeps its numbers', async () => {
    await send(meg.page, 'To do:\n- call the client\n- send the letter\n1. first\n2. second');
    await ann.page.locator('.feed .msg ul.msg-list li').nth(1).waitFor({ timeout: 10000 });
    const bullets = await last(ann.page).locator('ul.msg-list li').allTextContents();
    const numbers = await last(ann.page).locator('ol.msg-list li').allTextContents();
    if (bullets.join('|') !== 'call the client|send the letter') throw new Error(`bullets: ${bullets.join('|')}`);
    if (numbers.join('|') !== 'first|second') throw new Error(`numbers: ${numbers.join('|')}`);
  });
  await step('a fenced block is shown as code, exactly as typed', async () => {
    await send(meg.page, '```\nSELECT *\n  FROM claims -- **not bold**\n```');
    const block = ann.page.locator('.feed .msg pre.msg-code').last();
    await block.waitFor({ timeout: 10000 });
    const body = await block.textContent();
    if (body !== 'SELECT *\n  FROM claims -- **not bold**') throw new Error(`code block: ${JSON.stringify(body)}`);
  });
  await step('nothing typed can run as code: tags and script addresses stay plain text', async () => {
    await send(
      meg.page,
      'x <img src=x onerror=alert(1)> javascript:alert(2) <a href="https://evil.example/x">click</a>',
    );
    await ann.page.locator('.feed .msg', { hasText: 'javascript:alert(2)' }).last().waitFor({ timeout: 10000 });
    await ann.page.waitForTimeout(500);
    const inside = await last(ann.page).evaluate((el) => ({
      images: el.querySelectorAll('img').length,
      links: [...el.querySelectorAll('a')].map((a) => a.getAttribute('href')),
    }));
    if (inside.images) throw new Error('an image element was created from typed text');
    if (inside.links.some((href) => !/^https?:\/\//.test(href))) throw new Error(`unsafe link: ${inside.links}`);
  });
  if (process.argv[2]) await ann.page.screenshot({ path: process.argv[2] });

  // ---- housekeeping ---------------------------------------------------------
  let channelId = '';
  await step('set-up: Ann creates a private channel with Meg and Bob', async () => {
    const r = await fetch(`${BASE}/api/chat/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ann.token}` },
      body: JSON.stringify({ displayName: 'Project X', type: 'private', memberIds: [1, 3] }),
    });
    channelId = (await r.json()).channel.id;
    for (const p of [meg, bob])
      await p.page.locator('.chan-row', { hasText: 'Project X' }).first().waitFor({ timeout: 10000 });
    await ann.page.reload({ waitUntil: 'domcontentloaded' });
    await ann.page.locator('.chan-row', { hasText: 'Project X' }).first().waitFor({ timeout: 15000 });
  });
  await step('a plain member can leave but cannot rename or archive', async () => {
    await openOptions(bob.page, 'Project X');
    await bob.page.waitForSelector(tid('channel-leave'));
    if (await bob.page.locator(`${tid('channel-name')}, ${tid('channel-archive')}`).count())
      throw new Error('a plain member was offered rename or archive');
  });
  await step('the owner renames the channel and sets its purpose: everyone sees the new name at once', async () => {
    await openOptions(ann.page, 'Project X');
    await ann.page.fill(tid('channel-name'), 'Project Y');
    await ann.page.fill(tid('channel-purpose'), 'Everything about project Y');
    await ann.page.click(tid('channel-save'));
    for (const p of [ann, meg, bob])
      await p.page.locator('.chan-row', { hasText: 'Project Y' }).first().waitFor({ timeout: 10000 });
    if (await meg.page.locator('.chan-row', { hasText: 'Project X' }).count()) throw new Error('old name still listed');
  });
  await step('leaving asks first; "Cancel" keeps the channel', async () => {
    await bob.page.click(tid('channel-leave'));
    await bob.page.getByRole('button', { name: 'Cancel' }).click();
    if (!(await bob.page.locator('.chan-row', { hasText: 'Project Y' }).count())) throw new Error('left on Cancel');
  });
  await step('Bob leaves: the channel goes from his list and he is taken elsewhere; the others keep it', async () => {
    await bob.page.click(tid('channel-leave'));
    await bob.page.click(tid('channel-confirm'));
    await gone(bob.page.locator('.chan-row', { hasText: 'Project Y' }));
    await bob.page.waitForFunction((id) => !location.pathname.includes(id), channelId, { timeout: 10000 });
    await bob.page.waitForSelector('.input-row textarea', { timeout: 10000 });
    if (!(await ann.page.locator('.chan-row', { hasText: 'Project Y' }).count())) throw new Error('Ann lost it too');
  });
  await step('General cannot be left or archived', async () => {
    await openOptions(bob.page, 'General');
    await bob.page.getByText('Everyone stays in General').waitFor({ timeout: 5000 });
    if (await bob.page.locator(`${tid('channel-leave')}, ${tid('channel-archive')}`).count())
      throw new Error('General offers leave or archive');
  });
  await step(
    'the owner archives the channel: it disappears for everyone, including someone who has it open',
    async () => {
      await meg.page.locator('.chan-row', { hasText: 'Project Y' }).first().click();
      await meg.page.waitForFunction((id) => location.pathname.includes(id), channelId, { timeout: 10000 });
      await ann.page.click(tid('channel-archive'));
      await ann.page.click(tid('channel-confirm'));
      for (const p of [ann, meg]) await gone(p.page.locator('.chan-row', { hasText: 'Project Y' }));
      await meg.page.waitForFunction((id) => !location.pathname.includes(id), channelId, { timeout: 10000 });
      const r = await fetch(`${BASE}/api/chat/channels/${channelId}/messages`, {
        headers: { Authorization: `Bearer ${meg.token}` },
      });
      if (r.status !== 403) throw new Error(`archived channel still answers ${r.status}`);
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
