import { describe, it, expect } from 'vitest';
import { pageEnvelope, projectFields, renderPayload } from './output.js';

describe('projectFields', () => {
  const rec = {
    id: 'g1',
    names: [
      { firstName: 'Ada', lastName: 'Lovelace', type: { category: 'legal' } },
      { firstName: 'A', lastName: 'L', type: { category: 'personal' } },
    ],
    credentials: [{ type: 'bannerId', value: 'A001' }],
    dateOfBirth: '1815-12-10',
    metadata: { createdOn: 'x' },
  };

  it('returns the record unchanged without fields', () => {
    expect(projectFields(rec)).toBe(rec);
    expect(projectFields(rec, [])).toBe(rec);
  });

  it('keeps id and the requested paths, mapping through arrays', () => {
    expect(projectFields(rec, ['names.lastName', 'names.type.category', 'credentials'])).toEqual({
      id: 'g1',
      names: [
        { lastName: 'Lovelace', type: { category: 'legal' } },
        { lastName: 'L', type: { category: 'personal' } },
      ],
      credentials: [{ type: 'bannerId', value: 'A001' }],
    });
  });

  it('ignores missing paths', () => {
    expect(projectFields(rec, ['nope', 'names.nope'])).toEqual({ id: 'g1' });
  });

  it('keeps array alignment when some elements lack a field', () => {
    const r = { id: 'x', emails: [{ address: 'a' }, { type: 't' }, { address: 'c' }] };
    expect(projectFields(r, ['emails.address'])).toEqual({
      id: 'x',
      emails: [{ address: 'a' }, {}, { address: 'c' }],
    });
  });

  it('ignores prototype-polluting paths', () => {
    const out = projectFields(rec, ['__proto__.polluted', 'constructor']) as object;
    expect(out).toEqual({ id: 'g1' });
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('renderPayload', () => {
  it('emits compact JSON', () => {
    const r = renderPayload({ a: 1, b: [1, 2] }, 1000);
    expect(r).toEqual({ text: '{"a":1,"b":[1,2]}', truncated: false });
  });

  it('trims page envelopes to whole records with an explicit notice', () => {
    const data = Array.from({ length: 50 }, (_, i) => ({ id: `id-${i}`, pad: 'x'.repeat(200) }));
    const env = pageEnvelope({ data, totalCount: 500, offset: 100, hasMore: true });
    const r = renderPayload(env, 3000);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(3000);
    const parsed = JSON.parse(r.text) as {
      data: unknown[];
      count: number;
      nextOffset: number;
      truncation: { truncated: boolean; notice: string };
    };
    expect(parsed.data.length).toBeGreaterThan(0);
    expect(parsed.data.length).toBeLessThan(50);
    expect(parsed.count).toBe(parsed.data.length);
    expect(parsed.nextOffset).toBe(100 + parsed.data.length);
    expect(parsed.truncation.truncated).toBe(true);
    expect(parsed.truncation.notice).toMatch(/BANNER_MAX_RESPONSE_CHARS/);
    expect(parsed.truncation.notice).toMatch(/Narrow the query/);
  });

  it('cuts non-page payloads and appends a notice, staying under the cap', () => {
    const r = renderPayload({ blob: 'y'.repeat(10_000) }, 2500);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(2500);
    expect(r.text).toContain('[TRUNCATED]');
    expect(r.text).toContain('Narrow the query');
  });
});

describe('pageEnvelope', () => {
  it('adds nextOffset when more rows exist and applies fields', () => {
    const env = pageEnvelope(
      { data: [{ id: 'a', x: 1, y: 2 }], totalCount: 3, offset: 0, hasMore: true },
      ['x'],
    );
    expect(env).toEqual({
      totalCount: 3,
      offset: 0,
      count: 1,
      hasMore: true,
      nextOffset: 1,
      data: [{ id: 'a', x: 1 }],
    });
  });
});
