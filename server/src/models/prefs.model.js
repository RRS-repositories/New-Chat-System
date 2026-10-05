// Per-user chat preferences, status, and per-channel notification level.
// The chat.user_preferences row is created lazily on the first write.

const fail = (message) => Object.assign(new Error(message), { code: 'bad_preference', status: 400 });

export const DEFAULT_PREFERENCES = Object.freeze({
  desktopNotif: 'mentions',
  mobileNotif: 'mentions',
  soundEnabled: true,
  sendOnEnter: true,
  statusText: '',
  statusEmoji: '',
  theme: null,
});
export const STATUS_TEXT_MAX = 100;
export const STATUS_EMOJI_MAX = 16;
const LEVELS = ['all', 'mentions', 'nothing'];
export const THEME_MODES = ['light', 'dark'];
export const THEME_ACCENTS = ['violet', 'ocean', 'sunset', 'emerald', 'magenta'];
const isTheme = (v) => !!v && typeof v === 'object' && THEME_MODES.includes(v.mode) && THEME_ACCENTS.includes(v.accent);
/** The stored text → { mode, accent }, or null when the person has not chosen (or the text is not a theme). */
function readTheme(text) {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    return isTheme(v) ? { mode: v.mode, accent: v.accent } : null;
  } catch {
    return null;
  }
}
export const CHANNEL_NOTIFY_PREFS = ['all', 'mentions', 'nothing', 'default'];

// Known PATCH keys → column + validator. Anything else in a body is ignored.
const FIELDS = {
  desktopNotif: {
    col: 'desktop_notif',
    ok: (v) => LEVELS.includes(v),
    msg: 'desktopNotif must be all, mentions or nothing',
  },
  mobileNotif: {
    col: 'mobile_notif',
    ok: (v) => LEVELS.includes(v),
    msg: 'mobileNotif must be all, mentions or nothing',
  },
  soundEnabled: { col: 'sound_enabled', ok: (v) => typeof v === 'boolean', msg: 'soundEnabled must be true or false' },
  sendOnEnter: { col: 'send_on_enter', ok: (v) => typeof v === 'boolean', msg: 'sendOnEnter must be true or false' },
  // The colour theme follows the person across devices. Stored as a small piece of JSON with only the two known keys.
  theme: {
    col: 'theme',
    ok: isTheme,
    msg: 'theme must be { mode: light or dark, accent: violet, ocean, sunset, emerald or magenta }',
    toDb: (v) => JSON.stringify({ mode: v.mode, accent: v.accent }),
  },
};

const mapPrefs = (r) =>
  r
    ? {
        desktopNotif: r.desktop_notif,
        mobileNotif: r.mobile_notif,
        soundEnabled: r.sound_enabled,
        sendOnEnter: r.send_on_enter,
        statusText: r.status_text || '',
        statusEmoji: r.status_emoji || '',
        theme: readTheme(r.theme),
      }
    : { ...DEFAULT_PREFERENCES };

export async function getPreferences(db, userId) {
  const {
    rows: [r],
  } = await db.query(
    `SELECT desktop_notif, mobile_notif, sound_enabled, send_on_enter, status_text, status_emoji, theme FROM chat.user_preferences WHERE user_id = $1`,
    [userId],
  );
  return mapPrefs(r);
}

// Upsert only the given columns. `cols` are fixed names from this module, never user input.
async function upsert(db, userId, cols, values) {
  const {
    rows: [r],
  } = await db.query(
    `INSERT INTO chat.user_preferences (user_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})
     ON CONFLICT (user_id) DO UPDATE SET ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')}, updated_at = now()
     RETURNING desktop_notif, mobile_notif, sound_enabled, send_on_enter, status_text, status_emoji, theme`,
    [userId, ...values],
  );
  return r;
}

/** Validates every known key before writing anything; unknown keys are ignored. */
export async function updatePreferences(db, userId, patch) {
  const body = patch && typeof patch === 'object' ? patch : {};
  const cols = [],
    values = [];
  for (const [key, f] of Object.entries(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
    if (!f.ok(body[key])) throw fail(f.msg);
    cols.push(f.col);
    values.push(f.toDb ? f.toDb(body[key]) : body[key]);
  }
  if (!cols.length) return getPreferences(db, userId);
  return mapPrefs(await upsert(db, userId, cols, values));
}

const chars = (s) => [...s].length; // counted in code points, not UTF-16 units

function cleanStatus(value, name, max) {
  if (value === null) return '';
  if (typeof value !== 'string') throw fail(`${name} must be text`);
  const v = value.trim();
  if (chars(v) > max) throw fail(`${name} must be at most ${max} characters`);
  return v;
}

/** Saves whichever of statusText / statusEmoji was sent (a key not sent is kept). */
export async function setStatus(db, userId, { statusText, statusEmoji } = {}) {
  const cols = [],
    values = [];
  if (statusText !== undefined) {
    values.push(cleanStatus(statusText, 'statusText', STATUS_TEXT_MAX));
    cols.push('status_text');
  }
  if (statusEmoji !== undefined) {
    values.push(cleanStatus(statusEmoji, 'statusEmoji', STATUS_EMOJI_MAX));
    cols.push('status_emoji');
  }
  const p = cols.length ? mapPrefs(await upsert(db, userId, cols, values)) : await getPreferences(db, userId);
  return { text: p.statusText, emoji: p.statusEmoji };
}

/** { [userId]: { text, emoji } } for every approved, active user with a non-empty status. */
export async function listStatuses(db) {
  const { rows } = await db.query(
    `SELECT p.user_id, p.status_text, p.status_emoji
       FROM chat.user_preferences p JOIN public.users u ON u.id = p.user_id AND u.is_active AND u.is_approved
      WHERE p.status_text <> '' OR p.status_emoji <> '' ORDER BY p.user_id`,
  );
  const out = {};
  for (const r of rows) out[r.user_id] = { text: r.status_text, emoji: r.status_emoji };
  return out;
}

/** The caller's own notify level for one channel. Returns the saved value, or null when not a member. */
export async function setChannelNotifyPref(db, channelId, userId, pref) {
  if (!CHANNEL_NOTIFY_PREFS.includes(pref)) throw fail('pref must be all, mentions, nothing or default');
  const {
    rows: [r],
  } = await db.query(
    `UPDATE chat.channel_members SET notify_pref = $3 WHERE channel_id = $1 AND user_id = $2 RETURNING notify_pref`,
    [channelId, userId, pref],
  );
  return r ? r.notify_pref : null;
}
