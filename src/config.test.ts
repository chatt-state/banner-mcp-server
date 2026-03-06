import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, resetConfig } from './config.js';

describe('getConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetConfig();
    // Set required vars
    process.env['ETHOS_API_KEY'] = 'test-api-key';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfig();
  });

  it('should require ETHOS_API_KEY', () => {
    delete process.env['ETHOS_API_KEY'];
    expect(() => getConfig()).toThrow('ETHOS_API_KEY');
  });

  it('should return valid config with defaults', () => {
    const config = getConfig();
    expect(config.ethosApiKey).toBe('test-api-key');
    expect(config.ethosBaseUrl).toBe('https://integrate.elluciancloud.com');
    expect(config.transport).toBe('stdio');
    expect(config.httpPort).toBe(3001);
    expect(config.httpHost).toBe('0.0.0.0');
    expect(config.preloadDomains).toEqual(['student']);
    expect(config.logLevel).toBe('info');
  });

  it('should read custom env vars', () => {
    process.env['ETHOS_BASE_URL'] = 'https://custom.example.com';
    process.env['BANNER_MCP_TRANSPORT'] = 'http';
    process.env['BANNER_MCP_HTTP_PORT'] = '8080';
    process.env['BANNER_PRELOAD_DOMAINS'] = 'student,ethos';

    const config = getConfig();
    expect(config.ethosBaseUrl).toBe('https://custom.example.com');
    expect(config.transport).toBe('http');
    expect(config.httpPort).toBe(8080);
    expect(config.preloadDomains).toEqual(['student', 'ethos']);
  });

  it('should reject invalid transport', () => {
    process.env['BANNER_MCP_TRANSPORT'] = 'websocket';
    expect(() => getConfig()).toThrow('Invalid BANNER_MCP_TRANSPORT');
  });

  it('should cache config after first call', () => {
    const config1 = getConfig();
    const config2 = getConfig();
    expect(config1).toBe(config2);
  });

  it('should include optional Banner auth fields', () => {
    process.env['BANNER_BASE_URL'] = 'https://banner.example.edu';
    process.env['BANNER_USERNAME'] = 'admin';
    process.env['BANNER_PASSWORD'] = 'secret';

    const config = getConfig();
    expect(config.bannerBaseUrl).toBe('https://banner.example.edu');
    expect(config.bannerUsername).toBe('admin');
    expect(config.bannerPassword).toBe('secret');
  });
});
