import type { ApiClient } from './apiClient.ts';
import { withTimeout } from '../utils/timeout.ts';

const START_FAILED = 'Could not start notifications';

/**
 * Web Push on this device. Everything here is best effort: a browser without
 * Service Worker / Push / Notification support, a server without VAPID keys
 * (`key: null`) or a denied permission just means "not available" — chat
 * itself never depends on it.
 */
export type PushState = 'unavailable' | 'denied' | 'off' | 'on';

export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameBytes(a: ArrayBuffer | null, b: Uint8Array): boolean {
  if (!a) return true; // browser does not expose it: assume it matches
  const x = new Uint8Array(a);
  if (x.length !== b.length) return false;
  for (let i = 0; i < x.length; i++) if (x[i] !== b[i]) return false;
  return true;
}

/** Exactly what POST /push/subscribe takes, or null when the subscription is not usable. */
export function subscriptionBody(json: {
  endpoint?: string | null;
  keys?: Record<string, string | undefined>;
}): { endpoint: string; keys: { p256dh: string; auth: string } } | null {
  const p256dh = json?.keys?.p256dh;
  const auth = json?.keys?.auth;
  if (!json?.endpoint || !p256dh || !auth) return null;
  return { endpoint: json.endpoint, keys: { p256dh, auth } };
}

async function sendSubscription(api: ApiClient, sub: PushSubscription): Promise<void> {
  const body = subscriptionBody(sub.toJSON());
  if (!body) throw new Error(START_FAILED);
  await api.post('/api/chat/push/subscribe', body);
}

/** In-page desktop notifications (no push) need only Notification + a service worker to show them. */
export function desktopSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator
  );
}

/** "Allow desktop notifications" (no push key): ask first, inside the click, then register the worker that shows them. */
export async function allowDesktop(): Promise<NotificationPermission> {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') await registerServiceWorker();
  return permission;
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  try {
    return await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
  } catch {
    return null;
  }
}

async function existingSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

/** The VAPID public key, or null when push is not configured / not reachable. */
export async function loadPushKey(api: ApiClient): Promise<string | null> {
  try {
    const r = await api.get<{ key: string | null }>('/api/chat/push/key');
    return typeof r.key === 'string' && r.key ? r.key : null;
  } catch {
    return null;
  }
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unavailable';
  if (Notification.permission === 'denied') return 'denied';
  return Notification.permission === 'granted' && (await existingSubscription()) ? 'on' : 'off';
}

/**
 * Must be called straight from a click handler: the permission prompt needs the
 * user gesture, so it is the first thing done (before any other await).
 */
export async function enablePush(api: ApiClient, key: string): Promise<PushState> {
  if (!pushSupported()) return 'unavailable';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';
  const reg = await registerServiceWorker();
  if (!reg) throw new Error(START_FAILED);
  // `ready` never settles if the worker fails to install: give up after 10 s.
  await withTimeout(navigator.serviceWorker.ready, 10_000, START_FAILED);
  const serverKey = urlBase64ToUint8Array(key);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an older VAPID key cannot be reused: replace it.
  if (sub && !sameBytes(sub.options?.applicationServerKey ?? null, serverKey)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  sub =
    sub ||
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: serverKey as BufferSource }));
  await sendSubscription(api, sub);
  return 'on';
}

export async function disablePush(api: ApiClient): Promise<void> {
  const sub = await existingSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try {
    await sub.unsubscribe();
  } catch {
    /* already gone */
  }
  await api.post('/api/chat/push/unsubscribe', { endpoint }).catch(() => {});
}

/**
 * On load: when permission was already granted, register the worker (desktop
 * notifications go through it) and re-send an existing subscription so the
 * server has it for this user (it may have been dropped, or the device may
 * now be someone else's session). Never creates a new subscription.
 */
export async function restorePush(api: ApiClient): Promise<void> {
  try {
    if (!desktopSupported() || Notification.permission !== 'granted') return;
    const reg = await registerServiceWorker();
    if (!reg || !pushSupported()) return;
    const sub = await reg.pushManager.getSubscription();
    if (sub && (await loadPushKey(api))) await sendSubscription(api, sub);
  } catch {
    /* best effort */
  }
}
