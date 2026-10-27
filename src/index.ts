#!/usr/bin/env node

/**
 * Banner MCP Server entry point.
 *
 * Loads and validates configuration, then starts the selected transport
 * (stdio or HTTP). Exits non-zero with a one-line message on bad config.
 */

import { ConfigError, getConfig } from './config.js';
import { setAuditEnabled } from './audit.js';
import { log, setLogLevel } from './log.js';
import { startStdioTransport } from './transport/stdio.js';
import { startHttpTransport } from './transport/http.js';

async function main() {
  let config;
  try {
    config = getConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${err.message}\n`);
      process.exit(2);
    }
    throw err;
  }
  setAuditEnabled(config.auditLog);
  setLogLevel(config.logLevel);

  let shutdown: () => Promise<void>;
  if (config.transport === 'stdio') {
    const mcp = await startStdioTransport(config);
    shutdown = () => mcp.server.close();
  } else {
    const app = await startHttpTransport(config);
    shutdown = () => app.close();
  }

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    log('info', 'Shutting down Banner MCP Server...');
    shutdown()
      .catch(() => undefined)
      .finally(() => process.exit(0));
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err: unknown) => {
  process.stderr.write(
    `Failed to start Banner MCP Server: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
