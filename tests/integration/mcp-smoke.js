const assert = require('node:assert/strict');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { WebSocket } = require('ws');
const net = require('node:net');
const { once } = require('node:events');

async function unusedPort() {
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  return port;
}

// Verify the MCP contract without opening tabs or starting a search.
async function main() {
  const root = path.resolve(__dirname, '../..');
  const legacy = process.argv.includes('--legacy');
  const entry = legacy ? 'tabscribe-mcp.js' : 'server/tabscribe-mcp.js';
  const port = await unusedPort();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, entry)],
    stderr: 'pipe',
    env: { ...process.env, TABSCRIBE_WS_PORT: String(port) },
  });
  const client = new Client({ name: 'tabscribe-smoke', version: '1.0.0' }, { capabilities: {} });
  const timeout = setTimeout(() => {
    console.error('MCP smoke test timed out.');
    process.exitCode = 1;
    transport.close().catch(() => {});
  }, 15000);
  timeout.unref();
  let extension;

  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const names = new Set(listed.tools.map(tool => tool.name));
    for (const name of ['tabscribe_extract_youtube', 'tabscribe_auto_search', 'tabscribe_status', 'tabscribe_list_tabs', 'tabscribe_extract_tabs', 'tabscribe_search_status', 'tabscribe_cancel_search', 'tabscribe_search_result']) {
      assert.ok(names.has(name), `Missing MCP tool: ${name}`);
    }
    const status = await client.callTool({ name: 'tabscribe_status', arguments: {} });
    assert.ok(!status.isError, 'Status request failed.');
    assert.ok(status.content.some(item => item.type === 'text' && item.text.length > 0));
    assert.equal(JSON.parse(status.content[0].text).connected, false);
    const invalid = await client.callTool({ name: 'tabscribe_extract_tabs', arguments: { tabIds: [] } });
    assert.equal(invalid.isError, true);
    const disconnected = await client.callTool({ name: 'tabscribe_list_tabs', arguments: {} });
    assert.equal(disconnected.isError, true);
    // Simulate ONLY the extension transport, without accessing Edge or browsing data.
    extension = new WebSocket(`ws://127.0.0.1:${port}`, { origin: 'chrome-extension://tabscribe-test' });
    await once(extension, 'open');
    extension.on('message', raw => {
      const message = JSON.parse(raw);
      const payload = message.command === 'LIST_TABS' ? [{ id: 1, title: 'Simulated tab', url: 'https://example.com' }] : { error: 'Simulated command error' };
      extension.send(JSON.stringify({ type: 'RESPONSE', requestId: message.requestId, payload }));
    });
    const connected = await client.callTool({ name: 'tabscribe_status', arguments: {} });
    assert.equal(JSON.parse(connected.content[0].text).connected, true);
    const tabs = await client.callTool({ name: 'tabscribe_list_tabs', arguments: {} });
    assert.equal(JSON.parse(tabs.content[0].text)[0].title, 'Simulated tab');
    const failure = await client.callTool({ name: 'tabscribe_search_status', arguments: {} });
    assert.equal(failure.isError, true);
    console.log(`OK: ${entry}, 8 tools, validation, disconnected status, real MCP/WebSocket request/response and error propagation.`);
    console.log('Extension simulated. No real browser actions or search requested.');
  } finally {
    clearTimeout(timeout);
    extension?.terminate();
    await client.close();
    await transport.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
