import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOMAIN_NAMES } from './domains/names.js';
import { ETHOS_WRITE_TOOLS } from './domains/ethos/tools.js';
import { setAuditEnabled, setAuditSink } from './audit.js';
import { validateBannerApiPath } from './server.js';
import {
  callTool,
  connect,
  criteriaOf,
  json,
  makeConfig,
  mockFetch,
  TEST_BANNER,
} from './testing/helpers.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('domain registry', () => {
  it('reports exactly the tools each domain registers', async () => {
    const { client, mcp } = await connect(makeConfig());
    const before = new Set((await client.listTools()).tools.map((t) => t.name));
    expect([...before].sort()).toEqual(['banner_navigate', 'banner_status']);

    for (const domain of DOMAIN_NAMES) {
      const { data } = await callTool(client, 'banner_navigate', { domain });
      const reported = data['tools'] as string[];
      expect(reported.length).toBeGreaterThan(0);
      expect(mcp.registry.getToolNamesForDomain(domain)).toEqual(reported);
    }

    const all = (await client.listTools()).tools.map((t) => t.name);
    const reportedAll = Object.values(mcp.registry.getToolsByDomain()).flat();
    expect(new Set(all)).toEqual(new Set(['banner_navigate', 'banner_status', ...reportedAll]));
    expect(reportedAll).toContain('banner_person_lookup');
    expect(reportedAll).toContain('banner_student_context');
    expect(reportedAll).toContain('banner_section_registrations_search');
  });

  it('reports already-loaded domains without re-registering', async () => {
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const { data, isError } = await callTool(client, 'banner_navigate', { domain: 'student' });
    expect(isError).toBe(false);
    expect(data['alreadyLoaded']).toBe(true);
    expect((data['tools'] as string[]).length).toBeGreaterThan(5);
  });

  it('preloads every domain with BANNER_PRELOAD_DOMAINS=all', async () => {
    const { mcp } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'all' }));
    expect(mcp.registry.getLoadedDomains().sort()).toEqual([...DOMAIN_NAMES].sort());
  });
});

describe('write gating', () => {
  it('does not register write tools by default', async () => {
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'all' }));
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const w of ETHOS_WRITE_TOOLS) expect(names).not.toContain(w);
    expect(names).toContain('banner_ethos_get');
    const { data } = await callTool(client, 'banner_status');
    expect(data['writesEnabled']).toBe(false);
  });

  it('rejects a call to a write tool that is not registered', async () => {
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'ethos' }));
    const res = await callTool(client, 'banner_ethos_delete', { resource: 'persons', id: 'x' });
    expect(res.isError).toBe(true);
  });

  it('registers write tools when BANNER_ALLOW_WRITES=true', async () => {
    const { client } = await connect(
      makeConfig({ BANNER_PRELOAD_DOMAINS: 'ethos', BANNER_ALLOW_WRITES: 'true' }),
    );
    const tools = (await client.listTools()).tools;
    for (const w of ETHOS_WRITE_TOOLS) {
      const tool = tools.find((t) => t.name === w);
      expect(tool).toBeDefined();
      expect(tool?.annotations?.destructiveHint).toBe(true);
    }
    const { data } = await callTool(client, 'banner_status');
    expect(data['writesEnabled']).toBe(true);
  });

  it('marks read tools read-only', async () => {
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const tool = (await client.listTools()).tools.find((t) => t.name === 'banner_person_lookup');
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });

  it('rejects GraphQL mutations', async () => {
    const { fn } = mockFetch();
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'ethos' }));
    const res = await callTool(client, 'banner_ethos_graphql', {
      query: 'mutation { deletePerson(id: "x") { id } }',
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Only GraphQL queries');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('output size and fields', () => {
  it('truncates oversized pages with a notice and honors fields', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      id: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      code: `S${i}`,
      titles: [{ type: 'long', value: 'z'.repeat(300) }],
    }));
    mockFetch((req) =>
      req.url.pathname === '/api/sections'
        ? json(rows.slice(0, Number(req.url.searchParams.get('limit'))), 1000)
        : undefined,
    );
    const { client } = await connect(
      makeConfig({ BANNER_PRELOAD_DOMAINS: 'student', BANNER_MAX_RESPONSE_CHARS: '5000' }),
    );
    const big = await callTool(client, 'banner_sections_search', { limit: 100 });
    expect(big.isError).toBe(false);
    expect(big.text.length).toBeLessThanOrEqual(5000);
    expect((big.data['truncation'] as { truncated: boolean }).truncated).toBe(true);
    expect(big.text).not.toContain('\n  '); // compact JSON

    const slim = await callTool(client, 'banner_sections_search', { limit: 50, fields: ['code'] });
    expect(slim.data['truncation']).toBeUndefined();
    expect(slim.data.data?.[0]).toEqual({ id: rows[0]!.id, code: 'S0' });
  });
});

