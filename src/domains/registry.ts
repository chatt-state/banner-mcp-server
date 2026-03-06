/**
 * Domain registry for MCP tool registration.
 *
 * Manages the registration and discovery of domain-specific
 * tool handlers (student, financial aid, finance, HR, ethos).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** All supported domain names. */
export const DOMAIN_NAMES = [
  'student',
  'financial_aid',
  'finance',
  'hr',
  'ethos',
] as const;

export type DomainName = (typeof DOMAIN_NAMES)[number];

/** Interface that each domain module must implement. */
export interface DomainModule {
  register(server: McpServer): void;
}

/** Maps domain names to their module import paths. */
const MODULE_MAP: Record<DomainName, string> = {
  student: './student/index.js',
  financial_aid: './financial-aid/index.js',
  finance: './finance/index.js',
  hr: './hr/index.js',
  ethos: './ethos/index.js',
};

/** Known tool names per domain for reporting after load. */
const DOMAIN_TOOLS: Record<DomainName, string[]> = {
  student: [
    'banner_persons_search',
    'banner_persons_get',
    'banner_students_search',
    'banner_students_get',
    'banner_courses_get',
    'banner_sections_search',
    'banner_academic_periods_get',
  ],
  financial_aid: [],
  finance: [],
  hr: [],
  ethos: [
    'banner_ethos_get',
    'banner_ethos_get_all',
    'banner_ethos_create',
    'banner_ethos_update',
    'banner_ethos_delete',
    'banner_ethos_consume_notifications',
  ],
};

/**
 * Registry that manages lazy-loading of domain tool sets.
 *
 * Domains are loaded on demand via `loadDomain()`. Once loaded,
 * their tools are registered with the MCP server and clients
 * are notified of the tool list change.
 */
class DomainRegistry {
  private loadedDomains = new Set<DomainName>();
  private serverRef: McpServer | null = null;

  /**
   * Sets the MCP server reference used when registering domain tools.
   */
  setServer(server: McpServer): void {
    this.serverRef = server;
  }

  /**
   * Loads a domain module and registers its tools with the MCP server.
   *
   * If the domain is already loaded, returns an empty array immediately.
   * Otherwise, dynamically imports the module, calls its `register()`
   * function, and notifies connected clients of the tool list change.
   *
   * @returns The names of tools registered by the domain.
   */
  async loadDomain(domain: DomainName): Promise<string[]> {
    if (this.loadedDomains.has(domain)) {
      return [];
    }

    const server = this.serverRef;
    if (server === null) {
      throw new Error('DomainRegistry: server not set. Call setServer() first.');
    }

    const domainModule = await this.importDomain(domain);
    domainModule.register(server);
    this.loadedDomains.add(domain);

    server.sendToolListChanged();

    return this.getToolNamesForDomain(domain);
  }

  /**
   * Returns the known tool names for a given domain.
   */
  getToolNamesForDomain(domain: DomainName): string[] {
    return DOMAIN_TOOLS[domain] ?? [];
  }

  /** Returns all currently loaded domain names. */
  getLoadedDomains(): DomainName[] {
    return [...this.loadedDomains];
  }

  /** Checks whether a specific domain has been loaded. */
  isDomainLoaded(domain: DomainName): boolean {
    return this.loadedDomains.has(domain);
  }

  /**
   * Resets the registry state. Primarily useful for testing.
   */
  reset(): void {
    this.loadedDomains.clear();
    this.serverRef = null;
  }

  /**
   * Dynamically imports a domain module by name.
   */
  private async importDomain(domain: DomainName): Promise<DomainModule> {
    const modulePath = MODULE_MAP[domain];
    return import(modulePath) as Promise<DomainModule>;
  }
}

/** Singleton DomainRegistry instance. */
export const domainRegistry = new DomainRegistry();
