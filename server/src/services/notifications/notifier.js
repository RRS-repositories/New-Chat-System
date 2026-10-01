import webpushLib from 'web-push';
import { messageCandidates, callCandidates, subscriptionsForUsers, deleteSubscriptionByEndpoint } from '../../models/push.model.js';

/**
 * Web Push for people with no live socket (connected clients notify themselves).
 * Inert when the VAPID keys are not configured. Every method returns a promise that
 * never rejects: failures are logged as '[chat] push' and swallowed.
 */
const NEVER_PUSHED = new Set(['system', 'join', 'leave', 'call']);
const PREVIEW_CHARS = 140;
const MESSAGE_TTL = 86400, CALL_TTL = 30, MISSED_TTL = 86400;
const SEND_TIMEOUT_MS = 10_000; // an endpoint that never answers must not leave a socket pending

const log = (...a) => console.error('[chat] push', ...a);

/** The level that applies: the channel's notify_pref unless 'default', else the user's desktop_notif. */
export const effectiveLevel = ({ notifyPref, desktopNotif }) =>
  (notifyPref && notifyPref !== 'default' ? notifyPref : desktopNotif || 'mentions');

/** Recipient rule for a message (connection state is checked separately). */
export function messageAllows({ level, mentioned, mentionAll, channelType }) {
  if (level === 'all') return true;
  if (level === 'mentions') return !!(mentioned || mentionAll || channelType === 'dm' || channelType === 'group_dm');
  return false;
}

export function preview(content) {
  const text = String(content ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(text); // code points, so an emoji is never split
  return chars.length > PREVIEW_CHARS ? `${chars.slice(0, PREVIEW_CHARS).join('')}…` : text;
}

const where = (channel) => (channel?.type === 'dm' ? null : `#${channel?.displayName ?? ''}`);

export function createNotifier({ db, presence, config, webpush } = {}) {
  const publicKey = config?.vapidPublic || '', privateKey = config?.vapidPrivate || '';
  const enabled = !!(db && publicKey && privateKey);
  const vapidDetails = { subject: config?.vapidSubject || 'mailto:it@rowanrose.co.uk', publicKey, privateKey };
  const wp = webpush || webpushLib;
  const connected = (userId) => { try { return !!presence?.isConnected?.(userId); } catch { return false; } };

  async function send(userIds, payload, { TTL, urgency }) {
    if (!userIds.length) return;
    const subs = await subscriptionsForUsers(db, userIds);
    if (!subs.length) return;
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(subs.map(async (s) =>
      wp.sendNotification({ endpoint: s.endpoint, keys: s.keys }, body, { TTL, urgency, vapidDetails, timeout: SEND_TIMEOUT_MS })));
    await Promise.all(results.map(async (r, i) => {
      if (r.status === 'fulfilled') return;
      const err = r.reason;
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        try { await deleteSubscriptionByEndpoint(db, subs[i].endpoint); } catch (e) { log('cleanup failed', e?.message || e); }
        return;
      }
      log(`send failed${err?.statusCode ? ` (${err.statusCode})` : ''}:`, err?.message || err);
    }));
  }

  const safe = (fn) => async (args) => {
    if (!enabled) return;
    try { await fn(args || {}); } catch (e) { log(e?.message || e); }
  };

  async function onMessage({ message, channelId, senderId, senderName, mentionedUserIds, mentionAll }) {
    const type = message?.type || 'message';
    if (NEVER_PUSHED.has(type)) return;
    const { channel, members } = await messageCandidates(db, { channelId, senderId });
    if (!channel) return;
    const mentioned = new Set(mentionedUserIds || []);
    const userIds = members
      .filter((m) => m.userId !== senderId)
      .filter((m) => messageAllows({ level: effectiveLevel(m), mentioned: mentioned.has(m.userId), mentionAll, channelType: channel.type }))
      .filter((m) => !connected(m.userId))
      .map((m) => m.userId);
    if (!userIds.length) return;
    const name = senderName || message?.userName || 'Someone';
    const hasFiles = type === 'file' || (!String(message?.content ?? '').trim() && message?.files?.length);
    await send(userIds, {
      kind: 'message',
      title: channel.type === 'dm' ? name : `#${channel.displayName}`,
      body: hasFiles ? `${name} sent a file` : `${name}: ${preview(message?.content)}`,
      channelId: channel.id,
      tag: channel.id,
    }, { TTL: MESSAGE_TTL, urgency: 'normal' });
  }

  // Calls always notify unless the channel is muted or the level resolves to 'nothing'.
  const callRecipients = async (channel, userIds) => (await callCandidates(db, { channelId: channel.id, userIds: userIds || [] }))
    .filter((m) => effectiveLevel(m) !== 'nothing')
    .filter((m) => !connected(m.userId))
    .map((m) => m.userId);

  async function onIncomingCall({ channel, fromName, userIds }) {
    const to = await callRecipients(channel, userIds);
    const w = where(channel);
    await send(to, {
      kind: 'call', title: 'Incoming call',
      body: w ? `${fromName} is calling in ${w}` : `${fromName} is calling you`,
      channelId: channel.id, tag: channel.id,
    }, { TTL: CALL_TTL, urgency: 'high' });
  }

  async function onMissedCall({ channel, fromName, userIds }) {
    const to = await callRecipients(channel, userIds);
    const w = where(channel);
    await send(to, {
      kind: 'missed_call', title: 'Missed call',
      body: w ? `${fromName} called in ${w}` : `${fromName} called you`,
      channelId: channel.id, tag: channel.id,
    }, { TTL: MISSED_TTL, urgency: 'normal' });
  }

  return { onMessage: safe(onMessage), onIncomingCall: safe(onIncomingCall), onMissedCall: safe(onMissedCall) };
}
