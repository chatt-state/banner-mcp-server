import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  buildPersonLookupCriteria,
  buildRegistrationCriteria,
  buildSectionCriteria,
  personRefCriteria,
} from './criteria.js';
import { summarizePerson } from './summaries.js';
import { mapLimit } from './handlers.js';
import {
  callTool,
  connect,
  criteriaOf,
  json,
  makeConfig,
  mockFetch,
  person,
  type RecordedRequest,
} from '../../testing/helpers.js';

const P1 = '11111111-1111-1111-1111-111111111111';
const S1 = '22222222-2222-2222-2222-222222222222';
const SEC_OLD = '33333333-3333-3333-3333-333333333331';
const SEC_NEW = '33333333-3333-3333-3333-333333333332';
const T_OLD = '44444444-4444-4444-4444-444444444441';
const T_NEW = '44444444-4444-4444-4444-444444444442';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildPersonLookupCriteria', () => {
  it('builds the Banner ID credential criteria', () => {
    expect(buildPersonLookupCriteria({ bannerId: ' A00123456 ' })).toEqual({
      mode: 'bannerId',
      criteria: { credentials: [{ type: 'bannerId', value: 'A00123456' }] },
    });
  });

  it('builds the email criteria', () => {
    expect(buildPersonLookupCriteria({ email: 'ada@example.edu' })).toEqual({
      mode: 'email',
      criteria: { emails: [{ address: 'ada@example.edu' }] },
    });
  });

  it('builds the name criteria', () => {
    expect(buildPersonLookupCriteria({ firstName: 'Ada', lastName: 'Lovelace' })).toEqual({
      mode: 'name',
      criteria: { names: [{ lastName: 'Lovelace', firstName: 'Ada' }] },
    });
    expect(buildPersonLookupCriteria({ lastName: 'Lovelace' }).criteria).toEqual({
      names: [{ lastName: 'Lovelace' }],
    });
  });

  it('requires exactly one mode', () => {
    expect(() => buildPersonLookupCriteria({})).toThrow('exactly one');
    expect(() => buildPersonLookupCriteria({ bannerId: 'A1', email: 'a@b.co' })).toThrow(
      'exactly one',
    );
    expect(() => buildPersonLookupCriteria({ firstName: 'Ada' })).toThrow('lastName');
    expect(() => buildPersonLookupCriteria({ email: 'not-an-email' })).toThrow('email');
    expect(() => buildPersonLookupCriteria({ bannerId: 'A1"}' })).toThrow('bannerId');
  });
});

describe('other criteria builders', () => {
  it('build EEDM reference shapes', () => {
    expect(personRefCriteria(P1)).toEqual({ person: { id: P1 } });
    expect(personRefCriteria()).toBeUndefined();
    expect(buildSectionCriteria({ academicPeriodId: T_NEW, code: 'BIOL-1110-01' })).toEqual({
      academicPeriod: { id: T_NEW },
      code: 'BIOL-1110-01',
    });
    expect(buildSectionCriteria({})).toBeUndefined();
    expect(buildRegistrationCriteria({ registrantId: P1, academicPeriodId: T_NEW })).toEqual({
      registrant: { id: P1 },
      academicPeriod: { id: T_NEW },
    });
  });
});

describe('summarizePerson', () => {
  it('keeps identifying basics and omits DOB and SSN', () => {
    const s = summarizePerson(person(P1, 'A00123456', 'Ada', 'Lovelace') as never);
    expect(s).toEqual({
      id: P1,
      bannerId: 'A00123456',
      name: 'Ada Lovelace',
      emails: [{ type: 'school', address: 'ada@example.edu', preferred: true }],
      roles: ['student'],
    });
    expect(JSON.stringify(s)).not.toContain('000-00-0000');
    expect(JSON.stringify(s)).not.toContain('2000-01-01');
  });

  it('surfaces a restricted privacy status', () => {
    const p = { ...person(P1, 'A1', 'A', 'B'), privacyStatus: { privacyCategory: 'restricted' } };
    expect(summarizePerson(p as never).privacy).toBe('restricted');
  });
});

