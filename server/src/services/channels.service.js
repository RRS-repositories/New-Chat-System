// Rules about channels: who is in, who may moderate, and who may share a private channel.
import { httpError } from '../middleware/errors.js';
import { isMember, listMembers } from '../models/channels.model.js';
import { blockedPairs } from '../models/restrictions.model.js';

/** Refuses with 403 `not_member` unless the person is in the channel. */
export async function assertMember(db, channelId, userId) {
  if (!(await isMember(db, channelId, userId))) throw httpError(403, 'not_member', 'You are not in this channel');
}

/** Channel owner or admin, or CRM Management: may pin, unpin, remove members and delete others' messages. */
export async function canModerate(db, channelId, user) {
  if (user.role === 'Management') return true;
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
  const involvesJoiner = ([a, b]) => joining.has(a) || joining.has(b);
  const everyone = [...new Set([actorId, ...existingIds, ...joining])];
  const refuse = () => {
    throw httpError(403, 'restricted', 'Some of these people cannot share a private channel');
  };

  if (type === 'group_dm') {
    if ((await blockedPairs(db, { userIds: everyone, kind: ['channel', 'dm'] })).some(involvesJoiner)) refuse();
    return;
  }
  if ((await blockedPairs(db, { userIds: everyone, kind: 'channel' })).some(involvesJoiner)) refuse();
  const actorPairs = await blockedPairs(db, { userIds: [actorId, ...joining], kind: 'dm' });
  const actorAndJoiner = ([a, b]) => (a === actorId && joining.has(b)) || (b === actorId && joining.has(a));
  if (actorPairs.some(actorAndJoiner)) refuse();
}
