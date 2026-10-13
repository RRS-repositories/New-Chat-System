// Search and Documents belong to each conversation, not to the sidebar.
//
// The owner, 13 Oct 2026, pointing at the two sidebar buttons: "man remove this from here
// — i said in every channel/DM keep a search (any earlier message) and document (the
// document should not be searchable - just list of documents simple)."
//
// There is no DOM here, so these read the source. That is weaker than rendering, but it
// holds the three things that were actually asked for and that would otherwise drift back:
// the sidebar stays clear, every conversation header carries both buttons, and the
// documents list has no search in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const SIDEBAR = read('../src/components/layout/Sidebar.tsx');
const SHELL = read('../src/components/layout/AppShell.tsx');
const HEADER = read('../src/components/channel/ChannelHeader.tsx');
const DOCS = read('../src/components/channel/ChannelDocumentsPanel.tsx');
const PAGE = read('../src/pages/ChatPage.tsx');

test('the sidebar no longer offers Search or Documents', () => {
  assert.ok(!SIDEBAR.includes('s-search'), 'the search block is still in the sidebar');
  assert.ok(!/onSearch|onDocuments/.test(SIDEBAR), 'the sidebar still takes those handlers');
  assert.ok(!/>Documents</.test(SIDEBAR), 'a Documents button is still in the sidebar');
  assert.ok(!/Ctrl K/.test(SIDEBAR), 'the shortcut hint belonged to the removed button');
});

test('every conversation header carries both buttons', () => {
  // `channel &&` is the only condition on either, so a DM gets them exactly as a channel does.
  for (const id of ['channel-search', 'channel-documents']) {
    assert.ok(HEADER.includes(`data-testid="${id}"`), `${id} is missing from the header`);
  }
  for (const [id, handler] of [
    ['channel-search', 'onOpenSearch'],
    ['channel-documents', 'onOpenDocuments'],
  ]) {
    const guard = HEADER.slice(0, HEADER.indexOf(`data-testid="${id}"`)).lastIndexOf(`{channel && ${handler} && (`);
    assert.ok(guard > 0, `${id} should be shown for any conversation, not only some types`);
  }
  assert.ok(!/isDm[^\n]*onOpenSearch|onOpenSearch[^\n]*isDm/.test(HEADER), 'search must not be limited to channels');
});

test('the conversation search starts on that conversation', () => {
  // Otherwise the header button would quietly search everything, which is the sidebar
  // button under a different name.
  assert.match(PAGE, /scopeToChannel/, 'ChatPage must open search scoped to the open conversation');
  const search = read('../src/components/channel/SearchPanel.tsx');
  assert.match(
    search,
    /useState\(scopeToChannel && Boolean\(currentChannelId\)\)/,
    'the "this channel only" box should start ticked when opened from a conversation',
  );
});

test('the documents list has no search in it, as asked', () => {
  assert.ok(!/<input/.test(DOCS), 'a text box has appeared in the documents list');
  assert.ok(!/\bq\b\s*[:=]|query/.test(DOCS), 'the documents list must not take a search term');
  assert.ok(!/placeholder/.test(DOCS), 'no search box, so no placeholder');
});

test('the documents list asks only for the open conversation', () => {
  assert.match(DOCS, /actions\.loadChannelFiles\(channelId/, 'it must ask for this channel, not for everything');
  assert.ok(!/loadAllFiles/.test(DOCS), 'the every-channel listing is gone');
});

test('changing conversation clears the list before it loads the new one', () => {
  // Without this the previous conversation's documents sit there while the new ones load,
  // which reads as "these are this channel's files" and is wrong.
  const effect = DOCS.slice(DOCS.indexOf('useEffect(() => {'));
  assert.match(effect, /setFiles\(\[\]\)/);
  assert.match(effect, /\}, \[channelId\]\)/);
});

test('the every-channel documents screen is gone from the app', () => {
  assert.ok(!/DocumentsPanel/.test(SHELL.replace(/ChannelDocumentsPanel/g, '')), 'still mounted in AppShell');
  assert.ok(!/'documents'/.test(SHELL), 'still a dialog in AppShell');
  const api = read('../src/services/chatApi.ts');
  assert.ok(!/allFiles/.test(api), 'the browser can still ask for every file at once');
});
