// The tab title and icon badge: a number for mentions and direct messages, a dot for other unread channels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tabBadge, tabTitle } from '../src/utils/tabTitle.ts';

const ch = (over: Record<string, unknown>) => ({ type: 'public', unreadCount: 0, mentionCount: 0, ...over }) as any;

test('nothing waiting: the plain title', () => {
  assert.deepEqual(tabBadge([ch({}), ch({ type: 'dm' })]), { count: 0, dot: false });
  assert.equal(tabTitle({ count: 0, dot: false }, 'Chat'), 'Chat');
});

test('unread channel messages that do not mention you: a dot', () => {
  assert.deepEqual(tabBadge([ch({ unreadCount: 7 })]), { count: 0, dot: true });
  assert.equal(tabTitle({ count: 0, dot: true }, 'Chat'), '• Chat');
});

test('mentions and unread direct messages count; a mentioned channel with other unread messages adds a dot too', () => {
  const badge = tabBadge([
    ch({ unreadCount: 5, mentionCount: 2 }), // two mentions among five unread
    ch({ type: 'dm', unreadCount: 3 }), // three unread direct messages
    ch({ type: 'dm', unreadCount: 1, mentionCount: 1 }), // counted once
  ]);
  assert.deepEqual(badge, { count: 6, dot: true });
  assert.equal(tabTitle(badge, 'Chat'), '(6) Chat');
  assert.deepEqual(
    tabBadge([ch({ unreadCount: 2, mentionCount: 2 })]),
    { count: 2, dot: false },
    'all unread are mentions: no dot',
  );
});
