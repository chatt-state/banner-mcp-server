/**
 * Configuration management for the Banner MCP server.
 *
 * Reads environment variables and provides a validated config object.
 */

export interface BannerMcpConfig {
  /** Ethos Integration API key. */
  ethosApiKey: string;
  /** Ethos base URL. */
  ethosBaseUrl: string;
  /** Banner native REST base URL (optional). */
  bannerBaseUrl?: string;
  /** Banner username for Basic Auth (optional). */
  bannerUsername?: string;
  /** Banner password for Basic Auth (optional). */
  bannerPassword?: string;
  /** MCP transport: stdio or http. */
  transport: 'stdio' | 'http';
  /** HTTP transport port. */
  httpPort: number;
  /** HTTP transport bind address. */
  httpHost: string;
  /** Domains to pre-load at startup. */
  preloadDomains: string[];
  /** Log level. */
  logLevel: string;
}

let configInstance: BannerMcpConfig | null = null;

/**
 * Parses and validates configuration from environment variables.
 * Caches the result after first call.
 */
export function getConfig(): BannerMcpConfig {
  if (configInstance !== null) {
    return configInstance;
  }

  const ethosApiKey = process.env['ETHOS_API_KEY'] ?? '';
  if (!ethosApiKey) {
    throw new Error('ETHOS_API_KEY environment variable is required');
  }

  const transport = process.env['BANNER_MCP_TRANSPORT'] ?? 'stdio';
  if (transport !== 'stdio' && transport !== 'http') {
    throw new Error(`Invalid BANNER_MCP_TRANSPORT: "${transport}". Must be "stdio" or "http".`);
  }

  configInstance = {
    ethosApiKey,
    ethosBaseUrl: process.env['ETHOS_BASE_URL'] ?? 'https://integrate.elluciancloud.com',
    bannerBaseUrl: process.env['BANNER_BASE_URL'] || undefined,
    bannerUsername: process.env['BANNER_USERNAME'] || undefined,
    bannerPassword: process.env['BANNER_PASSWORD'] || undefined,
    transport,
    httpPort: parseInt(process.env['BANNER_MCP_HTTP_PORT'] ?? '3001', 10),
    httpHost: process.env['BANNER_MCP_HTTP_HOST'] ?? '0.0.0.0',
    preloadDomains: (process.env['BANNER_PRELOAD_DOMAINS'] ?? 'student')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: process.env['BANNER_LOG_LEVEL'] ?? 'info',
  };

  return configInstance;
}

/**
 * Resets the cached config. Primarily useful for testing.
 */
export function resetConfig(): void {
  configInstance = null;
}
