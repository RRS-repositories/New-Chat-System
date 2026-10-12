/**
 * Running inside the CRM. The CRM shows the chat in an iframe. Everyone signs in to the chat as
 * themselves the first time (the CRM login is shared by several people, so the chat never takes
 * an account from it), and the browser remembers that account. The chat only ever tells the
 * page around it one thing: how many conversations are waiting, for the CRM's Chat nav item.
 *
 *   chat → CRM   crm-chat:badge   { count }  what the tab title would show
 */
export const MSG = {
  badge: 'crm-chat:badge',
} as const;

/** The addresses the CRM is served from: the only pages the count is sent to. */
export const PARENT_ORIGINS = ['https://crm.rowanroseclaims.co.uk', 'https://rowanroseclaims.co.uk'];

/** True when the page is shown inside another page. */
export function isEmbedded(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true; // a cross-origin parent refuses the comparison: that is an iframe too
  }
}

/** The pages a message may go to: the CRM, and the page's own address (used by the local check). */
export function allowedParents(ownOrigin: string): string[] {
  return [...PARENT_ORIGINS, ownOrigin];
}

/** Sends a message to the page around us; a parent at any other address never receives it. */
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
