/**
 * Domain names. Kept in a dependency-free module so config validation can
 * use them without importing the registry (and, through it, the SDK).
 */

/** All supported domain names. */
export const DOMAIN_NAMES = ['student', 'financial_aid', 'finance', 'hr', 'ethos'] as const;

export type DomainName = (typeof DOMAIN_NAMES)[number];

/** Type guard for DomainName. */
export function isDomainName(value: string): value is DomainName {
  return (DOMAIN_NAMES as readonly string[]).includes(value);
}