describe('mapLimit', () => {
  it('preserves order and bounds concurrency', async () => {
    let inFlight = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return n * 2;
    });
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14]);
    expect(peak).toBeLessThanOrEqual(3);
  });
});

describe('banner_person_lookup tool', () => {
  it('sends the bannerId criteria to persons v12 and returns summaries', async () => {
    const { requests } = mockFetch((req) =>
      req.url.pathname === '/api/persons'
        ? json([person(P1, 'A00123456', 'Ada', 'Lovelace')], 1)
        : undefined,
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_person_lookup', { bannerId: 'A00123456' });
    expect(res.isError).toBe(false);
    expect(criteriaOf(requests[0]!)).toEqual({
      credentials: [{ type: 'bannerId', value: 'A00123456' }],
    });
    expect(requests[0]!.url.searchParams.get('limit')).toBe('10');
    expect(res.data['mode']).toBe('bannerId');
    expect(res.data.data).toEqual([expect.objectContaining({ id: P1, bannerId: 'A00123456' })]);
    expect(res.text).not.toContain('dateOfBirth');
  });

  it('sends email and name criteria', async () => {
    const { requests } = mockFetch((req) =>
      req.url.pathname === '/api/persons' ? json([], 0) : undefined,
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    await callTool(client, 'banner_person_lookup', { email: 'ada@example.edu' });
    const res = await callTool(client, 'banner_person_lookup', {
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(criteriaOf(requests[0]!)).toEqual({ emails: [{ address: 'ada@example.edu' }] });
    expect(criteriaOf(requests[1]!)).toEqual({
      names: [{ lastName: 'Lovelace', firstName: 'Ada' }],
    });
    expect(res.data['hint']).toMatch(/No match/);
  });

  it('returns an error for ambiguous input without calling Ethos', async () => {
    const { requests } = mockFetch();
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_person_lookup', {
      bannerId: 'A1',
      email: 'a@b.co',
    });
    expect(res.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe('search tool criteria', () => {
  it('passes person/term filters through to Ethos', async () => {
    const { requests } = mockFetch((req) => {
      if (req.url.pathname === '/api/academic-periods') {
        return json([{ id: T_NEW, code: '202680', title: 'Fall 2026', startOn: '2026-08-20' }], 1);
      }
      return json([], 0);
    });
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student,hr' }));
    await callTool(client, 'banner_students_search', { personId: P1 });
    await callTool(client, 'banner_employees_search', { personId: P1 });
    await callTool(client, 'banner_sections_search', { academicPeriodCode: '202680', code: 'X' });
    await callTool(client, 'banner_section_registrations_search', { registrantId: P1 });

    const byPath = (p: string) => requests.filter((r: RecordedRequest) => r.url.pathname === p);
    expect(criteriaOf(byPath('/api/students')[0]!)).toEqual({ person: { id: P1 } });
    expect(criteriaOf(byPath('/api/employees')[0]!)).toEqual({ person: { id: P1 } });
    expect(criteriaOf(byPath('/api/academic-periods')[0]!)).toEqual({ code: '202680' });
    expect(criteriaOf(byPath('/api/sections')[0]!)).toEqual({
      academicPeriod: { id: T_NEW },
      code: 'X',
    });
    expect(criteriaOf(byPath('/api/section-registrations')[0]!)).toEqual({
      registrant: { id: P1 },
    });
  });

  it('refuses an unfiltered section-registrations listing', async () => {
    const { requests } = mockFetch();
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_section_registrations_search', {});
    expect(res.isError).toBe(true);
    expect(requests).toHaveLength(0);
  });
});

describe('banner_student_context tool', () => {
  function routes(req: RecordedRequest): Response | undefined {
    const p = req.url.pathname;
    if (p === '/api/persons') return json([person(P1, 'A00123456', 'Ada', 'Lovelace')], 1);
    if (p === `/api/persons/${P1}`) return json(person(P1, 'A00123456', 'Ada', 'Lovelace'));
    if (p === '/api/students') return json([{ id: S1, person: { id: P1 }, types: [] }], 1);
    if (p === '/api/section-registrations') {
      return json(
        [
          {
            id: 'r-old',
            registrant: { id: P1 },
            section: { id: SEC_OLD },
            status: {
              registrationStatus: 'registered',
              sectionRegistrationStatusReason: 'registered',
            },
            originallyRegisteredOn: '2025-08-01',
          },
          {
            id: 'r-new',
            registrant: { id: P1 },
            section: { id: SEC_NEW },
            status: {
              registrationStatus: 'notRegistered',
              sectionRegistrationStatusReason: 'dropped',
            },
            originallyRegisteredOn: '2026-08-01',
          },
        ],
        2,
      );
    }
    if (p === `/api/sections/${SEC_OLD}`) {
      return json({
        id: SEC_OLD,
        code: 'MATH-1130-01',
        titles: [{ type: 'long', value: 'College Algebra' }],
        academicPeriod: { id: T_OLD },
        course: { id: 'c' },
        startOn: '2025-08-20',
      });
    }
    if (p === `/api/sections/${SEC_NEW}`) {
      return json({
        id: SEC_NEW,
        code: 'BIOL-1110-01',
        titles: [{ type: 'long', value: 'General Biology I' }],
        academicPeriod: { id: T_NEW },
        course: { id: 'c' },
        startOn: '2026-08-20',
      });
    }
    if (p === `/api/academic-periods/${T_OLD}`) {
      return json({
        id: T_OLD,
        code: '202580',
        title: 'Fall 2025',
        startOn: '2025-08-20',
        endOn: '2025-12-10',
      });
    }
    if (p === `/api/academic-periods/${T_NEW}`) {
      return json({
        id: T_NEW,
        code: '202680',
        title: 'Fall 2026',
        startOn: '2026-08-20',
        endOn: '2026-12-10',
      });
    }
    return undefined;
  }

  it('builds a compact profile grouped by term, newest first', async () => {
    const { requests } = mockFetch(routes);
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_student_context', { bannerId: 'A00123456' });
    expect(res.isError).toBe(false);
    const d = res.data as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.found).toBe(true);
    expect(d.person).toMatchObject({ id: P1, bannerId: 'A00123456', name: 'Ada Lovelace' });
    expect(d.student).toEqual([expect.objectContaining({ id: S1, personId: P1 })]);
    const byTerm = d.registrations.byTerm;
    expect(byTerm.map((g: any) => g.term.code)).toEqual(['202680', '202580']); // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(byTerm[0].registrations[0]).toMatchObject({
      id: 'r-new',
      status: 'notRegistered',
      statusReason: 'dropped',
      section: { id: SEC_NEW, code: 'BIOL-1110-01', title: 'General Biology I' },
    });
    expect(res.text).not.toContain('2000-01-01');

    const regReq = requests.find((r) => r.url.pathname === '/api/section-registrations')!;
    expect(criteriaOf(regReq)).toEqual({ registrant: { id: P1 } });
    const studentReq = requests.find((r) => r.url.pathname === '/api/students')!;
    expect(criteriaOf(studentReq)).toEqual({ person: { id: P1 } });
  });

  it('limits to maxTerms', async () => {
    mockFetch(routes);
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_student_context', { personId: P1, maxTerms: 1 });
    const regs = (res.data as Record<string, any>).registrations; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(regs.termsShown).toBe(1);
    expect(regs.termsOmitted).toBe(1);
  });

  it('reports not found', async () => {
    mockFetch((req) => (req.url.pathname === '/api/persons' ? json([], 0) : undefined));
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_student_context', { bannerId: 'A00000000' });
    expect(res.data['found']).toBe(false);
  });
});
