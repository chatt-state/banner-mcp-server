import { describe, it, expect, beforeEach } from 'vitest';
import { domainRegistry, DOMAIN_NAMES } from './registry.js';

describe('DomainRegistry', () => {
  beforeEach(() => {
    domainRegistry.reset();
  });

  it('should have all expected domain names', () => {
    expect(DOMAIN_NAMES).toContain('student');
    expect(DOMAIN_NAMES).toContain('financial_aid');
    expect(DOMAIN_NAMES).toContain('finance');
    expect(DOMAIN_NAMES).toContain('hr');
    expect(DOMAIN_NAMES).toContain('ethos');
  });

  it('should start with no loaded domains', () => {
    expect(domainRegistry.getLoadedDomains()).toEqual([]);
  });

  it('should report domain as not loaded initially', () => {
    expect(domainRegistry.isDomainLoaded('student')).toBe(false);
  });

  it('should throw if server not set', async () => {
    await expect(domainRegistry.loadDomain('student')).rejects.toThrow('server not set');
  });

  it('should return known tool names for student domain', () => {
    const tools = domainRegistry.getToolNamesForDomain('student');
    expect(tools).toContain('banner_persons_search');
    expect(tools).toContain('banner_persons_get');
    expect(tools).toContain('banner_students_search');
  });

  it('should return empty tool names for unimplemented domains', () => {
    expect(domainRegistry.getToolNamesForDomain('finance')).toEqual([]);
    expect(domainRegistry.getToolNamesForDomain('hr')).toEqual([]);
  });
});
