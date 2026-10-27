import { describe, it, expect, afterEach, vi } from 'vitest';
import { DOMAIN_NAMES } from './domains/names.js';
import { ETHOS_WRITE_TOOLS, isNonQueryGraphql } from './domains/ethos/tools.js';
import { setAuditEnabled, setAuditSink } from './audit.js';
import { bannerListEnvelope, validateBannerApiPath } from './server.js';
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
    expect(res.text).toContain('Only a valid GraphQL query');
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not let a quote inside a comment hide a mutation', async () => {
    const hidden = '# "\nmutation { deletePerson(id: 1) { id } }\n# "';
    expect(isNonQueryGraphql(hidden)).toBe(true);
    const { fn } = mockFetch();
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'ethos' }));
    const res = await callTool(client, 'banner_ethos_graphql', { query: hidden });
    expect(res.isError).toBe(true);
    expect(fn).not.toHaveBeenCalled();
  });

  it('classifies GraphQL documents by parsing them', () => {
    // Allowed: queries (named, anonymous, shorthand) and fragments.
    expect(isNonQueryGraphql('{ persons12 { edges { node { id } } } }')).toBe(false);
    expect(
      isNonQueryGraphql(
        'query Q($id: ID) { persons12(filter: {id: {EQ: $id}}) { ...F } }\n' +
          'fragment F on Persons12Connection { totalCount }',
      ),
    ).toBe(false);
    // Keywords inside strings and comments are not operations.
    expect(isNonQueryGraphql('# mutation\n{ a(s: "mutation { x }") }')).toBe(false);
    expect(isNonQueryGraphql('{ a(s: """mutation { x }""") }')).toBe(false);
    // Rejected: mutations, subscriptions, mixed documents, schema and parse errors.
    expect(isNonQueryGraphql('mutation { x }')).toBe(true);
    expect(isNonQueryGraphql('subscription { x }')).toBe(true);
    // An aliased mutation field is still a mutation operation.
    expect(isNonQueryGraphql('mutation { safeLooking: deletePerson(id: 1) { id } }')).toBe(true);
    expect(isNonQueryGraphql('query A { a } mutation B { b }')).toBe(true);
    expect(isNonQueryGraphql('type Foo { a: Int }')).toBe(true);
    expect(isNonQueryGraphql('{ unterminated')).toBe(true);
  });

  it('rejects an aliased mutation at the tool boundary', async () => {
    const { fn } = mockFetch();
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'ethos' }));
    const res = await callTool(client, 'banner_ethos_graphql', {
      query: 'mutation { ok: deletePerson(id: "x") { id } }',
    });
    expect(res.isError).toBe(true);
    expect(res.text).toContain('Only a valid GraphQL query');
    expect(fn).not.toHaveBeenCalled();
  });

  it('sends the re-printed query document, not the raw client string', async () => {
    const { requests } = mockFetch((req) =>
      req.url.pathname === '/graphql'
        ? json({ data: { persons12: { totalCount: 0 } } })
        : undefined,
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'ethos' }));
    // A valid query carrying a comment and irregular whitespace.
    const raw = '# a comment\n{    persons12   {  totalCount   } }';
    const res = await callTool(client, 'banner_ethos_graphql', { query: raw });
    expect(res.isError).toBe(false);
    const gql = requests.find((r) => r.url.pathname === '/graphql');
    expect(gql).toBeDefined();
    const sent = JSON.parse(gql!.body!) as { query: string };
    // The bytes Ethos receives are the parser's canonical output, not the input:
    // the comment is gone and the query was reformatted.
    expect(sent.query).not.toBe(raw);
    expect(sent.query).not.toContain('# a comment');
    expect(sent.query).toContain('persons12');
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
                  credentials: [{ type: 'bannerId', value: 'A00777777' }],
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
    expect(validateBannerApiPath('/BannerAdminBPAPI/api/x')).toBe('/BannerAdminBPAPI/api/x');
    expect(() => validateBannerApiPath('relative')).toThrow();
    expect(() => validateBannerApiPath('/a\\b')).toThrow();
  });

  it('rejects traversal that only normalizes after parsing (parser differential)', () => {
    // `;`-parameters strip to `..` in a servlet container; `%2e` decodes to `.`;
    // a plain `..` segment escapes the base. None may pass the allowlist, even
    // though the raw string still starts with an allowed prefix.
    for (const bad of [
      '/StudentApi/api/..;/secret',
      '/StudentApi/api/..;/..;/BannerAdmin/console',
      '/StudentApi/api/%2e%2e/secret',
      '/StudentApi/api/foo/../../etc/passwd',
      '/StudentApi/api/../../BannerAdmin/console',
      '/StudentApi/api/x/%2e%2e;/y',
    ]) {
      expect(() => validateBannerApiPath(bad)).toThrow();
    }
    // A legitimate deep path is still allowed and returned normalized.
    expect(validateBannerApiPath('/StudentApi/api/students/holds')).toBe(
      '/StudentApi/api/students/holds',
    );
  });

  it('matches the allowlist on the normalized path, not the raw string', async () => {
    const { requests } = mockFetch(() => json([]));
    const { client } = await connect(makeConfig(restEnv));
    // `..;/` strips to `..` and escapes /StudentApi/api/ -> must never be fetched.
    const res = await callTool(client, 'banner_api_get', {
      path: '/StudentApi/api/..;/BannerAdmin/console',
    });
    expect(res.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('only allows the configured REST API prefixes', async () => {
    for (const bad of [
      '/BannerAdmin/',
      '/applicationNavigator/seamless',
      '/BannerExtensibility/internal/page',
      '/StudentApi/apiX/terms',
      '/studentapi/api/terms',
      '/StudentApi/api',
    ]) {
      expect(() => validateBannerApiPath(bad)).toThrow(/BANNER_API_PATH_PREFIXES/);
    }
    expect(validateBannerApiPath('/Custom/api/x', ['/Custom/api/'])).toBe('/Custom/api/x');
    expect(() => validateBannerApiPath('/StudentApi/api/terms', ['/Custom/api/'])).toThrow();

    const { requests } = mockFetch(() => json([]));
    const { client } = await connect(
      makeConfig({ ...restEnv, BANNER_API_PATH_PREFIXES: '/StudentApi/api/' }),
    );
    const res = await callTool(client, 'banner_api_get', { path: '/BannerAdminBPAPI/api/x' });
    expect(res.isError).toBe(true);
    const res2 = await callTool(client, 'banner_api_get', { path: '/BannerAdmin/' });
    expect(res2.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });

  it('reports Banner REST paging headers instead of hasMore:false', async () => {
    mockFetch((req) => {
      if (req.url.origin !== TEST_BANNER) return undefined;
      const rows = [{ code: 'a' }, { code: 'b' }];
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (req.url.pathname.endsWith('/hedtech')) {
        headers['X-hedtech-totalCount'] = '7';
        headers['X-hedtech-pageOffset'] = '2';
        headers['X-hedtech-pageMaxSize'] = '2';
      } else if (req.url.pathname.endsWith('/maxonly')) {
        headers['X-hedtech-pageMaxSize'] = '2';
      }
      return new Response(JSON.stringify(rows), { status: 200, headers });
    });
    const { client } = await connect(makeConfig(restEnv));

    const paged = await callTool(client, 'banner_api_get', {
      path: '/StudentApi/api/hedtech',
      query: { max: 2, offset: 2 },
    });
    expect(paged.data).toMatchObject({
      totalCount: 7,
      offset: 2,
      count: 2,
      hasMore: true,
      nextOffset: 4,
    });

    const maxOnly = await callTool(client, 'banner_api_get', {
      path: '/StudentApi/api/maxonly',
      query: { offset: 4 },
    });
    expect(maxOnly.data).toMatchObject({ offset: 4, count: 2, hasMore: true, nextOffset: 6 });
    expect(maxOnly.data['totalCount']).toBeUndefined();

    const bare = await callTool(client, 'banner_api_get', { path: '/StudentApi/api/bare' });
    expect(bare.data).toMatchObject({ offset: 0, count: 2, hasMore: 'unknown' });
    expect(bare.data['pagingNote']).toMatch(/no paging headers/);
  });

  it('bannerListEnvelope computes the last page from X-Total-Count', () => {
    const env = bannerListEnvelope([1, 2, 3], new Headers({ 'X-Total-Count': '5' }), {
      offset: 2,
    });
    expect(env).toMatchObject({ totalCount: 5, offset: 2, count: 3, hasMore: false });
    expect(env).not.toHaveProperty('nextOffset');
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
