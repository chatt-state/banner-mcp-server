/**
 * Behavior tests for the multi-call student handlers: exact term and person
 * verification, registration ordering, term search and subject sections.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { MAX_REGISTRATIONS, searchAcademicPeriods } from './handlers.js';
import {
  callTool,
  connect,
  criteriaOf,
  json,
  makeConfig,
  mockFetch,
  person,
  testDeps,
  type RecordedRequest,
} from '../../testing/helpers.js';

const P1 = '11111111-1111-1111-1111-111111111111';
const P2 = '11111111-1111-1111-1111-111111111112';
const SEC_OLD = '33333333-3333-3333-3333-333333333331';
const SEC_NEW = '33333333-3333-3333-3333-333333333332';
const T_WRONG = '44444444-4444-4444-4444-444444444440';
const T_OLD = '44444444-4444-4444-4444-444444444441';
const T_NEW = '44444444-4444-4444-4444-444444444442';

type Loose = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const d = (r: { data: unknown }) => r.data as Loose;

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Serves `rows` honoring offset/limit, with x-total-count. */
function paged(req: RecordedRequest, rows: unknown[]): Response {
  const offset = Number(req.url.searchParams.get('offset') ?? 0);
  const limit = Number(req.url.searchParams.get('limit') ?? 25);
  return json(rows.slice(offset, offset + limit), rows.length);
}

describe('term code resolution', () => {
  it('rejects a non-matching term instead of using the first row', async () => {
    const { requests } = mockFetch((req) => {
      if (req.url.pathname === '/api/academic-periods') {
        // The tenant ignored the code criteria and returned some other term.
        return json([{ id: T_WRONG, code: '201010', title: 'Fall 2010' }], 1);
      }
      if (req.url.pathname === `/api/persons/${P1}`) return json(person(P1, 'A1', 'A', 'B'));
      return json([], 0);
    });
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const regs = await callTool(client, 'banner_section_registrations_search', {
      registrantId: P1,
      academicPeriodCode: '202680',
    });
    expect(regs.isError).toBe(true);
    expect(regs.text).toContain('202680');
    const secs = await callTool(client, 'banner_sections_search', { academicPeriodCode: '202680' });
    expect(secs.isError).toBe(true);
    const ctx = await callTool(client, 'banner_student_context', {
      personId: P1,
      academicPeriodCode: '202680',
    });
    expect(ctx.isError).toBe(true);
    const paths = requests.map((r) => r.url.pathname);
    expect(paths).not.toContain('/api/section-registrations');
    expect(paths).not.toContain('/api/sections');
    expect(requests.map((r) => r.url.search).join(' ')).not.toContain(T_WRONG);
  });
});

