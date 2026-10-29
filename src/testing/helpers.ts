/**
 * Shared test helpers (excluded from the build).
 *
 * All Ethos/Banner traffic in tests goes through a mocked global fetch; no
 * test contacts a real service or needs credentials.
 */

import { vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { BannerClient, EthosClient } from 'ellucian-banner';
import { loadConfig, type BannerMcpConfig } from '../config.js';
import { createBannerMcpServer, type BannerMcpServer } from '../server.js';
import type { ToolDeps } from '../tools/define.js';

export const TEST_ETHOS = 'https://ethos.test';
export const TEST_BANNER = 'https://banner.test';
export const TEST_TOKEN = 'test-token-0123456789-abcdefghijklmnopqrstuvwxyz';

export function makeConfig(env: Record<string, string> = {}): BannerMcpConfig {
  return loadConfig({
    ETHOS_API_KEY: 'test-api-key',
    ETHOS_BASE_URL: TEST_ETHOS,
    BANNER_PRELOAD_DOMAINS: 'none',
    BANNER_AUDIT_LOG: 'false',
    ...env,
  });
}

export interface RecordedRequest {
  method: string;
  url: URL;
  body?: string;
}

export type Route = (req: RecordedRequest) => Response | undefined;

/** JSON response with optional Ethos paging headers. */
export function json(body: unknown, total?: number): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (total !== undefined) headers['x-total-count'] = String(total);
  return new Response(JSON.stringify(body), { status: 200, headers });
}

/**
 * Installs a mocked global fetch. `/auth` returns a token; other requests are
 * answered by the first route that returns a Response, else 404.
 */
export function mockFetch(...routes: Route[]) {
  const requests: RecordedRequest[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = typeof init?.body === 'string' ? init.body : undefined;
    if (url.pathname === '/auth') {
      return new Response('header.payload.signature', { status: 200 });
    }
    const req = { method, url, body };
    requests.push(req);
    for (const route of routes) {
      const res = route(req);
      if (res) return res;
    }
    return new Response('{"errors":[{"code":"Global.NotFound"}]}', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
  return { fn, requests };
}

/** Decodes the `criteria` query param of a recorded request. */
export function criteriaOf(req: RecordedRequest): unknown {
  const raw = req.url.searchParams.get('criteria');
  return raw === null ? undefined : JSON.parse(raw);
}

export function testDeps(config: BannerMcpConfig): ToolDeps {
  const ethos = new EthosClient({ apiKey: 'k', baseUrl: TEST_ETHOS, retry: false });
  const banner = config.bannerRestEnabled
    ? new BannerClient({ baseUrl: TEST_BANNER, username: 'u', password: 'p', retry: false })
    : null;
  return { config, ethos: () => ethos, banner: () => banner };
}

/** Creates a server + connected in-memory client. */
export async function connect(
  config: BannerMcpConfig,
): Promise<{ client: Client; mcp: BannerMcpServer }> {
  const mcp = createBannerMcpServer(config, testDeps(config));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([mcp.server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, mcp };
}

/** Calls a tool and returns its text plus parsed JSON (when the text is JSON). */
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  const text = result.content[0]?.text ?? '';
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    data = undefined;
  }
  return {
    text,
    data: data as Record<string, unknown> & { data?: unknown[] },
    isError: !!result.isError,
  };
}

export function person(id: string, bannerId: string, first: string, last: string) {
  return {
    id,
    names: [
      {
        type: { category: 'legal' },
        firstName: first,
        lastName: last,
        fullName: `${first} ${last}`,
      },
    ],
    credentials: [
      { type: 'bannerId', value: bannerId },
      { type: 'ssn', value: '000-00-0000' },
    ],
    emails: [
      {
        type: { type: 'school' },
        address: `${first.toLowerCase()}@example.edu`,
        preference: 'primary',
      },
    ],
    dateOfBirth: '2000-01-01',
    roles: [{ role: 'student' }],
  };
}
