import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getSession, setSession, clearSession } from '../src/auth/session.ts';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };

test('round-trips a session and clears it', () => {
  assert.equal(getSession(), null);
  setSession({ token: 'T', user: { id: 1, fullName: 'Ann', role: 'cs_agent', email: 'a@b.c' } });
  assert.equal(getSession()?.token, 'T');
  clearSession(); assert.equal(getSession(), null);
});

test('corrupt storage reads as no session', () => {
  store.set('chat_session', '{not json');
  assert.equal(getSession(), null);
});
