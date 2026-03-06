/**
 * Stdio transport for MCP communication.
 *
 * Implements the standard input/output transport layer used
 * when the server is invoked as a subprocess by an MCP client.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { mcpServer } from '../server.js';

/**
 * Starts the MCP server using stdio transport.
 *
 * The server reads JSON-RPC messages from stdin and writes
 * responses to stdout. Diagnostic output goes to stderr.
 */
export async function startStdioTransport(): Promise<void> {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('Banner MCP Server running on stdio');
}
