/**
 * Stdio transport for MCP communication.
 *
 * The server reads JSON-RPC messages from stdin and writes responses to
 * stdout. Diagnostics and audit lines go to stderr.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import type { BannerMcpConfig } from '../config.js';
import { log } from '../log.js';
import { createBannerMcpServer, type BannerMcpServer } from '../server.js';

/** Starts a single MCP server on stdio. */
export async function startStdioTransport(config: BannerMcpConfig): Promise<BannerMcpServer> {
  const mcp = createBannerMcpServer(config);
  await mcp.server.connect(new StdioServerTransport());
  const domains = mcp.registry.getLoadedDomains().join(', ') || 'none';
  log(
    'info',
    `Banner MCP Server running on stdio (domains: ${domains}; writes ${config.allowWrites ? 'ENABLED' : 'disabled'})`,
  );
  return mcp;
}
