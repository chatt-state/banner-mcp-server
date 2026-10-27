import { describe, it, expect, afterEach } from 'vitest';
import {
  audit,
  auditEvent,
  redactPath,
  sanitizeArgs,
  setAuditEnabled,
  setAuditSink,
} from './audit.js';

describe('sanitizeArgs', () => {
  it('redacts identifying fields at any depth', () => {
    const out = sanitizeArgs({
      bannerId: 'A00123456',
      email: 'ada@example.edu',
      firstName: 'Ada',
      lastName: 'Lovelace',
      limit: 10,
      criteria: {
        credentials: [{ type: 'bannerId', value: 'A00123456' }],
        names: [{ lastName: 'Lovelace' }],
        code: '202680',
        person: {
          id: 'c2f2ba8a-0000-0000-0000-000000000001',
          ssn: '123-45-6789',
          dateOfBirth: '2000-01-01',
        },
      },
    });
    const text = JSON.stringify(out);
    for (const secret of [
      'A00123456',
      'ada@example.edu',
      'Ada',
      'Lovelace',
      '123-45-6789',
      '2000-01-01',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(out).toMatchObject({
      bannerId: '[redacted]',
      limit: 10,
      criteria: { code: '202680', person: { id: 'c2f2ba8a-0000-0000-0000-000000000001' } },
    });
  });

  it('fingerprints free-form payloads instead of logging them', () => {
    const out = sanitizeArgs({
      resource: 'persons',
      data: { names: [{ firstName: 'Ada' }] },
      query: '{ persons12(filter: {credentials: "A00123456"}) { edges { node { id } } } }',
    }) as Record<string, string>;
    expect(out['resource']).toBe('persons');
    expect(out['data']).toMatch(/^\[redacted sha256:[0-9a-f]{12} len=\d+\]$/);
    expect(out['query']).toMatch(/^\[redacted sha256:/);
    expect(JSON.stringify(out)).not.toContain('A00123456');
  });

  it('redacts email-looking strings under unexpected keys', () => {
    expect(sanitizeArgs({ search: 'ada@example.edu' })).toEqual({ search: '[redacted]' });
  });

  it('masks identifiers in REST paths and drops query strings', () => {
    expect(redactPath('/StudentApi/api/students/A00123456/holds?term=202680')).toBe(
      '/StudentApi/api/students/[id]/holds?[query]',
    );
    expect(redactPath('/api/persons/c2f2ba8a-1111-2222-3333-444444444444')).toBe(
      '/api/persons/[id]',
    );
    expect(sanitizeArgs({ path: '/StudentApi/api/x/ada@example.edu' })).toEqual({
      path: '/StudentApi/api/x/[id]',
    });
  });
});

describe('audit', () => {
  const lines: string[] = [];
  let prev: ((l: string) => void) | undefined;
  afterEach(() => {
    if (prev) setAuditSink(prev);
    setAuditEnabled(true);
    lines.length = 0;
  });

  it('writes one JSON line with sanitized args and metadata', () => {
    prev = setAuditSink((l) => lines.push(l));
    audit({
      tool: 'banner_person_lookup',
      args: { bannerId: 'A00999999' },
      durationMs: 12.7,
      resultCount: 1,
    });
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(rec).toMatchObject({
      type: 'tool_call',
      tool: 'banner_person_lookup',
      args: { bannerId: '[redacted]' },
      durationMs: 13,
      resultCount: 1,
    });
    expect(typeof rec['ts']).toBe('string');
    expect(lines[0]).not.toContain('A00999999');
  });

  it('can be disabled', () => {
    prev = setAuditSink((l) => lines.push(l));
    setAuditEnabled(false);
    audit({ tool: 't', args: {}, durationMs: 1 });
    auditEvent('x');
    expect(lines).toHaveLength(0);
  });
});
