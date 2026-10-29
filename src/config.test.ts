import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigError, getConfig, loadConfig, resetConfig } from './config.js';
import { DOMAIN_NAMES } from './domains/names.js';

const base = { ETHOS_API_KEY: 'test-api-key' };
const TOKEN = 'x'.repeat(40);

describe('loadConfig', () => {
  it('requires ETHOS_API_KEY', () => {
    expect(() => loadConfig({})).toThrow('ETHOS_API_KEY');
  });

  it('returns safe defaults', () => {
    const c = loadConfig(base);
    expect(c.ethosBaseUrl).toBe('https://integrate.elluciancloud.com');
    expect(c.transport).toBe('stdio');
    expect(c.httpPort).toBe(3001);
    expect(c.httpHost).toBe('127.0.0.1');
    expect(c.preloadDomains).toEqual(['student']);
    expect(c.allowWrites).toBe(false);
    expect(c.maxResponseChars).toBe(60_000);
    expect(c.auditLog).toBe(true);
    expect(c.bannerRestEnabled).toBe(false);
    expect(c.logLevel).toBe('info');
  });

  it('reads custom values', () => {
    const c = loadConfig({
      ...base,
      ETHOS_BASE_URL: 'https://custom.example.com/',
      BANNER_MCP_TRANSPORT: 'http',
      BANNER_MCP_HTTP_TOKEN: TOKEN,
      BANNER_MCP_HTTP_PORT: '8080',
      BANNER_PRELOAD_DOMAINS: 'student, ethos',
      BANNER_ALLOW_WRITES: 'true',
      BANNER_MAX_RESPONSE_CHARS: '10000',
    });
    expect(c.ethosBaseUrl).toBe('https://custom.example.com');
    expect(c.transport).toBe('http');
    expect(c.httpPort).toBe(8080);
    expect(c.preloadDomains).toEqual(['student', 'ethos']);
    expect(c.allowWrites).toBe(true);
    expect(c.maxResponseChars).toBe(10_000);
  });

  it('expands BANNER_PRELOAD_DOMAINS=all and none', () => {
    expect(loadConfig({ ...base, BANNER_PRELOAD_DOMAINS: 'all' }).preloadDomains).toEqual([
      ...DOMAIN_NAMES,
    ]);
    expect(loadConfig({ ...base, BANNER_PRELOAD_DOMAINS: 'none' }).preloadDomains).toEqual([]);
  });

  it('parses BANNER_API_PATH_PREFIXES with REST API defaults', () => {
    expect(loadConfig(base).bannerApiPathPrefixes).toEqual([
      '/StudentApi/api/',
      '/BannerAdminBPAPI/api/',
    ]);
    expect(
      loadConfig({ ...base, BANNER_API_PATH_PREFIXES: '/StudentApi/api, /Custom/v1/' })
        .bannerApiPathPrefixes,
    ).toEqual(['/StudentApi/api/', '/Custom/v1/']);
    for (const bad of ['StudentApi/api', '/', '/a/../b/', 'https://x/api/', '/a b/']) {
      expect(() => loadConfig({ ...base, BANNER_API_PATH_PREFIXES: bad })).toThrow(
        'BANNER_API_PATH_PREFIXES',
      );
    }
  });

  it('rejects unknown preload domains', () => {
    expect(() => loadConfig({ ...base, BANNER_PRELOAD_DOMAINS: 'student,bogus' })).toThrow(
      /unknown domain "bogus"/,
    );
  });

  it('rejects invalid transport', () => {
    expect(() => loadConfig({ ...base, BANNER_MCP_TRANSPORT: 'websocket' })).toThrow(
      'Invalid BANNER_MCP_TRANSPORT',
    );
  });

  it.each([
    ['BANNER_MCP_HTTP_PORT', 'abc'],
    ['BANNER_MCP_HTTP_PORT', '70000'],
    ['BANNER_MCP_HTTP_PORT', '0'],
    ['BANNER_MAX_RESPONSE_CHARS', '-5'],
    ['BANNER_MAX_RESPONSE_CHARS', '12.5'],
    ['BANNER_MCP_MAX_SESSIONS', '0'],
    ['BANNER_REQUEST_TIMEOUT_MS', '1e5'],
  ])('rejects invalid number %s=%s', (name, value) => {
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, [name]: value })).toThrow(name);
  });

  it('rejects invalid booleans and log levels', () => {
    expect(() => loadConfig({ ...base, BANNER_ALLOW_WRITES: 'maybe' })).toThrow(
      'BANNER_ALLOW_WRITES',
    );
    expect(() => loadConfig({ ...base, BANNER_LOG_LEVEL: 'loud' })).toThrow('BANNER_LOG_LEVEL');
  });

  it('refuses http transport without a bearer token', () => {
    expect(() => loadConfig({ ...base, BANNER_MCP_TRANSPORT: 'http' })).toThrow(
      'BANNER_MCP_HTTP_TOKEN is required',
    );
    expect(() =>
      loadConfig({ ...base, BANNER_MCP_TRANSPORT: 'http', BANNER_MCP_HTTP_TOKEN: 'short' }),
    ).toThrow('at least 32');
  });

  it('requires https base URLs without credentials', () => {
    expect(() => loadConfig({ ...base, ETHOS_BASE_URL: 'http://x.example' })).toThrow('https');
    expect(() => loadConfig({ ...base, BANNER_BASE_URL: 'https://u:p@x.example' })).toThrow(
      'credentials',
    );
    expect(() => loadConfig({ ...base, BANNER_BASE_URL: 'not a url' })).toThrow('valid URL');
  });

  it('enables Banner REST only when URL, user and password are all set', () => {
    expect(loadConfig({ ...base, BANNER_BASE_URL: 'https://b.example' }).bannerRestEnabled).toBe(
      false,
    );
    const c = loadConfig({
      ...base,
      BANNER_BASE_URL: 'https://b.example',
      BANNER_USERNAME: 'svc',
      BANNER_PASSWORD: 'pw',
    });
    expect(c.bannerRestEnabled).toBe(true);
  });

  it('error messages never echo secret values', () => {
    expect(() =>
      loadConfig({ ...base, BANNER_MCP_TRANSPORT: 'http', BANNER_MCP_HTTP_TOKEN: 'sekrit' }),
    ).toThrow(expect.objectContaining({ message: expect.not.stringContaining('sekrit') }));
  });
});

describe('getConfig', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    resetConfig();
    process.env['ETHOS_API_KEY'] = 'test-api-key';
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  it('caches config after first call', () => {
    expect(getConfig()).toBe(getConfig());
  });
});
