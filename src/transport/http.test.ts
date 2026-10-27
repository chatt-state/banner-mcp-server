import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { checkBearer, createHttpApp, type HttpApp } from './http.js';
import { createBannerMcpServer } from '../server.js';
import { makeConfig, testDeps, TEST_TOKEN } from '../testing/helpers.js';

const config = makeConfig({
  BANNER_MCP_TRANSPORT: 'http',
  BANNER_MCP_HTTP_TOKEN: TEST_TOKEN,
  BANNER_MCP_HTTP_PORT: '3999',
  BANNER_PRELOAD_DOMAINS: 'student',
});

let app: HttpApp;
let base: string;

const ACCEPT = 'application/json, text/event-stream';

function initBody(id: number) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: `client-${id}`, version: '1.0.0' },
    },
  };
}

/** Parses a JSON-RPC response that may arrive as SSE or plain JSON. */
async function rpcBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if ((res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    const dataLine = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .find((l) => l.startsWith('{'));
    return JSON.parse(dataLine ?? '{}') as Record<string, unknown>;
  }
  return JSON.parse(text) as Record<string, unknown>;
}

async function post(body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: ACCEPT,
      Authorization: `Bearer ${TEST_TOKEN}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function openSession(n: number): Promise<string> {
  const res = await post(initBody(n));
  expect(res.status).toBe(200);
  const sid = res.headers.get('mcp-session-id');
  expect(sid).toBeTruthy();
  await rpcBody(res);
  const ack = await post(
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { 'mcp-session-id': sid!, 'mcp-protocol-version': '2025-06-18' },
  );
  expect(ack.status).toBe(202);
  return sid!;
}

beforeAll(async () => {
  app = createHttpApp(config, () => createBannerMcpServer(config, testDeps(config)));
  await new Promise<void>((resolve) => app.httpServer.listen(0, '127.0.0.1', () => resolve()));
  const port = (app.httpServer.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await app.close();
});

describe('checkBearer', () => {
  it('accepts only the exact token', () => {
    expect(checkBearer(`Bearer ${TEST_TOKEN}`, TEST_TOKEN)).toBe(true);
    expect(checkBearer(`bearer ${TEST_TOKEN}`, TEST_TOKEN)).toBe(true);
    expect(checkBearer(`Bearer ${TEST_TOKEN}x`, TEST_TOKEN)).toBe(false);
    expect(checkBearer('Bearer short', TEST_TOKEN)).toBe(false);
    expect(checkBearer(`Basic ${TEST_TOKEN}`, TEST_TOKEN)).toBe(false);
    expect(checkBearer(undefined, TEST_TOKEN)).toBe(false);
  });
});

describe('createHttpApp', () => {
  it('refuses to build without a token', () => {
    const noToken = { ...makeConfig(), httpToken: undefined };
    expect(() => createHttpApp(noToken)).toThrow('BANNER_MCP_HTTP_TOKEN');
  });
});

describe('HTTP transport', () => {
  it('serves /healthz without auth and without data', async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('returns 404 for unknown paths', async () => {
    const res = await fetch(`${base}/nope`);
    expect(res.status).toBe(404);
  });

  it('rejects requests without or with a wrong bearer token', async () => {
    const none = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: ACCEPT },
      body: JSON.stringify(initBody(1)),
    });
    expect(none.status).toBe(401);
    expect(none.headers.get('www-authenticate')).toMatch(/^Bearer/);

    const wrong = await post(initBody(1), { Authorization: 'Bearer not-the-token' });
    expect(wrong.status).toBe(401);
    expect(app.sessions.size).toBe(0);
  });

  it('rejects non-initialize requests without a session and unknown sessions', async () => {
    const noSession = await post({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(noSession.status).toBe(400);
    const unknown = await post(
      { jsonrpc: '2.0', id: 1, method: 'tools/list' },
      { 'mcp-session-id': '00000000-0000-0000-0000-000000000000' },
    );
    expect(unknown.status).toBe(404);
  });

  it('rejects invalid JSON', async () => {
    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: ACCEPT,
        Authorization: `Bearer ${TEST_TOKEN}`,
      },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });

  it('supports two concurrent sessions, each with its own server', async () => {
    const [a, b] = await Promise.all([openSession(1), openSession(2)]);
    expect(a).not.toBe(b);
    expect(app.sessions.size).toBe(2);
    expect(app.sessions.get(a)!.mcp).not.toBe(app.sessions.get(b)!.mcp);

    const headers = (sid: string) => ({
      'mcp-session-id': sid,
      'mcp-protocol-version': '2025-06-18',
    });

    // Load a domain in session A only; session B must not see it.
    const nav = await post(
      {
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'banner_navigate', arguments: { domain: 'hr' } },
      },
      headers(a),
    );
    expect(nav.status).toBe(200);
    await rpcBody(nav);

    const [listA, listB] = await Promise.all([
      post({ jsonrpc: '2.0', id: 11, method: 'tools/list' }, headers(a)),
      post({ jsonrpc: '2.0', id: 12, method: 'tools/list' }, headers(b)),
    ]);
    const namesOf = async (r: Response) =>
      ((await rpcBody(r))['result'] as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    const namesA = await namesOf(listA);
    const namesB = await namesOf(listB);
    expect(namesA).toContain('banner_employees_search');
    expect(namesB).not.toContain('banner_employees_search');
    expect(namesA).toContain('banner_person_lookup');
    expect(namesB).toContain('banner_person_lookup');

    // DELETE ends session A; B keeps working.
    const del = await fetch(`${base}/mcp`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TEST_TOKEN}`, ...headers(a) },
    });
    expect(del.status).toBe(200);
    expect(app.sessions.has(a)).toBe(false);
    expect(app.sessions.has(b)).toBe(true);

    const afterDelete = await post({ jsonrpc: '2.0', id: 13, method: 'tools/list' }, headers(a));
    expect(afterDelete.status).toBe(404);
    const stillB = await post({ jsonrpc: '2.0', id: 14, method: 'tools/list' }, headers(b));
    expect(stillB.status).toBe(200);
    await rpcBody(stillB);
  });

  it('requires the token for DELETE too', async () => {
    const sid = await openSession(3);
    const res = await fetch(`${base}/mcp`, {
      method: 'DELETE',
      headers: { 'mcp-session-id': sid },
    });
    expect(res.status).toBe(401);
    expect(app.sessions.has(sid)).toBe(true);
  });
});