describe('exact person lookups are verified', () => {
  it('drops persons whose Banner ID does not match (ignored filter)', async () => {
    mockFetch((req) =>
      req.url.pathname === '/api/persons'
        ? json(
            [person(P1, 'A00999999', 'Zed', 'Other'), person(P2, 'A00123456', 'Ada', 'Lovelace')],
            5000,
          )
        : undefined,
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_person_lookup', { bannerId: 'a00123456' });
    expect(res.isError).toBe(false);
    expect(d(res).data.map((p: Loose) => p.id)).toEqual([P2]);
    expect(d(res).filterIgnored).toBe(true);
    expect(d(res).droppedRows).toBe(1);
    expect(d(res).hasMore).toBe(false);
    expect(d(res).totalCount).toBeUndefined();
    expect(d(res).warning).toMatch(/does not match/);
    expect(res.text).not.toContain('Zed');
  });

  it('verifies email matches case-insensitively', async () => {
    mockFetch((req) =>
      req.url.pathname === '/api/persons'
        ? json([person(P1, 'A1', 'Zed', 'Other'), person(P2, 'A2', 'Ada', 'Lovelace')], 2)
        : undefined,
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_person_lookup', { email: 'ADA@example.edu' });
    expect(d(res).data.map((p: Loose) => p.id)).toEqual([P2]);
    expect(d(res).filterIgnored).toBe(true);
  });

  it('does not flag a filter that was honored', async () => {
    mockFetch((req) =>
      req.url.pathname === '/api/persons'
        ? json([person(P2, 'A00123456', 'Ada', 'Lovelace')], 1)
        : undefined,
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_person_lookup', { bannerId: 'A00123456' });
    expect(d(res).filterIgnored).toBeUndefined();
    expect(d(res).totalCount).toBe(1);
  });

  it('student context does not treat an unrelated single row as the person', async () => {
    const { requests } = mockFetch((req) =>
      req.url.pathname === '/api/persons'
        ? json([person(P1, 'A00999999', 'Zed', 'Other')], 1)
        : json([], 0),
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_student_context', { bannerId: 'A00123456' });
    expect(d(res).found).toBe(false);
    expect(d(res).warning).toMatch(/does not match/);
    expect(requests.map((r) => r.url.pathname)).not.toContain('/api/section-registrations');
  });
});

describe('student context registrations', () => {
  function regRow(i: number, section: string, date: string) {
    return {
      id: `r-${i}`,
      registrant: { id: P1 },
      section: { id: section },
      status: { registrationStatus: 'registered' },
      originallyRegisteredOn: date,
    };
  }

  function ctxRoutes(regs: unknown[]) {
    return (req: RecordedRequest): Response | undefined => {
      const p = req.url.pathname;
      if (p === `/api/persons/${P1}`) return json(person(P1, 'A00123456', 'Ada', 'Lovelace'));
      if (p === '/api/students') return json([], 0);
      if (p === '/api/section-registrations') return paged(req, regs);
      if (p === `/api/sections/${SEC_OLD}`) {
        return json({ id: SEC_OLD, code: 'MATH-1130-01', academicPeriod: { id: T_OLD } });
      }
      if (p === `/api/sections/${SEC_NEW}`) {
        return json({ id: SEC_NEW, code: 'BIOL-1110-01', academicPeriod: { id: T_NEW } });
      }
      if (p === `/api/academic-periods/${T_OLD}`) {
        return json({ id: T_OLD, code: '202580', title: 'Fall 2025', startOn: '2025-08-20' });
      }
      if (p === `/api/academic-periods/${T_NEW}`) {
        return json({ id: T_NEW, code: '202680', title: 'Fall 2026', startOn: '2026-08-20' });
      }
      if (p === '/api/academic-periods') {
        return json([{ id: T_NEW, code: '202680', title: 'Fall 2026', startOn: '2026-08-20' }], 1);
      }
      return undefined;
    };
  }

  it('reads past 200 rows before sorting, so the newest term is kept', async () => {
    // Oldest first: 240 old rows, then 10 rows in the newest term.
    const regs = [
      ...Array.from({ length: 240 }, (_, i) => regRow(i, SEC_OLD, '2025-08-01')),
      ...Array.from({ length: 10 }, (_, i) => regRow(240 + i, SEC_NEW, '2026-08-01')),
    ];
    mockFetch(ctxRoutes(regs));
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_student_context', { personId: P1 });
    const r = d(res).registrations;
    expect(r.totalRead).toBe(250);
    expect(r.cappedAt).toBeUndefined();
    expect(r.byTerm[0].term.code).toBe('202680');
    expect(r.byTerm[0].registrations).toHaveLength(10);
  });

  it('says the cap was applied before ordering when it is hit', async () => {
    // Sections that do not resolve (404) keep the response small.
    const regs = Array.from({ length: MAX_REGISTRATIONS + 50 }, (_, i) =>
      regRow(i, `99999999-0000-0000-0000-${String(i % 50).padStart(12, '0')}`, '2025-08-01'),
    );
    mockFetch(ctxRoutes(regs));
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_student_context', { personId: P1 });
    const r = d(res).registrations;
    expect(r.cappedAt).toBe(MAX_REGISTRATIONS);
    expect(r.capNote).toMatch(/before sorting/);
  });

  it('echoes the requested term and says when there are no registrations in it', async () => {
    mockFetch(ctxRoutes([]));
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_student_context', {
      personId: P1,
      academicPeriodCode: '202680',
    });
    expect(d(res).requestedTerm).toMatchObject({ id: T_NEW, code: '202680', title: 'Fall 2026' });
    expect(d(res).registeredInRequestedTerm).toBe(false);
    expect(d(res).registrationRowsInRequestedTerm).toBe(0);
    expect(d(res).registrations.totalRead).toBe(0);
  });

  it('never reports another term when the term filter is ignored', async () => {
    mockFetch(ctxRoutes([regRow(1, SEC_OLD, '2025-08-01'), regRow(2, SEC_NEW, '2026-08-01')]));
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_student_context', {
      personId: P1,
      academicPeriodCode: '202680',
    });
    expect(d(res).registrations.byTerm.map((g: Loose) => g.term.code)).toEqual(['202680']);
    expect(d(res).registrations.otherTermRowsIgnored).toBe(1);
    expect(d(res).registeredInRequestedTerm).toBe(true);
  });
});

