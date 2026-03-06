/**
 * HTTP/SSE transport for MCP communication.
 *
 * Implements the HTTP with Server-Sent Events transport layer
 * for remote MCP server deployments using the Streamable HTTP protocol.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { mcpServer } from '../server.js';
import { getConfig } from '../config.js';

/**
 * Starts the MCP server using the Streamable HTTP transport.
 *
 * Creates a Node.js HTTP server that delegates MCP protocol handling
 * to `StreamableHTTPServerTransport`. Supports POST, GET, and DELETE
 * on the `/mcp` endpoint.
 */
export async function startHttpTransport(): Promise<void> {
  const config = getConfig();

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await mcpServer.connect(transport);

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

    if (url.pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    const method = req.method?.toUpperCase();
    if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
      return;
    }

    // Delegate to the SDK transport handler
    void transport.handleRequest(req, res);
  });

  httpServer.listen(config.httpPort, config.httpHost, () => {
    console.error(
      `Banner MCP Server running on http://${config.httpHost}:${config.httpPort}/mcp`,
    );
  });
}
