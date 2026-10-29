/**
 * Streamable HTTP transport with bearer-token auth and per-session servers.
 *
 * - GET /healthz: liveness, no auth, no data.
 * - /mcp (POST, GET, DELETE): requires `Authorization: Bearer <BANNER_MCP_HTTP_TOKEN>`,
 *   compared in constant time.
 * - Each MCP session (initialize request without mcp-session-id) gets its own
 *   StreamableHTTPServerTransport and McpServer, keyed by the session ID the
 *   transport generates. Follow-up requests are routed by the mcp-session-id
 *   header. Sessions end on DELETE, on transport close, or after
 *   BANNER_MCP_SESSION_IDLE_MINUTES of inactivity.
 *
 * Follows the stateful pattern of the MCP TypeScript SDK's
 * examples/server/simpleStreamableHttp (SDK 1.32).
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import type { BannerMcpConfig } from '../config.js';
import { auditEvent } from '../audit.js';
import { log } from '../log.js';
import { createBannerMcpServer, type BannerMcpServer } from '../server.js';

/** Maximum accepted JSON-RPC request body, in bytes. */
export const MAX_BODY_BYTES = 1024 * 1024;

interface Session {
  transport: StreamableHTTPServerTransport;
  mcp: BannerMcpServer;
  lastActive: number;
}

export interface HttpApp {
  httpServer: HttpServer;
  /** Live sessions by ID (exposed for tests and status). */
  sessions: Map<string, Session>;
  /** Closes every session and the HTTP server. */
  close(): Promise<void>;
}

export type ServerFactory = () => BannerMcpServer;

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * Constant-time bearer token check. Both sides are hashed first so the
 * comparison does not leak the expected token's length.
 */
export function checkBearer(header: string | undefined, expected: string): boolean {
  if (!header) return false;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return false;
  return timingSafeEqual(sha256(match[1]!), sha256(expected));
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  if (res.headersSent) return;
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function rpcError(res: ServerResponse, status: number, code: number, message: string) {
  sendJson(res, status, { jsonrpc: '2.0', error: { code, message }, id: null });
}

/**
 * An oversized body is read and discarded (not buffered) up to this many
 * bytes so the client finishes sending and can read the 413; beyond it the
 * connection is dropped.
 */
export const MAX_DRAIN_BYTES = 16 * MAX_BODY_BYTES;

class BodyTooLarge extends Error {
  constructor(readonly drained: boolean) {
    super('Request body too large');
  }
}

/**
 * Reads the request body up to `limit` bytes. Over the limit it stops
 * buffering and keeps draining (discarding) the rest, then rejects with
 * BodyTooLarge once the request has ended, so the caller can still send a
 * 413 the client will see. `drained` is false when the body was too large to
 * drain, or Content-Length already announced that; the caller then answers
 * and drops the connection.
 */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const declared = Number(headerValue(req, 'content-length'));
    if (Number.isFinite(declared) && declared > MAX_DRAIN_BYTES) {
      req.pause();
      reject(new BodyTooLarge(false));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = Number.isFinite(declared) && declared > limit;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_DRAIN_BYTES) {
        req.removeAllListeners('data');
        req.removeAllListeners('end');
        req.pause();
        reject(new BodyTooLarge(false));
        return;
      }
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) reject(new BodyTooLarge(true));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

function remote(req: IncomingMessage): string | undefined {
  return req.socket.remoteAddress;
}

/**
 * Builds the HTTP server (not yet listening).
 */