describe('academic period search', () => {
  const periods = [
    { id: 'p1', code: '202580', title: 'Fall 2025', startOn: '2025-08-20', endOn: '2025-12-10' },
    { id: 'p2', code: '202610', title: 'Spring 2026', startOn: '2026-01-10', endOn: '2026-05-05' },
    { id: 'p3', code: '202680', title: 'Fall 2026', startOn: '2026-08-20', endOn: '2026-12-10' },
    {
      id: 'p4',
      code: '202680-1',
      title: 'Fall 2026 First Half',
      startOn: '2026-08-21',
      endOn: '2026-10-10',
      category: { type: 'subterm' },
    },
    { id: 'p5', code: '202710', title: 'Spring 2027', startOn: '2027-01-10', endOn: '2027-05-05' },
  ];
  const route = (req: RecordedRequest) =>
    req.url.pathname === '/api/academic-periods' ? paged(req, periods) : undefined;

  it('turns a title into term codes', async () => {
    const { requests } = mockFetch(route);
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_academic_periods_get', { title: 'FALL 2026' });
    expect(d(res).data.map((t: Loose) => t.code)).toEqual(['202680-1', '202680']);
    expect(d(res).data[0].category).toBe('subterm');
    expect(d(res).scanned).toBe(5);
    expect(criteriaOf(requests[0]!)).toBeUndefined();
  });

  it('lists current and upcoming terms soonest first', async () => {
    mockFetch(route);
    const ethos = testDeps(makeConfig()).ethos();
    const upcoming = await searchAcademicPeriods(ethos, {
      currentAndUpcoming: true,
      today: '2026-10-27',
    });
    expect(upcoming.data.map((t) => t.code)).toEqual(['202680', '202710']);
    const fall = await searchAcademicPeriods(ethos, {
      title: 'fall',
      currentAndUpcoming: true,
      today: '2026-09-01',
    });
    expect(fall.data.map((t) => t.code)).toEqual(['202680', '202680-1']);
  });

  it('returns only an exact code match', async () => {
    mockFetch((req) =>
      req.url.pathname === '/api/academic-periods'
        ? json([{ id: T_WRONG, code: '201010', title: 'Fall 2010' }], 1)
        : undefined,
    );
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_academic_periods_get', { code: '202680' });
    expect(d(res).data).toEqual([]);
    expect(d(res).filterIgnored).toBe(true);
  });
});

