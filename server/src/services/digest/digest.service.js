/** Daily email digest of unread mentions (off unless config.digestEnabled). */
import { listUnreadMentionsForDigest, markDigestSent } from '../../models/digest.model.js';
import { createSmtpSender } from './mail.js';

const CHECK_MS = 10 * 60 * 1000;
const SUBJECT = 'You have unread mentions in team chat';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const label = (ch) => (ch.type === 'dm' ? 'Direct message' : `#${ch.display_name}`);
const plural = (n) => `${n} mention${n === 1 ? '' : 's'}`;

function buildEmail(channels, publicUrl) {
  const items = channels.map((ch) => ({ label: label(ch), count: plural(ch.n) }));
  const link = `Open team chat: ${publicUrl}`;
  const text = [`You have unread mentions in these channels:`, '', ...items.map((i) => `${i.label} — ${i.count}`), '', link].join('\n');
  const html = `<p>You have unread mentions in these channels:</p><ul>${items.map((i) => `<li>${esc(i.label)} — ${esc(i.count)}</li>`).join('')}</ul>`
    + `<p>Open team chat: <a href="${esc(publicUrl)}">${esc(publicUrl)}</a></p>`;
  return { subject: SUBJECT, text, html };
}

export function startDigest({ db, config = {}, sendMail, now = () => new Date(), isConnected = () => false } = {}) {
  if (!config.digestEnabled) return { stop() {}, async runOnce() { return { sent: 0, skipped: 0 }; } };
  const send = sendMail || createSmtpSender(config);
  const publicUrl = config.publicUrl || '';

  async function runOnce() {
    const at = now();
    const rows = await listUnreadMentionsForDigest(db, at);
    const byUser = new Map();
    for (const r of rows) {
      if (!byUser.has(r.user_id)) byUser.set(r.user_id, { email: r.email, channels: [] });
      byUser.get(r.user_id).channels.push(r);
    }
    let sent = 0, skipped = 0;
    for (const [userId, { email, channels }] of byUser) {
      if (isConnected(userId)) continue; // last_seen_at is stale while a socket stays open
      try {
        await send({ to: email, ...buildEmail(channels, publicUrl) });
        await markDigestSent(db, userId, at);
        sent++;
      } catch (e) {
        skipped++;
        console.error('[chat] digest', `user ${userId}:`, e?.message || e);
      }
    }
    return { sent, skipped };
  }

  let lastRunDate = null;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    const t = now();
    const date = t.toISOString().slice(0, 10);
    if (t.getUTCHours() !== config.digestHourUtc || lastRunDate === date) return;
    running = true;
    try { await runOnce(); lastRunDate = date; } catch (e) { console.error('[chat] digest', e?.message || e); } finally { running = false; }
  }, CHECK_MS);
  timer.unref?.();

  return { stop() { clearInterval(timer); }, runOnce };
}
