const { randomUUID } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

function createBridge({ port = 3031, timeoutMs = 60000 } = {}) {
  let socket = null;
  const pending = new Map();
  const wss = new WebSocketServer({ host: '127.0.0.1', port, maxPayload: 16 * 1024 * 1024 });
  const ready = new Promise((resolve, reject) => {
    wss.once('listening', resolve);
    wss.once('error', reject);
  });
  // Keep runtime server errors handled after the startup promise has settled.
  wss.on('error', error => console.error('[TabScribe MCP]', error.message));

  function failPending(owner, error) {
    for (const [id, task] of pending) {
      if (task.socket !== owner) continue;
      clearTimeout(task.timer);
      pending.delete(id);
      task.reject(new Error(error));
    }
  }

  wss.on('connection', (current, request) => {
    // A website must not be able to impersonate the local extension.
    const origin = request.headers.origin;
    if (!origin?.startsWith('chrome-extension://')) {
      current.close(1008, 'Extension origin required');
      return;
    }
    const previous = socket;
    socket = current;
    if (previous) {
      failPending(previous, 'Extension connection replaced; request was not retried.');
      previous.close(1000, 'Replaced');
    }
    current.alive = true;
    current.on('pong', () => { current.alive = true; });
    current.on('error', () => {});
    current.on('message', raw => {
      if (socket !== current) return;
      try {
        const message = JSON.parse(raw.toString());
        current.alive = true;
        if (message.type === 'PING') current.send(JSON.stringify({ type: 'PONG' }));
        if (message.type !== 'RESPONSE') return;
        const task = pending.get(message.requestId);
        if (!task || task.socket !== current) return;
        pending.delete(message.requestId);
        clearTimeout(task.timer);
        task.resolve(message.payload);
      } catch {
        current.close(1007, 'Invalid message');
      }
    });
    current.on('close', () => {
      failPending(current, 'Extension disconnected; request was not retried.');
      if (socket === current) socket = null;
    });
  });

  const heartbeat = setInterval(() => {
    if (!socket) return;
    if (!socket.alive) { socket.terminate(); return; }
    socket.alive = false;
    socket.ping();
  }, 30000);
  heartbeat.unref();

  return {
    ready,
    status: () => ({ connected: socket?.readyState === WebSocket.OPEN, pendingRequests: pending.size, port: wss.address()?.port ?? port }),
    request(command, payload = {}, options = {}) {
      const current = socket;
      if (current?.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error('Extension disconnected. Enable MCP in the TabScribe popup and check the configured port.'));
      }
      const requestId = randomUUID();
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error('Extension response timed out. Execution may have started; check status before retrying.'));
        }, options.timeoutMs ?? timeoutMs);
        pending.set(requestId, { resolve, reject, timer, socket: current });
        current.send(JSON.stringify({ type: 'COMMAND', command, requestId, payload }), error => {
          if (!error || !pending.has(requestId)) return;
          clearTimeout(timer);
          pending.delete(requestId);
          reject(error);
        });
      });
    },
    async close() {
      clearInterval(heartbeat);
      for (const current of wss.clients) {
        failPending(current, 'MCP bridge shutting down.');
        current.terminate();
      }
      await new Promise(resolve => wss.close(resolve));
    }
  };
}

module.exports = { createBridge };
