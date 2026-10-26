// Executes the real search orchestrator with browser APIs simulated, never Edge.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';

async function setup() {
  const state = {};
  const tabs = new Map();
  const pending = new Map();
  const downloads = [];
  let nextId = 0;
  let maximumTabs = 0;
  const chrome = {
    storage: { local: {
      async get(key) { return typeof key === 'string' ? { [key]: state[key] } : { ...key, ...state }; },
      async set(value) { Object.assign(state, value); },
      async remove(key) { delete state[key]; }
    } },
    windows: {
      async create() { return { id: 1 }; }, async remove() {},
      onRemoved: { addListener() {}, removeListener() {} }
    },
    tabs: {
      async create(options) {
        const tab = { id: ++nextId, status: 'complete', url: options.url };
        tabs.set(tab.id, tab);
        maximumTabs = Math.max(maximumTabs, tabs.size);
        return tab;
      },
      async get(id) { if (!tabs.has(id)) throw new Error('Tab closed'); return tabs.get(id); },
      async remove(id) { tabs.delete(id); pending.get(id)?.reject(new Error('Tab closed')); pending.delete(id); }
    },
    scripting: { executeScript: ({ target }) => new Promise((resolve, reject) => {
      pending.set(target.tabId, { resolve: content => { pending.delete(target.tabId); resolve([{ result: { content, citations: [], isTimeout: false } }]); }, reject });
    }) },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    downloads: { async download(options) { downloads.push(options); return 1; } }
  };
  const context = vm.createContext({ chrome, console, URL, crypto: webcrypto,
    setTimeout: fn => setTimeout(fn, 0), clearTimeout });
  const cache = new Map();
  async function load(url) {
    if (cache.has(url.href)) return cache.get(url.href);
    let module;
    if (url.pathname.endsWith('/shared/logger.js')) {
      module = new vm.SyntheticModule(['log', 'clearLogs'], function () {
        this.setExport('log', async () => {}); this.setExport('clearLogs', async () => {});
      }, { context });
    } else if (url.pathname.endsWith('/extractors/yt-extractor.js')) {
      module = new vm.SyntheticModule(['isYouTubeWatch', 'extractYouTubeContent'], function () {
        this.setExport('isYouTubeWatch', () => false); this.setExport('extractYouTubeContent', async () => '');
      }, { context });
    } else {
      module = new vm.SourceTextModule(await readFile(url, 'utf8'), { context, identifier: url.href });
    }
    cache.set(url.href, module);
    await module.link((specifier, referencing) => load(new URL(specifier, referencing.identifier)));
    return module;
  }
  const module = await load(new URL('../../src/background/auto-search.js', import.meta.url));
  await module.evaluate();
  async function waitForCount(count) {
    for (let attempt = 0; attempt < 100 && pending.size !== count; attempt++) await new Promise(resolve => setTimeout(resolve, 2));
    assert.equal(pending.size, count, JSON.stringify(state));
  }
  return { api: module.namespace, state, pending, downloads, tabs, waitForCount, get maximumTabs() { return maximumTabs; } };
}

test('real orchestrator opens independent AI tabs, limits overlap, emits XML and cleans up', async () => {
  const f = await setup();
  const run = f.api.runAutoSearch(['first', 'second', 'third'], { engine: 'google', aiOverviewOnly: true, aiConcurrency: 2, jobId: 'job-test' }, async () => []);
  await f.waitForCount(2);
  assert.equal(f.api.isSearchActive(), true);
  await assert.rejects(f.api.runAutoSearch(['other'], {}), /already active/);
  const ids = [...f.pending.keys()];
  f.pending.get(ids[1]).resolve('Second response & sources');
  await f.waitForCount(2);
  const third = [...f.pending.keys()].find(id => id !== ids[0]);
  f.pending.get(third).resolve('Third response');
  f.pending.get(ids[0]).resolve('First response');
  await run;
  assert.equal(f.maximumTabs, 2);
  assert.equal(f.tabs.size, 0);
  assert.equal(f.api.isSearchActive(), false);
  assert.equal(f.state.autoSearch.status, 'completed');
  assert.equal(f.state.autoSearch.jobId, 'job-test');
  assert.equal(f.state.lastSearchResult.format, 'xml');
  const xml = f.state.lastSearchResult.content;
  assert.ok(xml.indexOf('<text>first</text>') < xml.indexOf('<text>second</text>'));
  assert.ok(xml.includes('Second response &amp; sources'));
  assert.equal(f.downloads.length, 1);
  assert.ok(f.downloads[0].filename.endsWith('.txt'));
});

test('cancellation closes active AI tabs and prevents queued queries from opening', async () => {
  const f = await setup();
  const run = f.api.runAutoSearch(['first', 'second', 'third'], { engine: 'google', aiOverviewOnly: true, aiConcurrency: 1 }, async () => []);
  await f.waitForCount(1);
  f.api.requestCancel();
  await run;
  assert.equal(f.maximumTabs, 1);
  assert.equal(f.tabs.size, 0);
  assert.equal(f.state.autoSearch.status, 'cancelled');
  assert.equal(f.downloads.length, 0);
});
