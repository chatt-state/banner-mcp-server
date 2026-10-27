/**
 * Domain registry for MCP tool registration.
 *
 * Each McpServer (one per stdio process, one per HTTP session) owns its own
 * DomainRegistry. Domains are registered on demand; the tool names reported
 * for a domain are the names it actually registered (captured by the
 * ToolRegistrar), so they cannot drift from the code.
 */

import type { ToolRegistrar } from '../tools/define.js';
import { DOMAIN_NAMES, type DomainName } from './names.js';
import { register as registerStudent } from './student/index.js';
import { register as registerFinancialAid } from './financial-aid/index.js';
import { register as registerFinance } from './finance/index.js';
import { register as registerHr } from './hr/index.js';
import { register as registerEthos } from './ethos/index.js';

export { DOMAIN_NAMES, type DomainName } from './names.js';

/** Interface that each domain module implements. */
export type DomainRegisterFn = (reg: ToolRegistrar) => void;

/** Domain name to register function. */
export const DOMAIN_MODULES: Record<DomainName, DomainRegisterFn> = {
  student: registerStudent,
  financial_aid: registerFinancialAid,
  finance: registerFinance,
  hr: registerHr,
  ethos: registerEthos,
};

/** One-line description per domain, used by banner_navigate. */
export const DOMAIN_DESCRIPTIONS: Record<DomainName, string> = {
  student:
    'person lookup by Banner ID/email/name, student context, persons, students, courses, sections, registrations, academic periods',
  financial_aid: 'financial aid applications and student awards',
  finance: 'accounting strings and ledger activities',
  hr: 'employees, positions and jobs',
  ethos: 'generic EEDM get/list/filter, QAPI search, GraphQL (writes only when enabled)',
};

/**
 * Registry that manages lazy registration of domain tool sets on one server.
 */
export class DomainRegistry {
  private readonly loaded = new Map<DomainName, string[]>();

  constructor(
    private readonly registrar: ToolRegistrar,
    private readonly modules: Record<DomainName, DomainRegisterFn> = DOMAIN_MODULES,
  ) {}

  /**
   * Registers a domain's tools. Returns the tool names it registered, or an
   * empty array if it was already loaded.
   */
  loadDomain(domain: DomainName): string[] {
    if (this.loaded.has(domain)) return [];
    const register = this.modules[domain];
    if (!register) throw new Error(`Unknown domain "${domain}"`);
    const mark = this.registrar.registered.length;
    register(this.registrar);
    const names = this.registrar.namesSince(mark);
    this.loaded.set(domain, names);
    if (this.registrar.server.isConnected()) {
      this.registrar.server.sendToolListChanged();
    }
    return names;
  }

  /** Tool names registered by a loaded domain (empty if not loaded). */
  getToolNamesForDomain(domain: DomainName): string[] {
    return [...(this.loaded.get(domain) ?? [])];
  }

  /** Map of loaded domain to its tool names. */
  getToolsByDomain(): Partial<Record<DomainName, string[]>> {
    return Object.fromEntries([...this.loaded].map(([d, names]) => [d, [...names]]));
  }

  /** Returns all currently loaded domain names. */
  getLoadedDomains(): DomainName[] {
    return [...this.loaded.keys()];
  }

  /** Domains not yet loaded. */
  getAvailableDomains(): DomainName[] {
    return DOMAIN_NAMES.filter((d) => !this.loaded.has(d));
  }

  /** Checks whether a specific domain has been loaded. */
  isDomainLoaded(domain: DomainName): boolean {
    return this.loaded.has(domain);
  }
}
