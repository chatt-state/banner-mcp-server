import { describe, it, expect, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
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
      // criteria keys are model-chosen: structure only, GUIDs kept.
      criteria: {
        code: '[redacted]',
        person: { id: 'c2f2ba8a-0000-0000-0000-000000000001', ssn: '[redacted]' },
      },
    });
  });

  it('fingerprints free-form payloads instead of logging them', () => {
    const out = sanitizeArgs({
      resource: 'persons',
      data: { names: [{ firstName: 'Ada' }] },
      query: '{ persons12(filter: {credentials: "A00123456"}) { edges { node { id } } } }',
    }) as Record<string, string>;
    expect(out['resource']).toBe('persons');
    // Object payloads: key structure only. String payloads: keyed fingerprint.
    expect(out['data']).toEqual({ names: [{ firstName: '[redacted]' }] });
    expect(out['query']).toMatch(/^\[redacted hmac:[0-9a-f]{12} len=\d+\]$/);
    expect(JSON.stringify(out)).not.toContain('A00123456');
  });

  it('redacts email-looking strings under unexpected keys', () => {
    expect(sanitizeArgs({ search: 'ada@example.edu' })).toEqual({ search: '[redacted]' });
  });

  it('redacts emails and Banner IDs inside arrays and under any key', () => {
    const out = sanitizeArgs({
      contacts: ['jdoe@chattanoogastate.edu', 'ok'],
      studentId: 'A00123456',
      nested: { list: [['B12345678']] },
    });
    expect(out).toEqual({
      contacts: ['[redacted]', 'ok'],
      studentId: '[redacted]',
      nested: { list: [['[redacted]']] },
    });
    expect(sanitizeArgs('x@y.edu')).toBe('[redacted]');
    // Term codes and resource names are not identifiers.
    expect(sanitizeArgs({ code: '202680', resource: 'persons' })).toEqual({
      code: '202680',
      resource: 'persons',
    });
  });

  it('logs only the structure of generic criteria (no identity-document numbers)', () => {
    const out = sanitizeArgs({
      resource: 'persons',
      criteria: {
        identityDocuments: [{ documentId: '123456789' }],
        contacts: ['jdoe@chattanoogastate.edu'],
        studentId: 'A00123456',
        flag: true,
      },
    });
    const text = JSON.stringify(out);
    for (const secret of ['123456789', 'jdoe@chattanoogastate.edu', 'A00123456']) {
      expect(text).not.toContain(secret);
    }
    expect(out).toEqual({
      resource: 'persons',
      criteria: {
        identityDocuments: [{ documentId: '[redacted]' }],
        contacts: ['[redacted]'],
        studentId: '[redacted]',
        flag: true,
      },
    });
    // Identity-document keys are redacted outside criteria too.
    expect(sanitizeArgs({ documentId: 'X1', identityDocuments: [] })).toEqual({
      documentId: '[redacted]',
      identityDocuments: '[redacted]',
    });
  });

  it('fingerprints string payloads with a per-process key, not a bare SHA-256', () => {
    const variables = '{"id":"A00123456"}';
    const a = sanitizeArgs({ query: variables }) as Record<string, string>;
    const b = sanitizeArgs({ query: variables }) as Record<string, string>;
    // Comparable within a run...
    expect(a['query']).toBe(b['query']);
    // ...but not the unkeyed digest an attacker could precompute.
    const unkeyed = createHash('sha256').update(variables).digest('hex').slice(0, 12);
    expect(a['query']).not.toContain(unkeyed);
    expect(a['query']).not.toContain('A00123456');
    // Nested sensitive keys inside object payloads are redacted, not hashed.
    expect(sanitizeArgs({ variables: { id: 'A00123456', n: 5 } })).toEqual({
      variables: { id: '[redacted]', n: '[redacted]' },
    });
  });

  it('masks identifiers in REST paths and drops query strings', () => {
    expect(redactPath('/StudentApi/api/students/A00123456/holds?term=202680')).toBe(
      '/StudentApi/api/[seg]/[seg]/[seg]?[query]',
    );
    expect(redactPath('/api/c2f2ba8a-1111-2222-3333-444444444444/x')).toBe('/api/[id]/[seg]');
    expect(sanitizeArgs({ path: '/StudentApi/api/x/ada@example.edu' })).toEqual({
      path: '/StudentApi/api/[seg]/[seg]',
    });
    // A surname as a path parameter is not logged.
    expect(redactPath('/StudentApi/api/persons/lastname/Smith')).not.toContain('Smith');
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
