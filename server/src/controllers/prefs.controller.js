import { httpError, wrap } from '../middleware/errors.js';
import { getPreferences, updatePreferences, setStatus, listStatuses, setChannelNotifyPref } from '../models/prefs.model.js';

export function createPrefController({ db, presence, emit }) {
  return {
    /** Who is online or away right now, plus everyone's status message. */
    online: wrap(async (_req, res) => {
      const { online = [], away = [] } = presence?.snapshot?.() || {};
      res.json({ success: true, online, away, statuses: await listStatuses(db) });
    }),

    getPreferences: wrap(async (req, res) => {
      res.json({ success: true, preferences: await getPreferences(db, req.user.id) });
    }),

    updatePreferences: wrap(async (req, res) => {
      res.json({ success: true, preferences: await updatePreferences(db, req.user.id, req.body) });
    }),

    setStatus: wrap(async (req, res) => {
      const { statusText, statusEmoji } = req.body && typeof req.body === 'object' ? req.body : {};
      // Nothing to change: answer with the current status, without writing or telling anyone.
      if (statusText === undefined && statusEmoji === undefined) {
        const current = await getPreferences(db, req.user.id);
        return res.json({ success: true, status: { text: current.statusText, emoji: current.statusEmoji } });
      }
      const status = await setStatus(db, req.user.id, { statusText, statusEmoji });
      // A failure to tell the others must not fail a status that was saved.
      try {
        emit?.toAll?.('user_status', { user_id: req.user.id, text: status.text, emoji: status.emoji });
      } catch (e) {
        console.error('[chat] user_status broadcast failed', e?.message || e);
      }
      res.json({ success: true, status });
    }),
  };
}

export function createChannelPrefController({ db }) {
  return {
    setNotifyLevel: wrap(async (req, res) => {
      const notifyPref = await setChannelNotifyPref(db, req.params.id, req.user.id, req.body?.pref);
      if (notifyPref === null) throw httpError(403, 'not_member', 'You are not in this channel');
      res.json({ success: true, notifyPref });
    }),
  };
}
