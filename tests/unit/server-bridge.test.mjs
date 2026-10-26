import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { WebSocket } = require('ws');
const { createBridge } = require('../../server/bridge.js');

async function fixture(t) {
  const bridge = createBridge({ port: 0, timeoutMs: 80 });
  await bridge.ready;
  t.after(() => bridge.close());
  async function connect(origin = 'chrome-extension://test-extension') {
    const socket = new WebSocket(`ws://127.0.0.1:${bridge.status().port}`, { origin });
    await once(socket, 'open');
    return socket;
  }
  return { bridge, connect };
}

test('bridge rejects disconnected calls immediately', async t => {
  const { bridge } = await fixture(t);
  await assert.rejects(bridge.request('LIST_TABS'), /disconnected/);
  assert.equal(bridge.status().pendingRequests, 0);
});

test('concurrent requests have unique IDs and out-of-order replies match their callers', async t => {
  const { bridge, connect } = await fixture(t);
  const socket = await connect();
  const messages = [];
  socket.on('message', raw => {
    messages.push(JSON.parse(raw));
    if (messages.length === 3) for (const message of messages.reverse()) {
      socket.send(JSON.stringify({ type: 'RESPONSE', requestId: message.requestId, payload: message.payload }));
    }
  });
  const result = await Promise.all([1, 2, 3].map(id => bridge.request('TEST', { id })));
  assert.deepEqual(result, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(new Set(messages.map(message => message.requestId)).size, 3);
  assert.equal(bridge.status().pendingRequests, 0);
});

test('timeout releases requests without automatically repeating browser operations', async t => {
  const { bridge, connect } = await fixture(t);
  const socket = await connect();
  let count = 0;
  socket.on('message', () => count++);
  await assert.rejects(bridge.request('AUTO_SEARCH'), /timed out/);
  assert.equal(count, 1);
  assert.equal(bridge.status().pendingRequests, 0);
});

test('disconnect rejects in-flight work promptly', async t => {
  const { bridge, connect } = await fixture(t);
  const socket = await connect();
  const result = assert.rejects(bridge.request('TEST'), /disconnected/);
  socket.close();
  await result;
  assert.equal(bridge.status().connected, false);
});

test('replacing a socket cancels old requests without clearing the new connection', async t => {
  const { bridge, connect } = await fixture(t);
  const old = await connect();
  const oldClosed = once(old, 'close');
  const pending = assert.rejects(bridge.request('TEST'), /replaced/);
  const current = await connect();
  await pending;
  await oldClosed;
  assert.equal(bridge.status().connected, true);
  current.on('message', raw => {
    const message = JSON.parse(raw);
    current.send(JSON.stringify({ type: 'RESPONSE', requestId: message.requestId, payload: 'new' }));
  });
  assert.equal(await bridge.request('TEST'), 'new');
});

test('website origins cannot register as an extension', async t => {
  const { bridge, connect } = await fixture(t);
  const socket = await connect('https://example.com');
  const [code] = await once(socket, 'close');
  assert.equal(code, 1008);
  assert.equal(bridge.status().connected, false);
});
