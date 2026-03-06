/**
 * Student domain module.
 *
 * Registers all student-related MCP tools with the server.
 * This module is lazy-loaded by the domain registry when
 * the "student" domain is requested.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStudentTools } from './tools.js';

/** Registers student domain tools with the MCP server. */
export function register(server: McpServer): void {
  registerStudentTools(server);
}
