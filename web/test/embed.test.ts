// Shown inside the CRM: the session arrives by window message, from the CRM's addresses only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acceptSession, allowedParents, MSG, PARENT_ORIGINS } from '../src/utils/embed.ts';

const allowed = allowedParents('http://localhost:5021');
const good = {
  type: MSG.session,
  token: 'T',
  user: { id: 7, fullName: 'Ann Agent', role: 'cs_agent', email: 'ann@x' },
};

test('a well-formed session from the CRM is taken, with the person', () => {
  assert.deepEqual(acceptSession({ origin: 'https://crm.rowanroseclaims.co.uk', data: good }, allowed), {
    token: 'T',
    user: { id: 7, fullName: 'Ann Agent', role: 'cs_agent', email: 'ann@x' },
  });
  assert.equal(acceptSession({ origin: 'https://rowanroseclaims.co.uk', data: good }, allowed)?.token, 'T');
  assert.equal(acceptSession({ origin: 'http://localhost:5021', data: good }, allowed)?.token, 'T', 'own address');
});

test('any other address is ignored, whatever it sends', () => {
  for (const origin of ['https://evil.example', 'https://crm.rowanroseclaims.co.uk.evil.example', 'null', ''])
    assert.equal(acceptSession({ origin, data: good }, allowed), null, origin);
  assert.ok(!PARENT_ORIGINS.some((o) => o.startsWith('http://')), 'the CRM addresses are https');
});

test('a message that is not a session, or has no token or no person, is ignored', () => {
  const from = 'https://crm.rowanroseclaims.co.uk';
  assert.equal(acceptSession({ origin: from, data: { ...good, type: MSG.ready } }, allowed), null);
  assert.equal(acceptSession({ origin: from, data: { ...good, token: '' } }, allowed), null);
  assert.equal(acceptSession({ origin: from, data: { ...good, user: null } }, allowed), null);
  assert.equal(acceptSession({ origin: from, data: { ...good, user: { id: 'x' } } }, allowed), null);
  assert.equal(acceptSession({ origin: from, data: 'crm-chat:session' }, allowed), null);
  assert.equal(acceptSession({ origin: from, data: null }, allowed), null);
});

test('a person without a name is named by their email', () => {
  const s = acceptSession(
    { origin: 'https://crm.rowanroseclaims.co.uk', data: { ...good, user: { id: 2, email: 'b@x' } } },
    allowed,
  );
  assert.deepEqual(s?.user, { id: 2, fullName: 'b@x', role: '', email: 'b@x' });
});
