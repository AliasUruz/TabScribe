import test from 'node:test';
import assert from 'node:assert/strict';
import { createMCPBridge, observeMCPPreference } from '../../src/background/mcp-bridge.mjs';

function setup(onCommand = async () => ({ ok: true })) {
  const sockets = [];
  const pending = new Map();
  let nextId = 0;
  const timers = {
    setTimeout(fn, delay) { const id = ++nextId; pending.set(id, { fn, delay }); return id; },
    clearTimeout(id) { pending.delete(id); },
    setInterval(fn, delay) { const id = ++nextId; pending.set(id, { fn, delay, repeat: true }); return id; },
    clearInterval(id) { pending.delete(id); }
  };
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    closed = false;
    constructor(url) { this.url = url; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    open() { this.readyState = Socket.OPEN; this.onopen(); }
    close() { this.closed = true; this.readyState = 3; this.onclose(); }
    message(message) { return this.onmessage({ data: JSON.stringify(message) }); }
  }
  const errors = [];
  const bridge = createMCPBridge({ Socket, timers, onCommand, onError: error => errors.push(error) });
  function tick() {
    assert.equal(pending.size, 1);
    const [id, task] = pending.entries().next().value;
    if (!task.repeat) pending.delete(id);
    task.fn();
    return task.delay;
  }
  return { bridge, sockets, pending, errors, tick };
}

test('normal extension use never connects to an absent optional server', () => {
  const { bridge, sockets, pending } = setup();
  bridge.setEnabled(false);
  assert.equal(sockets.length, 0);
  assert.equal(pending.size, 0);
});

test('opt-in connects once, keeps alive and stops immediately when disabled', () => {
  const { bridge, sockets, pending, tick } = setup();
  bridge.setEnabled(true);
  bridge.setEnabled(true);
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].url, 'ws://127.0.0.1:3031');
  sockets[0].open();
  assert.equal(tick(), 25000);
  assert.deepEqual(sockets[0].sent, [{ type: 'PING' }]);
  bridge.setEnabled(false);
  assert.equal(sockets[0].closed, true);
  assert.equal(pending.size, 0);
});

test('reconnect backs off and disabling cancels all scheduled attempts', () => {
  const { bridge, sockets, pending, errors, tick } = setup();
  bridge.setEnabled(true);
  sockets[0].onerror();
  sockets[0].close();
  assert.equal(tick(), 5000);
  sockets[1].close();
  assert.equal(tick(), 10000);
  sockets[2].close();
  bridge.setEnabled(false);
  assert.equal(pending.size, 0);
  assert.deepEqual(errors, []);
  bridge.setEnabled(true);
  sockets[3].close();
  assert.equal(tick(), 5000);
});

test('late events from a disabled connection cannot revive it', () => {
  const { bridge, sockets, pending } = setup();
  bridge.setEnabled(true);
  const old = sockets[0];
  bridge.setEnabled(false);
  bridge.setEnabled(true);
  sockets[1].open();
  old.onopen();
  old.onclose();
  assert.equal(sockets.length, 2);
  assert.equal(pending.size, 1);
  bridge.setEnabled(false);
  assert.equal(pending.size, 0);
});

test('commands preserve request IDs and return payloads on the same connection', async () => {
  const { bridge, sockets } = setup(async message => ({ url: message.payload.url }));
  bridge.setEnabled(true);
  sockets[0].open();
  await sockets[0].message({ type: 'COMMAND', command: 'EXTRACT_YOUTUBE', requestId: 'request-1', payload: { url: 'video' } });
  assert.deepEqual(sockets[0].sent, [{ type: 'RESPONSE', requestId: 'request-1', payload: { url: 'video' } }]);
});

test('a delayed response cannot leak into a replacement connection', async () => {
  let finish;
  const { bridge, sockets } = setup(() => new Promise(resolve => { finish = resolve; }));
  bridge.setEnabled(true);
  sockets[0].open();
  const response = sockets[0].message({ type: 'COMMAND', requestId: 'old' });
  bridge.setEnabled(false);
  bridge.setEnabled(true);
  sockets[1].open();
  finish({ ok: true });
  await response;
  assert.deepEqual(sockets.map(socket => socket.sent), [[], []]);
});

test('asynchronous command errors are handled instead of becoming unhandled rejections', async () => {
  const { bridge, sockets, errors } = setup(async () => { throw new Error('command failed'); });
  bridge.setEnabled(true);
  sockets[0].open();
  await sockets[0].message({ type: 'COMMAND' });
  await sockets[0].onmessage({ data: 'invalid JSON' });
  assert.equal(errors.length, 2);
  assert.equal(errors[0].message, 'command failed');
});

test('stored opt-in persists; missing preference defaults off; newer choice wins startup race', () => {
  for (const saved of [undefined, true, false]) {
    const values = [];
    let listener;
    let completeRead;
    const storage = {
      onChanged: { addListener(fn) { listener = fn; } },
      local: { get(defaults, fn) { assert.equal(defaults.mcpBridgeEnabled, false); completeRead = fn; } }
    };
    observeMCPPreference(storage, { setEnabled: value => values.push(value) });
    completeRead({ mcpBridgeEnabled: saved });
    assert.deepEqual(values, [saved === true]);
    listener({ mcpBridgeEnabled: { newValue: true } }, 'sync');
    assert.equal(values.length, 1);
    listener({ mcpBridgeEnabled: { newValue: false } }, 'local');
    completeRead({ mcpBridgeEnabled: true });
    assert.deepEqual(values, [saved === true, false]);
  }
});

test('missing heartbeat acknowledgement closes and reconnects a stalled connection', () => {
  const { bridge, sockets, tick } = setup();
  bridge.setEnabled(true);
  sockets[0].open();
  tick();
  tick();
  assert.equal(sockets[0].closed, true);
  assert.equal(tick(), 5000);
  assert.equal(sockets.length, 2);
});

test('PONG keeps a healthy connection alive; saving another port replaces it', async () => {
  const { bridge, sockets, tick } = setup();
  bridge.setEnabled(true);
  sockets[0].open();
  tick();
  await sockets[0].message({ type: 'PONG' });
  tick();
  assert.equal(sockets[0].closed, false);
  bridge.setPort(4040);
  assert.equal(sockets[0].closed, true);
  assert.equal(sockets[1].url, 'ws://127.0.0.1:4040');
  bridge.setPort(80);
  assert.equal(sockets.length, 2);
});

test('an enable change during startup preserves the saved custom port', () => {
  let changed;
  let read;
  const values = [];
  observeMCPPreference({
    onChanged: { addListener(fn) { changed = fn; } },
    local: { get(defaults, fn) { read = fn; } }
  }, { setPort: value => values.push(value), setEnabled: value => values.push(value) });
  changed({ mcpBridgeEnabled: { newValue: true } }, 'local');
  read({ mcpBridgeEnabled: false, mcpBridgePort: 4040 });
  assert.deepEqual(values, [4040, true]);
});
