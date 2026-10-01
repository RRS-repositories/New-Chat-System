import type { Session } from '../types/index.ts';
const KEY = 'chat_session';
export function getSession(): Session | null {
  try { const raw = localStorage.getItem(KEY); if (!raw) return null; const s = JSON.parse(raw); return s?.token && s?.user ? s : null; } catch { return null; }
}
export function setSession(s: Session) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {} }
export function clearSession() { try { localStorage.removeItem(KEY); } catch {} }
