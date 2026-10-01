import type { Session } from '../types/index.ts';

/**
 * Signs in with a CRM email and password. The chat server passes them to the CRM and answers
 * with a session. Throws an Error whose message can be shown to the person.
 */
export async function signIn(email: string, password: string): Promise<Session> {
  let res: Response;
  try {
    res = await fetch('/api/chat/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email.trim(), password }),
    });
  } catch {
    throw new Error('Cannot reach the chat service');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.token) throw new Error(data?.message || 'Sign in failed');
  const { id, fullName, role } = data.user;
  return { token: data.token, user: { id, fullName: fullName || data.user.email, role, email: data.user.email } };
}
