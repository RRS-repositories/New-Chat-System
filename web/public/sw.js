/* Team chat service worker: shows Web Push notifications and routes clicks back to the chat.
 * Served at /sw.js (scope "/"). Plain JS, no imports. */

self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function scopeClients() {
  const scope = self.registration.scope;
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((list) => ({ inScope: list.filter((c) => c.url.startsWith(scope)) }));
}

self.addEventListener('push', (event) => {
  let p = null;
  try {
    p = event.data ? event.data.json() : null;
  } catch (e) {
    p = null;
  }
  if (!p || typeof p !== 'object') p = {};
  const str = (v) => (typeof v === 'string' && v ? v : '');
  const title = str(p.title) || 'Chat';
  const tag = str(p.tag) || str(p.channelId);
  const kind = str(p.kind) || 'message';
  const callId = str(p.callId);
  const opts = {
    body: str(p.body),
    icon: '/icon-192.png',
    badge: '/icon-96.png',
    data: { channelId: str(p.channelId) || null, kind: kind, callId: callId || null },
  };
  if (tag) {
    opts.tag = tag;
    opts.renotify = true;
  } // renotify without a tag is an error
  // An incoming call: Accept and Decline buttons, kept on screen until answered, with its own tag so
  // the "missed call" that may follow closes it.
  if (kind === 'call' && callId) {
    opts.tag = 'call-' + callId;
    opts.renotify = true;
    opts.requireInteraction = true;
    opts.vibrate = [300, 150, 300, 150, 300];
    opts.actions = [
      { action: 'accept', title: 'Accept' },
      { action: 'decline', title: 'Decline' },
    ];
  }
  const closeRing = () =>
    callId && kind !== 'call'
      ? self.registration.getNotifications({ tag: 'call-' + callId }).then((list) => list.forEach((n) => n.close()))
      : Promise.resolve();
  // Always hand waitUntil a promise, whatever happens, or the browser may show its own generic notice.
  event.waitUntil(
    Promise.resolve()
      .then(closeRing)
      .then(scopeClients)
      .then(({ inScope }) => {
        // Someone is looking at the chat right now: the page notifies itself.
        if (inScope.some((c) => c.visibilityState === 'visible' && c.focused)) return undefined;
        return self.registration.showNotification(title, opts);
      })
      .catch(() => self.registration.showNotification(title, opts)),
  );
});

self.addEventListener('notificationclick', (event) => {
  const n = event.notification || {};
  try {
    n.close();
  } catch (e) {
    /* already closed */
  }
  const data = n.data && typeof n.data === 'object' ? n.data : {};
  const channelId = typeof data.channelId === 'string' && data.channelId ? data.channelId : null;
  const callId = data.kind === 'call' && typeof data.callId === 'string' && data.callId ? data.callId : null;
  const action = event.action === 'accept' || event.action === 'decline' ? event.action : 'open';
  event.waitUntil(
    Promise.resolve()
      .then(scopeClients)
      .then(async ({ inScope }) => {
        const target =
          inScope.find((c) => c.focused) || inScope.find((c) => c.visibilityState === 'visible') || inScope[0];
        if (target) {
          try {
            await target.focus();
          } catch (e) {
            /* focus not allowed: still open the channel */
          }
          if (callId) target.postMessage({ type: 'chat-sw:call', callId, channelId, action });
          else if (channelId) target.postMessage({ type: 'chat-sw:open', channelId });
          return undefined;
        }
        if (callId)
          return self.clients.openWindow(
            (channelId ? '/channels/' + encodeURIComponent(channelId) : '/') +
              '?call=' +
              encodeURIComponent(callId) +
              '&do=' +
              action,
          );
        return self.clients.openWindow(channelId ? '/channels/' + encodeURIComponent(channelId) : '/');
      }),
  );
});

// The browser rotated or dropped the subscription. The page re-sends its
// subscription on the next load (permission already granted), so nothing to do here.
self.addEventListener('pushsubscriptionchange', () => {});
