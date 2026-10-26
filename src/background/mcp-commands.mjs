// Browser operations are shared with the existing popup/extraction implementation.
export function createMCPCommands({ browser, search, extractTabs, extractYouTube }) {
  let extraction = null;
  function page(content, payload, metadata = {}) {
    const offset = payload.offset ?? 0;
    const limit = Math.min(payload.limit ?? 20000, 50000);
    return { ...metadata, text: content.slice(offset, offset + limit), offset,
      nextOffset: offset + limit < content.length ? offset + limit : null, totalChars: content.length };
  }
  return async ({ command, payload = {} }) => {
    switch (command) {
      case 'LIST_TABS': {
        const window = await browser.windows.getLastFocused({ populate: true });
        return (window.tabs ?? []).filter(tab => /^https?:\/\//.test(tab.url))
          .map(({ id, title, url }) => ({ id, title, url }));
      }
      case 'EXTRACT_TABS': {
        const key = JSON.stringify([payload.tabIds, payload.intelligent !== false]);
        if (!payload.offset || extraction?.key !== key) {
          const tabs = await Promise.all(payload.tabIds.map(id => browser.tabs.get(id)));
          if (tabs.some(tab => !/^https?:\/\//.test(tab.url))) throw new Error('Only HTTP/HTTPS tabs can be extracted.');
          const result = await extractTabs(tabs, payload.intelligent !== false);
          extraction = { key, content: JSON.stringify(result), capturedAt: new Date().toISOString() };
        }
        return page(extraction.content, payload, { capturedAt: extraction.capturedAt, format: 'json' });
      }
      case 'EXTRACT_YOUTUBE': return extractYouTube(payload.url);
      case 'AUTO_SEARCH': {
        if (search.isActive()) throw new Error('A search is already active. Check status or cancel it first.');
        search.run(payload.queries, { ...payload.config, jobId: payload.jobId }, extractTabs)
          .catch(error => console.error('[TabScribe MCP] Search failed:', error));
        return { status: 'accepted', jobId: payload.jobId, next: 'tabscribe_search_status' };
      }
      case 'SEARCH_STATUS': return search.status();
      case 'CANCEL_SEARCH':
        search.cancel();
        return { status: 'cancellation_requested', next: 'tabscribe_search_status' };
      case 'SEARCH_RESULT': {
        const { lastSearchResult } = await browser.storage.local.get('lastSearchResult');
        if (!lastSearchResult) throw new Error('No saved search result. Check search status.');
        const { content, ...metadata } = lastSearchResult;
        return page(content, payload, metadata);
      }
      default: throw new Error('Unknown MCP command: ' + command);
    }
  };
}
