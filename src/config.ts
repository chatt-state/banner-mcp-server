/**
 * Configuration management for the Banner MCP server.
 *
 * Reads environment variables and returns a validated, immutable config
 * object. Invalid values fail fast with a message that names the variable
 * (never its value, since several variables hold secrets).
 */

import { DOMAIN_NAMES, type DomainName } from './domains/names.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface BannerMcpConfig {
  /** Ethos Integration API key. */
  ethosApiKey: string;
  /** Ethos base URL. */
  ethosBaseUrl: string;
  /** Per-attempt request timeout for Ethos and Banner calls, in ms. */
  requestTimeoutMs: number;
  /** Banner native REST base URL (optional). */
  bannerBaseUrl?: string;
  /** Banner username for Basic Auth (optional). */
  bannerUsername?: string;
  /** Banner password for Basic Auth (optional). */
  bannerPassword?: string;
  /** True when base URL, username and password are all set. */
  bannerRestEnabled: boolean;
  /** MCP transport: stdio or http. */
  transport: 'stdio' | 'http';
  /** HTTP transport port. */
  httpPort: number;
  /** HTTP transport bind address. */
  httpHost: string;
  /** Bearer token required on every /mcp request (http transport only). */
  httpToken?: string;
  /** Optional Host header allow-list (DNS rebinding protection). */
  httpAllowedHosts: string[];
  /** Maximum concurrent MCP sessions over HTTP. */
  maxSessions: number;
  /** Idle minutes after which an HTTP session is closed. */
  sessionIdleMinutes: number;
  /** Domains to pre-load at startup (already validated, "all" expanded). */
  preloadDomains: DomainName[];
  /** Register create/update/delete and notification-consume tools. */
  allowWrites: boolean;
  /** Maximum characters in a single tool response. */
  maxResponseChars: number;
  /** Emit one JSON audit line per tool call on stderr. */
  auditLog: boolean;
  /** Diagnostic log level. */
  logLevel: LogLevel;
}

/** Thrown when an environment variable is missing or invalid. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

const LOG_LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];

/** Minimum bearer token length; shorter tokens are guessable. */
export const MIN_HTTP_TOKEN_LENGTH = 32;

function str(env: Env, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = str(env, name);
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw)) {
    throw new ConfigError(`${name} must be a whole number between ${min} and ${max}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be a whole number between ${min} and ${max}`);
  }
  return value;
}

function bool(env: Env, name: string, fallback: boolean): boolean {
  const raw = str(env, name);
  if (raw === undefined) return fallback;
  const v = raw.toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  throw new ConfigError(`${name} must be "true" or "false"`);
}

function list(env: Env, name: string, fallback: string): string[] {
  return (str(env, name) ?? fallback)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function httpsUrl(env: Env, name: string, fallback?: string): string | undefined {
  const raw = str(env, name) ?? fallback;
  if (raw === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`${name} is not a valid URL`);
  }
  if (url.protocol !== 'https:') {
    throw new ConfigError(`${name} must use https://`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new ConfigError(`${name} must not contain credentials, a query string or a fragment`);
  }
  return raw.replace(/\/+$/, '');
}

function parsePreload(env: Env): DomainName[] {
  const entries = list(env, 'BANNER_PRELOAD_DOMAINS', 'student');
  if (entries.some((e) => e.toLowerCase() === 'all')) return [...DOMAIN_NAMES];
  if (entries.some((e) => e.toLowerCase() === 'none')) return [];
  const out: DomainName[] = [];
  for (const entry of entries) {
    if (!(DOMAIN_NAMES as readonly string[]).includes(entry)) {
      throw new ConfigError(
        `BANNER_PRELOAD_DOMAINS contains unknown domain "${entry}". ` +
          `Valid: ${DOMAIN_NAMES.join(', ')}, all, none`,
      );
    }
    if (!out.includes(entry as DomainName)) out.push(entry as DomainName);
  }
  return out;
}

/**
 * Builds and validates a config object from an environment map.
 * Pure: does not read process.env or cache anything.
 */
export function loadConfig(env: Env = process.env): BannerMcpConfig {
  const ethosApiKey = str(env, 'ETHOS_API_KEY');
  if (!ethosApiKey) {
    throw new ConfigError('ETHOS_API_KEY environment variable is required');
  }

  const transport = str(env, 'BANNER_MCP_TRANSPORT') ?? 'stdio';
  if (transport !== 'stdio' && transport !== 'http') {
    throw new ConfigError(
      `Invalid BANNER_MCP_TRANSPORT: "${transport}". Must be "stdio" or "http".`,
    );
  }

  const httpToken = str(env, 'BANNER_MCP_HTTP_TOKEN');
  if (transport === 'http') {
    if (!httpToken) {
      throw new ConfigError(
        'BANNER_MCP_HTTP_TOKEN is required when BANNER_MCP_TRANSPORT=http ' +
          "(generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\")",
      );
    }
    if (httpToken.length < MIN_HTTP_TOKEN_LENGTH) {
      throw new ConfigError(
        `BANNER_MCP_HTTP_TOKEN must be at least ${MIN_HTTP_TOKEN_LENGTH} characters`,
      );
    }
  }

  const logLevel = (str(env, 'BANNER_LOG_LEVEL') ?? 'info').toLowerCase();
  if (!(LOG_LEVELS as readonly string[]).includes(logLevel)) {
    throw new ConfigError(`BANNER_LOG_LEVEL must be one of: ${LOG_LEVELS.join(', ')}`);
  }

  const bannerBaseUrl = httpsUrl(env, 'BANNER_BASE_URL');
  const bannerUsername = str(env, 'BANNER_USERNAME');
  const bannerPassword = env['BANNER_PASSWORD'] || undefined;

  return Object.freeze({
    ethosApiKey,
    ethosBaseUrl: httpsUrl(env, 'ETHOS_BASE_URL', 'https://integrate.elluciancloud.com')!,
    requestTimeoutMs: int(env, 'BANNER_REQUEST_TIMEOUT_MS', 30_000, 1_000, 300_000),
    bannerBaseUrl,
    bannerUsername,
    bannerPassword,
    bannerRestEnabled: !!(bannerBaseUrl && bannerUsername && bannerPassword),
    transport,
    httpPort: int(env, 'BANNER_MCP_HTTP_PORT', 3001, 1, 65535),
    httpHost: str(env, 'BANNER_MCP_HTTP_HOST') ?? '127.0.0.1',
    httpToken,
    httpAllowedHosts: list(env, 'BANNER_MCP_ALLOWED_HOSTS', ''),
    maxSessions: int(env, 'BANNER_MCP_MAX_SESSIONS', 50, 1, 10_000),
    sessionIdleMinutes: int(env, 'BANNER_MCP_SESSION_IDLE_MINUTES', 30, 1, 24 * 60),
    preloadDomains: parsePreload(env),
    allowWrites: bool(env, 'BANNER_ALLOW_WRITES', false),
    maxResponseChars: int(env, 'BANNER_MAX_RESPONSE_CHARS', 60_000, 2_000, 5_000_000),
    auditLog: bool(env, 'BANNER_AUDIT_LOG', true),
    logLevel: logLevel as LogLevel,
  });
}

let configInstance: BannerMcpConfig | null = null;

/**
 * Returns the process-wide config, built from process.env on first call.
 */
export function getConfig(): BannerMcpConfig {
  if (configInstance === null) {
    configInstance = loadConfig(process.env);
  }
  return configInstance;
}

/**
 * Resets the cached config. Primarily useful for testing.
 */
export function resetConfig(): void {
  configInstance = null;
}
