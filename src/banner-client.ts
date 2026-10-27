/**
 * Shared Ethos and Banner REST clients for the MCP server.
 *
 * Both are created lazily from the validated config and shared across all
 * MCP sessions in the process, so the Ethos JWT is fetched once and reused.
 */

import { BannerClient, EthosClient } from 'ellucian-banner';
import { getConfig, type BannerMcpConfig } from './config.js';

let ethosInstance: EthosClient | null = null;
let bannerInstance: BannerClient | null = null;

/** Builds an EthosClient from config. */
export function createEthosClient(config: BannerMcpConfig): EthosClient {
  return new EthosClient({
    apiKey: config.ethosApiKey,
    baseUrl: config.ethosBaseUrl,
    timeout: config.requestTimeoutMs,
    retry: true,
  });
}

/**
 * Builds a BannerClient from config, or returns null when Banner REST is not
 * configured (BANNER_BASE_URL, BANNER_USERNAME and BANNER_PASSWORD all set).
 */
export function createBannerClient(config: BannerMcpConfig): BannerClient | null {
  if (!config.bannerRestEnabled) return null;
  return new BannerClient({
    baseUrl: config.bannerBaseUrl,
    username: config.bannerUsername,
    password: config.bannerPassword,
    timeout: config.requestTimeoutMs,
    retry: true,
  });
}

/** Returns the shared EthosClient instance. */
export function getEthosClient(): EthosClient {
  if (ethosInstance === null) {
    ethosInstance = createEthosClient(getConfig());
  }
  return ethosInstance;
}

/** Returns the shared BannerClient, or null when Banner REST is not configured. */
export function getBannerClient(): BannerClient | null {
  if (bannerInstance === null) {
    bannerInstance = createBannerClient(getConfig());
  }
  return bannerInstance;
}

/** Resets the singleton clients. Primarily useful for testing. */
export function resetEthosClient(): void {
  ethosInstance = null;
  bannerInstance = null;
}
