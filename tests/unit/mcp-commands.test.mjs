import test from 'node:test';
import assert from 'node:assert/strict';
import { createMCPCommands } from '../../src/background/mcp-commands.mjs';

function setup({ active = false } = {}) {
  let extracted = 0;
  let cancelled = false;
  let started = null;
  const handler = createMCPCommands({
    browser: {
      windows: { getLastFocused: async () => ({ tabs: [{ id: 1, url: 'https://example.com', title: 'Page' }, { id: 2, url: 'edge://settings' }] }) },
      tabs: { get: async id => ({ id, url: id === 2 ? 'edge://settings' : 'https://example.com' }) },
      storage: { local: { get: async () => ({ lastSearchResult: { content: 'abcdefgh', jobId: 'job-1', format: 'text' } }) } }
    },
    search: { isActive: () => active, run: async (queries, config) => { started = { queries, config }; }, status: async () => ({ status: 'running' }), cancel: () => { cancelled = true; } },
    extractTabs: async () => { extracted++; return [{ content: 'a'.repeat(500) }]; },
    extractYouTube: async () => 'transcript'
  });
  return { call: (command, payload) => handler({ command, payload }), get extracted() { return extracted; }, get started() { return started; }, get cancelled() { return cancelled; } };
}

test('tab listing excludes browser pages; extraction refuses restricted tab URLs', async () => {
  const f = setup();
  assert.deepEqual(await f.call('LIST_TABS'), [{ id: 1, title: 'Page', url: 'https://example.com' }]);
  await assert.rejects(f.call('EXTRACT_TABS', { tabIds: [2] }), /HTTP/);
});

test('extraction pagination reuses a snapshot instead of reinjecting on every page', async () => {
  const f = setup();
  const first = await f.call('EXTRACT_TABS', { tabIds: [1], limit: 10 });
  const second = await f.call('EXTRACT_TABS', { tabIds: [1], offset: 10, limit: 10 });
  assert.equal(first.nextOffset, 10);
  assert.equal(second.offset, 10);
  assert.equal(first.capturedAt, second.capturedAt);
  assert.equal(f.extracted, 1);
});

test('search acknowledgement keeps job ID; concurrent search is rejected', async () => {
  const f = setup();
  const result = await f.call('AUTO_SEARCH', { queries: ['test'], config: {}, jobId: 'job-new' });
  assert.equal(result.status, 'accepted');
  assert.equal(f.started.config.jobId, 'job-new');
  await assert.rejects(setup({ active: true }).call('AUTO_SEARCH', {}), /already active/);
  await f.call('CANCEL_SEARCH');
  assert.equal(f.cancelled, true);
  assert.deepEqual(await f.call('SEARCH_STATUS'), { status: 'running' });
});

test('saved result includes job identity and explicit pagination bounds', async () => {
  const f = setup();
  assert.deepEqual(await f.call('SEARCH_RESULT', { offset: 2, limit: 3 }), {
    jobId: 'job-1', format: 'text', text: 'cde', offset: 2, nextOffset: 5, totalChars: 8
  });
});
