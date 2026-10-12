// People boxes match on the name or the email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { personLine, personMatches } from '../src/utils/people.ts';

test('personMatches: part of the name or of the email, any case; blank matches everyone', () => {
  const ann = { fullName: 'Ann Agent', email: 'ann.agent@rowanrose.co.uk' };
  assert.equal(personMatches(ann, 'agent'), true);
  assert.equal(personMatches(ann, 'ANN.AGENT@'), true);
  assert.equal(personMatches(ann, 'rowanrose'), true);
  assert.equal(personMatches(ann, 'bob'), false);
  assert.equal(personMatches(ann, '   '), true);
  assert.equal(personMatches({ fullName: 'No Email' }, 'x@y'), false);
});

test('personLine: role, plus the email when there is one', () => {
  assert.equal(personLine({ role: 'Sales', email: 'bob@x.co' }), 'Sales · bob@x.co');
  assert.equal(personLine({ role: 'Sales' }), 'Sales');
});
