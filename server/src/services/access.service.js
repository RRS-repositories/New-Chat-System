// Who may contact whom — the rules behind the admin panel's ticks.
//
// A person can be stopped from doing three things to another person: sending direct messages
// (`dm`), calling (`call`) and sharing private channels (`channel`). Blocking all three is
// stored as one `all` row; anything less as one row per kind.
import { httpError } from '../middleware/errors.js';
import { toId } from '../utils/ids.js';
import { countUsers } from '../models/users.model.js';
import { inTransaction, listPairRows, replacePairRows, logAccessChange } from '../models/restrictions.model.js';

export const ACCESS_KINDS = ['dm', 'call', 'channel'];
const MAX_TARGETS = 500;

/** The kinds blocked by a set of stored rows for one direction (`all` = every kind). */
export function blockedKinds(restrictions) {
  const kinds = new Set();
  for (const r of restrictions) {
    if (r === 'all') ACCESS_KINDS.forEach((k) => kinds.add(k));
    else if (ACCESS_KINDS.includes(r)) kinds.add(r);
  }
  return kinds;
}

/** The rows that store a set of blocked kinds. */
export const rowsFor = (kinds) =>
  ACCESS_KINDS.every((k) => kinds.has(k)) ? ['all'] : ACCESS_KINDS.filter((k) => kinds.has(k));

/** Blocked kinds after allowing or blocking `kind` (`all` = every kind). */
export function nextBlocked(current, kind, allowed) {
  const next = new Set(current);
  for (const k of kind === 'all' ? ACCESS_KINDS : [kind]) {
    if (allowed) next.delete(k);
    else next.add(k);
  }
  return next;
}

const sameRows = (a, b) => a.length === b.length && [...a].sort().every((value, i) => value === [...b].sort()[i]);

/**
 * Allows or blocks `userId` contacting each of `targetUserIds` by `kind`, and the reverse
 * direction too with `bothWays`. One transaction, one audit entry. Returns how many directions
 * actually changed.
 */
export async function setAccess(db, { userId, targetUserIds, kind, allowed, bothWays = false, actorId, reason = '' }) {
  const person = toId(userId);
  if (person === null) throw httpError(400, 'bad_user', 'userId is required');
  if (kind !== 'all' && !ACCESS_KINDS.includes(kind))
    throw httpError(400, 'bad_restriction', 'kind must be dm, call, channel or all');
  if (typeof allowed !== 'boolean') throw httpError(400, 'bad_restriction', 'allowed must be true or false');

  const list = Array.isArray(targetUserIds) ? targetUserIds : [];
  const targets = [...new Set(list.map(toId).filter((id) => id !== null && id !== person))];
  if (!targets.length) throw httpError(400, 'bad_user', 'Choose at least one person');
  if (targets.length > MAX_TARGETS) throw httpError(400, 'bad_user', 'Too many people in one change');
  if ((await countUsers(db, [person, ...targets])) < targets.length + 1)
    throw httpError(404, 'unknown_user', 'User not found');

  const newReason = String(reason ?? '')
    .trim()
    .slice(0, 500);
  const directions = targets.flatMap((target) =>
    bothWays
      ? [
          [person, target],
          [target, person],
        ]
      : [[person, target]],
  );

  const changed = await inTransaction(db, async (q) => {
    const existing = await listPairRows(q, { userId: person, otherUserIds: targets });
    let count = 0;
    for (const [from, to] of directions) {
      const current = existing.filter((r) => r.user_id === from && r.target_user_id === to);
      const have = current.map((r) => r.restriction);
      const want = rowsFor(nextBlocked(blockedKinds(have), kind, allowed));
      if (sameRows(want, have)) continue;
      const keptReason = newReason || current.find((r) => r.reason)?.reason || '';
      await replacePairRows(q, {
        fromUserId: from,
        toUserId: to,
        restrictions: want,
        reason: keptReason,
        restrictedBy: actorId,
      });
      count++;
    }
    await logAccessChange(q, {
      actorId,
      userId: person,
      detail: { targetUserIds: targets, kind, allowed, bothWays: !!bothWays, changed: count },
    });
    return count;
  });
  return { changed };
}
