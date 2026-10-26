// Optional local bridge. Importing this module never opens a connection.
export function createMCPBridge({
  onCommand,
  Socket = WebSocket,
  timers = globalThis,
  onError = (error) => console.error('[TabScribe MCP] Invalid command:', error),
  onStatus = () => {}
}) {
  let enabled = false;
  let socket = null;
  let reconnect = null;
  let heartbeat = null;
  let retryDelay = 5000;
  let port = 3031;
  let connectionTimeout = null;
  let awaitingPong = false;
  const report = (state, retryMs = null) => onStatus({ state, url: `ws://127.0.0.1:${port}`, retryMs, updatedAt: Date.now() });

  function clearConnectionTimeout() {
    if (connectionTimeout !== null) timers.clearTimeout(connectionTimeout);
    connectionTimeout = null;
  }

  function clearHeartbeat() {
    if (heartbeat !== null) timers.clearInterval(heartbeat);
    heartbeat = null;
  }

  function scheduleReconnect() {
    if (!enabled || reconnect !== null) return;
    report('reconnecting', retryDelay);
    reconnect = timers.setTimeout(() => {
      reconnect = null;
      connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  }

  function connect() {
    if (!enabled || socket !== null) return;
    let current;
    try {
      report('connecting');
      current = new Socket(`ws://127.0.0.1:${port}`);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = current;
    const isCurrent = () => enabled && socket === current;
    connectionTimeout = timers.setTimeout(() => {
      if (isCurrent()) current.close();
    }, 10000);

    current.onopen = () => {
      if (!isCurrent()) return;
      clearConnectionTimeout();
      awaitingPong = false;
      report('connected');
      retryDelay = 5000;
      clearHeartbeat();
      heartbeat = timers.setInterval(() => {
        if (isCurrent() && current.readyState === Socket.OPEN) {
          if (awaitingPong) { current.close(); return; }
          awaitingPong = true;
          current.send(JSON.stringify({ type: 'PING' }));
        }
      }, 25000);
    };
    current.onmessage = async (event) => {
      if (!isCurrent()) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'PONG') { awaitingPong = false; return; }
        if (message.type !== 'COMMAND') return;
        const payload = await onCommand(message);
        // A response belongs to the connection that received the request.
        if (isCurrent() && current.readyState === Socket.OPEN) {
          current.send(JSON.stringify({ type: 'RESPONSE', requestId: message.requestId, payload }));
        }
      } catch (error) {
        onError(error);
        if (isCurrent() && current.readyState === Socket.OPEN) {
          let requestId;
          try { requestId = JSON.parse(event.data).requestId; } catch {}
          if (requestId) current.send(JSON.stringify({ type: 'RESPONSE', requestId, payload: { error: error.message } }));
        }
      }
    };
    current.onclose = () => {
      if (!isCurrent()) return;
      socket = null;
      clearConnectionTimeout();
      clearHeartbeat();
      scheduleReconnect();
    };
    // An unavailable optional server is handled by close/reconnect, not an app error.
    current.onerror = () => {};
  }

  return {
    setPort(value) {
      const nextPort = Number(value);
      if (!Number.isInteger(nextPort) || nextPort < 1024 || nextPort > 65535 || nextPort === port) return;
      const wasEnabled = enabled;
      this.setEnabled(false);
      port = nextPort;
      this.setEnabled(wasEnabled);
    },
    setEnabled(value) {
      enabled = value === true;
      if (enabled) {
        if (reconnect === null) connect();
        return;
      }
      if (reconnect !== null) timers.clearTimeout(reconnect);
      reconnect = null;
      clearConnectionTimeout();
      clearHeartbeat();
      retryDelay = 5000;
      const previous = socket;
      socket = null;
      if (previous) previous.close();
      report('disabled');
    }
  };
}

export function observeMCPPreference(storage, bridge) {
  let initialized = false;
  const overrides = {};
  let preferences = { mcpBridgeEnabled: false, mcpBridgePort: 3031 };
  function apply() {
    bridge.setPort?.(preferences.mcpBridgePort);
    bridge.setEnabled(preferences.mcpBridgeEnabled === true);
  }
  storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !['mcpBridgeEnabled', 'mcpBridgePort'].some(key => Object.hasOwn(changes, key))) return;
    for (const key of ['mcpBridgeEnabled', 'mcpBridgePort']) {
      if (Object.hasOwn(changes, key)) overrides[key] = changes[key].newValue ?? (key === 'mcpBridgePort' ? 3031 : false);
    }
    preferences = { ...preferences, ...overrides };
    if (initialized) apply();
  });
  storage.local.get(preferences, (data) => {
    // Do not let a stale startup read override a newer user choice.
    if (initialized) return;
    initialized = true;
    preferences = { ...data, ...overrides };
    apply();
  });
}
