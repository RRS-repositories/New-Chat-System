// Shown inside the CRM: nothing is taken from the CRM login; only the waiting count goes up, to the CRM's addresses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedParents, MSG, PARENT_ORIGINS } from '../src/utils/embed.ts';

test("the CRM addresses are https, and the page's own address is allowed for the local check", () => {
  assert.ok(PARENT_ORIGINS.every((o) => o.startsWith('https://')));
  assert.deepEqual(allowedParents('http://localhost:5021'), [...PARENT_ORIGINS, 'http://localhost:5021']);
});

test('the only message to the CRM is the waiting count', () => {
  assert.deepEqual(Object.keys(MSG), ['badge']);
});
