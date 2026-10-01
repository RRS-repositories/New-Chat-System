import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mentionsUser, mentionQueryAt, renderWithMentions, insertMention } from '../src/lib/mentions.ts';

test('mentionsUser: full name, first name, @all, @channel; never inside emails or other words', () => {
  assert.equal(mentionsUser('hi @Ann Agent', 'Ann Agent'), true);
  assert.equal(mentionsUser('hi @ann', 'Ann Agent'), true);
  assert.equal(mentionsUser('@all standup', 'Ann Agent'), true);
  assert.equal(mentionsUser('@channel', 'Ann Agent'), true);
  assert.equal(mentionsUser('ann@x.com', 'Ann Agent'), false);
  assert.equal(mentionsUser('@Annabelle', 'Ann Agent'), false);
});
test('mentionQueryAt finds the @ run under the caret', () => {
  assert.deepEqual(mentionQueryAt('hello @An', 9), { start: 6, query: 'An' });
  assert.deepEqual(mentionQueryAt('@', 1), { start: 0, query: '' });
  assert.equal(mentionQueryAt('hello @An there', 15), null);
  assert.equal(mentionQueryAt('mail me@x', 9), null);
});
test('renderWithMentions marks names longest-first and @all', () => {
  const parts = renderWithMentions('hey @Ann Agent and @Ann, @all', ['Ann', 'Ann Agent']);
  assert.deepEqual(parts, [{ text: 'hey ', mention: false }, { text: '@Ann Agent', mention: true }, { text: ' and ', mention: false }, { text: '@Ann', mention: true }, { text: ', ', mention: false }, { text: '@all', mention: true }]);
});
test('insertMention replaces the query with the name and a trailing space', () => {
  assert.deepEqual(insertMention('hello @An there', 6, 9, 'Ann Agent'), { text: 'hello @Ann Agent  there', caret: 17 });
});
import { mentionItems } from '../src/lib/mentions.ts';
test('mentionItems: @all/@channel first when they match, then up to six people, case-insensitive', () => {
  const members = [{ id: 1, fullName: 'Ann Agent' }, { id: 2, fullName: 'Bob Sales' }, { id: 3, fullName: 'Alan Turing' }];
  assert.deepEqual(mentionItems(members, 'a').map((i) => i.label), ['all', 'Ann Agent', 'Alan Turing']);
  assert.deepEqual(mentionItems(members, 'ch').map((i) => i.label), ['channel']);
  assert.deepEqual(mentionItems(members, 'zzz'), []);
  assert.equal(mentionItems(Array.from({ length: 10 }, (_, i) => ({ id: i, fullName: `Person ${i}` })), 'person').length, 6);
});
