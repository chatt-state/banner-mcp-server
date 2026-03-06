#!/usr/bin/env node

/**
 * Banner MCP Server
 *
 * Entry point for the MCP server that provides access to
 * Ellucian Banner via the Ethos Integration and native REST APIs.
 * Loads configuration, registers tools, pre-loads configured domains,
 * and starts the selected transport (stdio or HTTP).
 */

import { getConfig } from './config.js';
import { mcpServer } from './server.js';
import { domainRegistry, type DomainName, DOMAIN_NAMES } from './domains/registry.js';
import { startStdioTransport } from './transport/stdio.js';
import { startHttpTransport } from './transport/http.js';

/**
 * Checks whether a string is a valid DomainName.
 */
function isValidDomain(value: string): value is DomainName {
  return (DOMAIN_NAMES as readonly string[]).includes(value);
}

async function main() {
  const config = getConfig();

  // Wire up the domain registry with the server reference
  domainRegistry.setServer(mcpServer);

  // Pre-load configured domains
  for (const domain of config.preloadDomains) {
    if (isValidDomain(domain)) {
      try {
        await domainRegistry.loadDomain(domain);
        console.error(`Pre-loaded domain: ${domain}`);
      } catch (err) {
        console.error(`Failed to pre-load domain "${domain}":`, err);
      }
    } else {
      console.error(`Skipping unknown domain in preloadDomains: "${domain}"`);
    }
  }

  // Start the selected transport
  if (config.transport === 'stdio') {
    await startStdioTransport();
  } else {
    await startHttpTransport();
  }

  // Graceful shutdown
  const shutdown = async () => {
    console.error('Shutting down Banner MCP Server...');
    await mcpServer.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err: unknown) => {
  console.error('Failed to start Banner MCP Server:', err);
  process.exit(1);
});
