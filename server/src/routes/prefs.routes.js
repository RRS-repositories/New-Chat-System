import { Router } from 'express';
import { httpError, wrap } from '../middleware/errors.js';
import { getPreferences, updatePreferences, setStatus, listStatuses, setChannelNotifyPref } from '../models/prefs.model.js';

/** /users/online, /users/me/preferences, /users/me/status — mounted at /api/chat/users BEFORE the users router. */
export function createPrefRoutes({ db, presence, emit }) {
  const r = Router();

  r.get('/online', wrap(async (_req, res) => {
    const { online = [], away = [] } = presence?.snapshot?.() || {};
    res.json({ success: true, online, away, statuses: await listStatuses(db) });
  }));

  r.get('/me/preferences', wrap(async (req, res) => {
    res.json({ success: true, preferences: await getPreferences(db, req.user.id) });
  }));

  r.patch('/me/preferences', wrap(async (req, res) => {
    res.json({ success: true, preferences: await updatePreferences(db, req.user.id, req.body) });
  }));

  r.patch('/me/status', wrap(async (req, res) => {
    const { statusText, statusEmoji } = req.body && typeof req.body === 'object' ? req.body : {};
    // Nothing to change: answer with the current status, no write and no broadcast.
    if (statusText === undefined && statusEmoji === undefined) {
      const p = await getPreferences(db, req.user.id);
      return res.json({ success: true, status: { text: p.statusText, emoji: p.statusEmoji } });
    }
    const status = await setStatus(db, req.user.id, { statusText, statusEmoji });
    // A broadcast failure must not fail a status that was saved.
    try { emit?.toAll?.('user_status', { user_id: req.user.id, text: status.text, emoji: status.emoji }); }
    catch (e) { console.error('[chat] user_status broadcast failed', e?.message || e); }
    res.json({ success: true, status });
  }));

  return r;
}

/** PATCH /:id/notify — mounted at /api/chat/channels BEFORE the channels router. */
export function createChannelPrefRoutes({ db }) {
  const r = Router();

  r.patch('/:id/notify', wrap(async (req, res) => {
    const notifyPref = await setChannelNotifyPref(db, req.params.id, req.user.id, req.body?.pref);
    if (notifyPref === null) throw httpError(403, 'not_member', 'You are not in this channel');
    res.json({ success: true, notifyPref });
  }));

  return r;
}