describe('audit logging through tools', () => {
  it('emits one sanitized line per call, without response bodies', async () => {
    const lines: string[] = [];
    const prev = setAuditSink((l) => lines.push(l));
    setAuditEnabled(true);
    try {
      mockFetch((req) =>
        req.url.pathname === '/api/persons'
          ? json(
              [
                {
                  id: '11111111-1111-1111-1111-111111111111',
                  names: [],
                  dateOfBirth: '1999-09-09',
                },
              ],
              1,
            )
          : undefined,
      );
      const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
      setAuditEnabled(true); // makeConfig disables via env only for the process entry point
      await callTool(client, 'banner_person_lookup', { bannerId: 'A00777777' });
      const toolLines = lines.filter((l) => l.includes('banner_person_lookup'));
      expect(toolLines).toHaveLength(1);
      const rec = JSON.parse(toolLines[0]!) as Record<string, unknown>;
      expect(rec['resultCount']).toBe(1);
      expect(typeof rec['durationMs']).toBe('number');
      expect(toolLines[0]).not.toContain('A00777777');
      expect(toolLines[0]).not.toContain('1999-09-09');
    } finally {
      setAuditSink(prev);
    }
  });
});

describe('banner_api_get', () => {
  const restEnv = {
    BANNER_BASE_URL: TEST_BANNER,
    BANNER_USERNAME: 'svc',
    BANNER_PASSWORD: 'pw',
  };

  it('is not registered without Banner REST credentials', async () => {
    const { client } = await connect(makeConfig());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).not.toContain('banner_api_get');
  });

  it('GETs a path on the configured host only', async () => {
    const { requests } = mockFetch((req) =>
      req.url.origin === TEST_BANNER ? json([{ code: '202680' }]) : undefined,
    );
    const { client } = await connect(makeConfig(restEnv));
    const ok = await callTool(client, 'banner_api_get', {
      path: '/StudentApi/api/terms',
      query: { max: 5 },
    });
    expect(ok.isError).toBe(false);
    expect(ok.data.data).toEqual([{ code: '202680' }]);
    const req = requests.at(-1)!;
    expect(req.method).toBe('GET');
    expect(req.url.origin).toBe(TEST_BANNER);
    expect(req.url.pathname).toBe('/StudentApi/api/terms');
    expect(req.url.searchParams.get('max')).toBe('5');

    for (const bad of [
      '//evil.example/x',
      'https://evil.example/x',
      '/a/../b',
      '/a/%2e%2e/b',
      '/a?b=1',
    ]) {
      const res = await callTool(client, 'banner_api_get', { path: bad });
      expect(res.isError).toBe(true);
    }
    expect(requests).toHaveLength(1);
  });

  it('validateBannerApiPath accepts normal paths', () => {
    expect(validateBannerApiPath('/StudentApi/api/terms')).toBe('/StudentApi/api/terms');
    expect(() => validateBannerApiPath('relative')).toThrow();
    expect(() => validateBannerApiPath('/a\\b')).toThrow();
  });
});

describe('criteria passthrough', () => {
  it('banner_ethos_filter encodes criteria', async () => {
    const { requests } = mockFetch((req) =>
      req.url.pathname === '/api/academic-periods' ? json([], 0) : undefined,
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'ethos' }));
    await callTool(client, 'banner_ethos_filter', {
      resource: 'academic-periods',
      criteria: { code: '202680' },
      version: 16,
    });
    expect(criteriaOf(requests[0]!)).toEqual({ code: '202680' });
  });
});
