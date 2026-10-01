import jwt from 'jsonwebtoken';
export const secret = 's'.repeat(40),
  aud = 'rrs-crm-session';
export const token = (id, role = 'cs_agent') =>
  `Bearer ${jwt.sign({ sub: id, role, aud }, secret, { expiresIn: '1h' })}`;
export const user = {
  id: 7,
  email: 'a@b.c',
  full_name: 'Ann',
  role: 'cs_agent',
  is_approved: true,
  is_active: true,
  sessions_valid_from: null,
  is_locked: false,
  chat_enabled: true,
};

/** Stub DB answering by SQL shape. `rows` maps a regex source → rows. The auth lookup returns `userRow`. */
export function makeDb({ member = true, rows = {}, userRow = user } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      if (/LEFT JOIN account_locks/.test(sql)) return { rows: [userRow], rowCount: 1 };
      if (/FROM chat\.channel_members WHERE channel_id = \$1 AND user_id = \$2/.test(sql))
        return { rows: member ? [{ ok: 1 }] : [], rowCount: member ? 1 : 0 };
      for (const [re, r] of Object.entries(rows)) if (new RegExp(re).test(sql)) return { rows: r, rowCount: r.length };
      return { rows: [], rowCount: 0 };
    },
  };
}
