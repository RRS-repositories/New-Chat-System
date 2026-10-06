// The tab title and icon badge: one per channel with unread messages, one per unread direct message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabBadge, tabTitle } from '../src/utils/tabTitle.ts';

const ch = (over: Record<string, unknown>) => ({ type: 'public', unreadCount: 0, mentionCount: 0, ...over }) as any;

test('nothing waiting: the plain title', () => {
  assert.deepEqual(tabBadge([ch({}), ch({ type: 'dm' })]), { count: 0 });
  assert.equal(tabTitle({ count: 0 }, 'Chat'), 'Chat');
});

test('a channel counts once however many unread messages it holds, mentions or not', () => {
  assert.deepEqual(tabBadge([ch({ unreadCount: 7 })]), { count: 1 });
  assert.deepEqual(tabBadge([ch({ unreadCount: 5, mentionCount: 2 }), ch({ unreadCount: 1 })]), { count: 2 });
  assert.equal(tabTitle({ count: 2 }, 'Chat'), '(2) Chat');
});

test('every unread direct message counts', () => {
  const badge = tabBadge([
    ch({ unreadCount: 5, mentionCount: 2 }), // one channel
    ch({ type: 'dm', unreadCount: 3 }), // three direct messages
    ch({ type: 'dm', unreadCount: 1, mentionCount: 1 }), // one, not two
  ]);
  assert.deepEqual(badge, { count: 5 });
  assert.equal(tabTitle(badge, 'Chat'), '(5) Chat');
});
