// Rules about channels: who is in, who may moderate, and who may share a private channel.
import { httpError } from '../middleware/errors.js';
import { OVERSEER_ROLES, isMember, listMembers } from '../models/channels.model.js';
import { blockedPairDetails } from '../models/restrictions.model.js';

/** Refuses with 403 `not_member` unless the person is in the channel. */
export async function assertMember(db, channelId, userId) {
  if (!(await isMember(db, channelId, userId))) throw httpError(403, 'not_member', 'You are not in this channel');
}

/** Channel owner or admin, or Management or IT (23 Oct 2026): may pin, unpin, remove members and delete others' messages. */
export async function canModerate(db, channelId, user) {
  if (OVERSEER_ROLES.includes(user.role)) return true;
  const me = (await listMembers(db, channelId)).find((m) => m.id === user.id);
  return ['owner', 'admin'].includes(me?.channelRole);
}

/**
 * Refuses (403 `restricted`) when the people being added may not share this private channel or
 * group DM. Public channels are never restricted. A pair only counts when at least one of the two
 * is joining, so a restriction added later does not freeze a channel two people already share.
 * Run before any insert: a refused request adds nobody.
 *
 *  - `channel`/`all`, either direction: any pair that involves a joiner.
 *  - `dm`/`all`, either direction: the actor and any joiner (otherwise a DM restriction is
 *    sidestepped with a two-person private channel). In a group DM, which is a DM in all but
 *    name, any pair that involves a joiner.
 */
export async function assertCanShareChannel(db, { type, actorId, existingIds, joiningIds }) {
  const joining = new Set(joiningIds.filter((id) => id !== actorId));
  if (!joining.size) return;
  const involvesJoiner = ({ a, b }) => joining.has(a) || joining.has(b);
  const everyone = [...new Set([actorId, ...existingIds, ...joining])];
  const refuse = (pairs) => {
    throw httpError(403, 'restricted', shareRefusal(pairs, { actorId }));
  };

  if (type === 'group_dm') {
    const pairs = (await blockedPairDetails(db, { userIds: everyone, kind: ['channel', 'dm'] })).filter(involvesJoiner);
    if (pairs.length) refuse(pairs);
    return;
  }
  const pairs = (await blockedPairDetails(db, { userIds: everyone, kind: 'channel' })).filter(involvesJoiner);
  if (pairs.length) refuse(pairs);
  const actorAndJoiner = ({ a, b }) => (a === actorId && joining.has(b)) || (b === actorId && joining.has(a));
  const actorPairs = (await blockedPairDetails(db, { userIds: [actorId, ...joining], kind: 'dm' })).filter(
    actorAndJoiner,
  );
  if (actorPairs.length) refuse(actorPairs);
}

const FALLBACK_REFUSAL = 'Some of these people cannot share a private channel';
const shortDate = (at) => {
  const d = at ? new Date(at) : null;
  return d && !Number.isNaN(d.getTime())
    ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : null;
};
/**
 * The refusal in words: who may not share a channel with whom, who set that and when, and where
 * Management can lift it. "You" when the person asking is one of the pair. Falls back to the plain
 * sentence when the names are not known.
 */
export function shareRefusal(pairs, { actorId = null } = {}) {
  const named = (pairs || []).filter((p) => p.aName && p.bName);
  if (!named.length) return FALLBACK_REFUSAL;
  const who = (p) => {
    const [first, second] =
      p.a === actorId ? ['You', p.bName] : p.b === actorId ? ['You', p.aName] : [p.aName, p.bName];
    const by = p.setBy ? ` (set by ${p.setBy}${shortDate(p.setAt) ? `, ${shortDate(p.setAt)}` : ''})` : '';
    return `${first} and ${second} may not share a channel${by}`;
  };
  const shown = named.slice(0, 2).map(who);
  const more = named.length - shown.length;
  const list = more > 0 ? `${shown.join('; ')}; and ${more} more ${more === 1 ? 'pair' : 'pairs'}` : shown.join('; ');
  return `${list}. Management can lift this under Admin → Restrictions.`;
}
