import type { Session } from '../types/index.ts';

/**
 * Running inside the CRM. The CRM shows the chat in an iframe and hands over the session the person
 * already has, by window message, so nobody signs in twice. Messages are only ever accepted from the
 * CRM's own addresses, and the token never goes in the address bar.
 *
 *   CRM → chat   crm-chat:session   { token, user: { id, fullName, role, email } }
 *   chat → CRM   crm-chat:ready     the chat is loaded and would like the session
 *   chat → CRM   crm-chat:badge     { count }  what the tab title would show
 *   chat → CRM   crm-chat:auth-error  the token was refused; please send a fresh one
 */
export const MSG = {
  ready: 'crm-chat:ready',
  session: 'crm-chat:session',
  badge: 'crm-chat:badge',
  authError: 'crm-chat:auth-error',
} as const;

/** The addresses the CRM is served from (the only parents whose session messages are taken). */
export const PARENT_ORIGINS = ['https://crm.rowanroseclaims.co.uk', 'https://rowanroseclaims.co.uk'];

/** True when the page is shown inside another page. */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // a cross-origin parent refuses the comparison: that is an iframe too
  }
}

/** The parents a message may come from: the CRM, and the page's own address (used by the local check). */
export function allowedParents(ownOrigin: string): string[] {
  return [...PARENT_ORIGINS, ownOrigin];
}

/**
 * A session message from a parent → the session, or null when it is not one: wrong type, a parent
 * that is not allowed, no token, or no usable person.
 */
export function acceptSession(event: { origin: string; data: unknown }, allowed: string[]): Session | null {
  if (!allowed.includes(event.origin)) return null;
  const d = event.data as any;
  if (!d || typeof d !== 'object' || d.type !== MSG.session) return null;
  if (typeof d.token !== 'string' || !d.token) return null;
  const u = d.user;
  const id = Number(u?.id);
  if (!u || !Number.isFinite(id) || id <= 0) return null;
  const email = typeof u.email === 'string' && u.email ? u.email : undefined;
  return {
    token: d.token,
    user: { id, fullName: String(u.fullName || email || ''), role: String(u.role || ''), ...(email ? { email } : {}) },
  };
}

/** Sends a message to the page around us; a parent that is not an allowed address never receives it. */
export function postToParent(type: string, payload: Record<string, unknown> = {}): void {
  if (!isEmbedded()) return;
  for (const origin of allowedParents(window.location.origin)) {
    try {
      window.parent.postMessage({ type, ...payload }, origin);
    } catch {
      /* a parent at another address simply does not get it */
    }
  }
}
