// Who may moderate a channel: delete anyone's message, pin, remove members.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canModerate } from '../src/services/channels.service.js';

const dbWith = (members) => ({
  async query() {
    return { rows: members, rowCount: members.length };
  },
});

test('Management and IT moderate every channel; a channel owner or admin their own; anyone else not', async () => {
  const nobody = dbWith([]);
  assert.equal(await canModerate(nobody, 'c1', { id: 1, role: 'Management' }), true);
  assert.equal(await canModerate(nobody, 'c1', { id: 2, role: 'IT' }), true);
  assert.equal(await canModerate(nobody, 'c1', { id: 3, role: 'Sales' }), false);
  assert.equal(await canModerate(nobody, 'c1', { id: 4, role: 'cs_agent' }), false);
  const owned = dbWith([
    { id: 3, full_name: 'Bob', role: 'Sales', channel_role: 'owner' },
    { id: 5, channel_role: 'admin' },
    { id: 6, channel_role: 'member' },
  ]);
  assert.equal(await canModerate(owned, 'c1', { id: 3, role: 'Sales' }), true);
  assert.equal(await canModerate(owned, 'c1', { id: 5, role: 'Sales' }), true);
  assert.equal(await canModerate(owned, 'c1', { id: 6, role: 'Sales' }), false);
});