describe('sections by subject', () => {
  const SUBJ_BIOL = '55555555-5555-5555-5555-555555555551';
  const SUBJ_MATH = '55555555-5555-5555-5555-555555555552';
  const C_BIOL = '66666666-6666-6666-6666-666666666661';
  const C_BIOL2 = '66666666-6666-6666-6666-666666666662';
  const C_MATH = '66666666-6666-6666-6666-666666666663';

  function routes(req: RecordedRequest): Response | undefined {
    const p = req.url.pathname;
    if (p === '/api/academic-periods') {
      return json([{ id: T_NEW, code: '202680', title: 'Fall 2026' }], 1);
    }
    if (p === '/api/subjects') {
      return paged(req, [
        { id: SUBJ_MATH, abbreviation: 'MATH', title: 'Mathematics' },
        { id: SUBJ_BIOL, abbreviation: 'BIOL', title: 'Biology' },
      ]);
    }
    if (p === '/api/courses') {
      const c = criteriaOf(req) as { number?: string };
      const all = [
        { id: C_BIOL, subject: { id: SUBJ_BIOL }, number: '1110', title: 'Gen Bio I' },
        { id: C_BIOL2, subject: { id: SUBJ_BIOL }, number: '2010', title: 'Anatomy I' },
        // Returned although it is not BIOL: must be ignored.
        { id: C_MATH, subject: { id: SUBJ_MATH }, number: '1130', title: 'Algebra' },
      ];
      return paged(
        req,
        all.filter((x) => !c.number || x.number === c.number),
      );
    }
    if (p === '/api/sections') {
      const c = criteriaOf(req) as { course: { id: string } };
      const all = [
        { id: 's1', code: 'BIOL-1110-01', course: { id: C_BIOL }, academicPeriod: { id: T_NEW } },
        { id: 's2', code: 'BIOL-1110-02', course: { id: C_BIOL }, academicPeriod: { id: T_NEW } },
        // Other term: must be dropped even if Ethos returns it.
        { id: 's3', code: 'BIOL-1110-01', course: { id: C_BIOL }, academicPeriod: { id: T_OLD } },
        { id: 's4', code: 'BIOL-2010-01', course: { id: C_BIOL2 }, academicPeriod: { id: T_NEW } },
        { id: 's5', code: 'MATH-1130-01', course: { id: C_MATH }, academicPeriod: { id: T_NEW } },
      ];
      return json(all.filter((s) => s.course.id === c.course.id));
    }
    return undefined;
  }

  it('answers "which BIOL sections run in 202680?" in one call', async () => {
    const { requests } = mockFetch(routes);
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_sections_search', {
      subject: 'biol',
      academicPeriodCode: '202680',
    });
    expect(res.isError).toBe(false);
    expect(d(res).subject).toMatchObject({ id: SUBJ_BIOL, abbreviation: 'BIOL' });
    expect(d(res).data.map((s: Loose) => s.id)).toEqual(['s1', 's2', 's4']);
    expect(d(res).data[0]).toMatchObject({ code: 'BIOL-1110-01', courseId: C_BIOL });
    expect(d(res).coursesMatched).toBe(2);
    expect(d(res).notes.join(' ')).toMatch(/not in subject BIOL/);
    const courseReq = requests.find((r) => r.url.pathname === '/api/courses')!;
    expect(criteriaOf(courseReq)).toEqual({ subject: { id: SUBJ_BIOL } });
    const secReqs = requests.filter((r) => r.url.pathname === '/api/sections');
    expect(secReqs).toHaveLength(2);
    expect(secReqs.map(criteriaOf)).toEqual(
      expect.arrayContaining([
        { course: { id: C_BIOL }, academicPeriod: { id: T_NEW } },
        { course: { id: C_BIOL2 }, academicPeriod: { id: T_NEW } },
      ]),
    );
  });

  it('narrows to one course number', async () => {
    mockFetch(routes);
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const res = await callTool(client, 'banner_sections_search', {
      subject: 'BIOL',
      courseNumber: '2010',
      academicPeriodCode: '202680',
    });
    expect(d(res).data.map((s: Loose) => s.id)).toEqual(['s4']);
  });

  it('validates subject combinations', async () => {
    const { requests } = mockFetch(routes);
    const { client } = await connect(makeConfig({ BANNER_PRELOAD_DOMAINS: 'student' }));
    const noSubject = await callTool(client, 'banner_sections_search', { courseNumber: '1110' });
    expect(noSubject.isError).toBe(true);
    const withKeyword = await callTool(client, 'banner_sections_search', {
      subject: 'BIOL',
      keyword: 'bio',
    });
    expect(withKeyword.isError).toBe(true);
    expect(requests).toHaveLength(0);
    const unknown = await callTool(client, 'banner_sections_search', { subject: 'XYZ' });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toContain('XYZ');
  });
});
