import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Print configuration only. Never mutate the host's configuration or permissions.
const root = fileURLToPath(new URL('../', import.meta.url));
const quote = value => JSON.stringify(value);
process.stdout.write(`[mcp_servers.tabscribe]
command = ${quote(process.execPath)}
args = [${quote(path.join(root, 'server', 'tabscribe-mcp.js'))}]
cwd = ${quote(root)}
startup_timeout_sec = 15
tool_timeout_sec = 90
enabled = true

[mcp_servers.tabscribe.env]
TABSCRIBE_WS_PORT = "3031"
TABSCRIBE_REQUEST_TIMEOUT_MS = "60000"
`);
