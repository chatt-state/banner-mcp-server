/**
 * Ethos domain module.
 *
 * Provides raw Ethos proxy CRUD tools and change notification
 * consumption. Useful for accessing any EEDM resource by name
 * without a domain-specific wrapper.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerEthosTools } from './tools.js';

/** Registers ethos domain tools with the MCP server. */
export function register(server: McpServer): void {
  registerEthosTools(server);
}