export function createHttpApp(
  config: BannerMcpConfig,
  factory: ServerFactory = () => createBannerMcpServer(config),
): HttpApp {
  const token = config.httpToken;
  if (!token) {
    throw new Error('BANNER_MCP_HTTP_TOKEN is required for the HTTP transport');
  }

  const sessions = new Map<string, Session>();
  const allowedHosts = config.httpAllowedHosts.map((h) => h.toLowerCase());

  const closeSession = async (id: string) => {
    const session = sessions.get(id);
    if (!session) return;
    sessions.delete(id);
    try {
      await session.transport.close();
    } catch {
      /* ignore */
    }
    try {
      await session.mcp.server.close();
    } catch {
      /* ignore */
    }
  };

  const handleMcp = async (req: IncomingMessage, res: ServerResponse, method: string) => {
    const sessionId = headerValue(req, 'mcp-session-id');

    if (method === 'POST') {
      let body: unknown;
      try {
        const raw = await readBody(req, MAX_BODY_BYTES);
        body = JSON.parse(raw);
      } catch (err) {
        if (err instanceof BodyTooLarge) {
          if (!err.drained) {
            // Unread data remains: close the connection once the 413 is flushed.
            res.on('finish', () => req.socket.destroy());
          }
          sendJson(
            res,
            413,
            {
              jsonrpc: '2.0',
              error: { code: -32000, message: `Request body exceeds ${MAX_BODY_BYTES} bytes` },
              id: null,
            },
            { Connection: 'close' },
          );
        } else {
          rpcError(res, 400, -32700, 'Parse error: invalid JSON');
        }
        return;
      }

      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          rpcError(res, 404, -32001, 'Session not found');
          return;
        }
        session.lastActive = Date.now();
        await session.transport.handleRequest(req, res, body);
        return;
      }

      const isInit = Array.isArray(body)
        ? body.some((m) => isInitializeRequest(m))
        : isInitializeRequest(body);
      if (!isInit) {
        rpcError(res, 400, -32000, 'Bad Request: no valid session ID provided');
        return;
      }
      if (sessions.size >= config.maxSessions) {
        rpcError(res, 503, -32000, 'Too many open sessions');
        return;
      }

      const mcp = factory();
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, mcp, lastActive: Date.now() });
          auditEvent('session_open', { sessionId: id, remote: remote(req) });
        },
        onsessionclosed: (id) => {
          auditEvent('session_close', { sessionId: id });
          void closeSession(id);
        },
      });
      transport.onclose = () => {
        const id = transport.sessionId;
        if (id && sessions.has(id)) {
          sessions.delete(id);
          void mcp.server.close().catch(() => undefined);
        }
      };
      await mcp.server.connect(transport);
      await transport.handleRequest(req, res, body);
      return;
    }

    // GET (SSE stream) and DELETE (session termination) need an existing session.
    if (!sessionId) {
      rpcError(res, 400, -32000, 'Bad Request: missing mcp-session-id header');
      return;
    }
    const session = sessions.get(sessionId);
    if (!session) {
      rpcError(res, 404, -32001, 'Session not found');
      return;
    }
    session.lastActive = Date.now();
    await session.transport.handleRequest(req, res);
    if (method === 'DELETE') await closeSession(sessionId);
  };

  const httpServer = createServer((req, res) => {
    const method = (req.method ?? 'GET').toUpperCase();
    let pathname: string;
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    } catch {
      sendJson(res, 400, { error: 'Bad request' });
      return;
    }

    if (pathname === '/healthz') {
      if (method !== 'GET' && method !== 'HEAD') {
        sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, HEAD' });
        return;
      }
      sendJson(res, 200, { status: 'ok' });
      return;
    }

    if (pathname !== '/mcp') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    if (allowedHosts.length > 0) {
      const host = (headerValue(req, 'host') ?? '').toLowerCase();
      if (!allowedHosts.includes(host)) {
        auditEvent('http_host_rejected', { remote: remote(req) });
        sendJson(res, 403, { error: 'Host not allowed' });
        return;
      }
    }

    if (!checkBearer(headerValue(req, 'authorization'), token)) {
      auditEvent('http_auth_rejected', { remote: remote(req), method });
      sendJson(
        res,
        401,
        { error: 'Unauthorized' },
        { 'WWW-Authenticate': 'Bearer realm="banner-mcp-server"' },
      );
      return;
    }

    if (method !== 'POST' && method !== 'GET' && method !== 'DELETE') {
      sendJson(res, 405, { error: 'Method not allowed' }, { Allow: 'GET, POST, DELETE' });
      return;
    }

    handleMcp(req, res, method).catch((err: unknown) => {
      log('error', `HTTP transport error: ${err instanceof Error ? err.message : 'unknown'}`);
      rpcError(res, 500, -32603, 'Internal server error');
    });
  });

  const idleMs = config.sessionIdleMinutes * 60_000;
  const sweeper = setInterval(
    () => {
      const cutoff = Date.now() - idleMs;
      for (const [id, s] of sessions) {
        if (s.lastActive < cutoff) {
          auditEvent('session_expired', { sessionId: id });
          void closeSession(id);
        }
      }
    },
    Math.min(idleMs, 60_000),
  );
  sweeper.unref();

  return {
    httpServer,
    sessions,
    async close() {
      clearInterval(sweeper);
      await Promise.all([...sessions.keys()].map((id) => closeSession(id)));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        httpServer.closeAllConnections?.();
      });
    },
  };
}

/**
 * Starts the HTTP transport and resolves once it is listening.
 */
export async function startHttpTransport(
  config: BannerMcpConfig,
  factory?: ServerFactory,
): Promise<HttpApp> {
  const app = createHttpApp(config, factory);
  await new Promise<void>((resolve, reject) => {
    app.httpServer.once('error', reject);
    app.httpServer.listen(config.httpPort, config.httpHost, () => resolve());
  });
  const addr = app.httpServer.address() as AddressInfo;
  log(
    'info',
    `Banner MCP Server listening on http://${addr.address}:${addr.port}/mcp (health: /healthz)`,
  );
  if (
    config.httpHost !== '127.0.0.1' &&
    config.httpHost !== 'localhost' &&
    config.httpHost !== '::1'
  ) {
    log(
      'warn',
      'Bound to a non-loopback address. Serve only behind TLS (reverse proxy) on a trusted network.',
    );
  }
  return app;
}
