/**
 * Shared EthosClient instance for the MCP server.
 *
 * Creates a singleton EthosClient from the ellucian-banner
 * library, configured from environment variables via getConfig().
 */

import { EthosClient } from 'ellucian-banner';
import { getConfig } from './config.js';

/** Singleton EthosClient instance, lazily initialized. */
let clientInstance: EthosClient | null = null;

/**
 * Returns the shared EthosClient instance.
 * Lazily creates the client on first call using the validated config.
 */
export function getEthosClient(): EthosClient {
  if (clientInstance === null) {
    const config = getConfig();
    clientInstance = new EthosClient({
      apiKey: config.ethosApiKey,
      baseUrl: config.ethosBaseUrl,
    });
  }
  return clientInstance;
}

/**
 * Resets the singleton client instance.
 * Primarily useful for testing.
 */
export function resetEthosClient(): void {
  clientInstance = null;
}
