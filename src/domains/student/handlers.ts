/**
 * Handler implementations for student MCP tools that do more than one call.
 */

import {
  NotFoundError,
  type AcademicPeriod,
  type Course,
  type EthosClient,
  type Person,
  type Section,
  type SectionRegistration,
  type Student,
} from 'ellucian-banner';
import { ToolInputError } from '../../middleware/error-handler.js';
import { projectFields } from '../../output.js';
import {
  buildPersonLookupCriteria,
  type PersonLookupInput,
  type PersonLookupMode,
} from './criteria.js';
import {
  summarizePerson,
  summarizeRegistration,
  summarizeSection,
  summarizeStudent,
  summarizeTerm,
  type TermSummary,
} from './summaries.js';

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getOrNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

/**
 * True when `p` really has the Banner ID / email that was looked up. Banner ID
 * and email lookups are exact, so the server checks Ethos's answer itself: a
 * Banner Ethos API version that does not support the filter returns an
 * unfiltered page of unrelated people instead of an error.
 */
export function personMatchesLookup(p: Person, mode: 'bannerId' | 'email', value: string): boolean {
  const wanted = value.trim().toLowerCase();
  if (mode === 'bannerId') {
    return (p.credentials ?? []).some(
      (c) =>
        c.type === 'bannerId' && typeof c.value === 'string' && c.value.toLowerCase() === wanted,
    );
  }
  return (p.emails ?? []).some(
    (e) => typeof e.address === 'string' && e.address.trim().toLowerCase() === wanted,
  );
}

/** Keeps only persons that match an exact lookup; name lookups are returned as-is. */
function verifyLookup(rows: Person[], mode: PersonLookupMode, input: PersonLookupInput) {
  if (mode === 'name') return { rows, dropped: 0 };
  const value = (mode === 'bannerId' ? input.bannerId : input.email) ?? '';
  const kept = rows.filter((p) => personMatchesLookup(p, mode, value));
  return { rows: kept, dropped: rows.length - kept.length };
}

function filterIgnoredWarning(mode: PersonLookupMode, dropped: number): string {
  const what = mode === 'bannerId' ? 'Banner ID' : 'email address';
  return (
    `Ethos returned ${dropped} person(s) whose ${what} does not match; they were removed. ` +
    `This Banner Ethos API version may ignore the ${mode} filter, so a real match can be ` +
    'missing. Do not page through unfiltered persons; try another identifier or ask the Ethos ' +
    'administrator.'
  );
}

/** Looks a person up by Banner ID, email or name and returns compact summaries. */
export async function lookupPerson(
  ethos: EthosClient,
  input: PersonLookupInput & { offset?: number; limit?: number },
) {
  const { mode, criteria } = buildPersonLookupCriteria(input);
  const page = await ethos.persons.filter(criteria, input.offset ?? 0, input.limit ?? 10);
  const { rows, dropped } = verifyLookup(page.data, mode, input);
  const matches = rows.map((p) => summarizePerson(p));
  const filterIgnored = dropped > 0;
  const hasMore = filterIgnored ? false : page.hasMore;
  return {
    mode,
    ...(filterIgnored ? {} : { totalCount: page.totalCount }),
    offset: page.offset,
    count: matches.length,
    hasMore,
    ...(hasMore ? { nextOffset: page.offset + page.data.length } : {}),
    data: matches,
    ...(filterIgnored
      ? { filterIgnored: true, droppedRows: dropped, warning: filterIgnoredWarning(mode, dropped) }
      : {}),
    ...(matches.length === 0
      ? {
          hint:
            mode === 'name'
              ? 'No match. Name matching may be exact on this Banner version; try lastName only, or a Banner ID/email.'
              : 'No match. Check the value; Banner IDs and emails must match exactly.',
        }
      : {}),
  };
}

/**
 * Resolves an academic period by Banner term code (STVTERM, e.g. "202680").
 * Only an exact code match is accepted: if the tenant ignores the criteria or
 * returns a near match, answering for another term would silently return the
 * wrong term's data.
 */
export async function resolveTermByCode(ethos: EthosClient, code: string): Promise<AcademicPeriod> {
  const wanted = code.trim();
  const page = await ethos.academicPeriods.filter({ code: wanted }, 0, 5);
  const match = page.data.find((p) => p.code === wanted);
  if (!match) {
    throw new ToolInputError(
      `No academic period with code "${wanted}". Use banner_academic_periods_get (title or ` +
        'currentAndUpcoming) to find the right term code.',
    );
  }
  return match;
}

/** Cap on academic periods scanned by a title / current-term search. */
export const MAX_PERIOD_SCAN = 2000;

export interface AcademicPeriodSearchInput {
  /** Case-insensitive; every word must appear in the title (e.g. "fall 2026"). */
  title?: string;
  /** Only periods that have not ended (endOn >= today), soonest first. */
  currentAndUpcoming?: boolean;
  limit?: number;
  /** ISO date used as "today" (tests). */
  today?: string;
}

/**
 * Finds academic periods by title words and/or "current and upcoming", by
 * scanning the academic-periods collection client-side (bounded). Ethos has
 * no reliable title filter, so the model would otherwise have to guess a term
 * code or page blindly through decades of terms.
 */
export async function searchAcademicPeriods(ethos: EthosClient, input: AcademicPeriodSearchInput) {
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const words = (input.title ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const all: AcademicPeriod[] = [];
  let capped = false;
  for await (const batch of ethos.academicPeriods.getAll(100)) {
    all.push(...batch);
    if (all.length >= MAX_PERIOD_SCAN) {
      capped = true;
      all.length = MAX_PERIOD_SCAN;
      break;
    }
  }
  let matches = all.filter((p) => {
    const title = (p.title ?? '').toLowerCase();
    if (!words.every((w) => title.includes(w))) return false;
    if (input.currentAndUpcoming && (p.endOn ?? '') < today) return false;
    return true;
  });
  // Upcoming: soonest first. Title search: most recent first.
  matches = matches.sort((a, b) =>
    input.currentAndUpcoming
      ? (a.startOn ?? '').localeCompare(b.startOn ?? '')
      : (b.startOn ?? '').localeCompare(a.startOn ?? ''),
  );
  const limit = input.limit ?? 25;
  const shown = matches.slice(0, limit).map(summarizeTerm);
  return {
    scanned: all.length,
    ...(capped ? { scanCapped: MAX_PERIOD_SCAN } : {}),
    offset: 0,
    totalMatches: matches.length,
    count: shown.length,
    hasMore: matches.length > shown.length,
    data: shown,
    ...(input.currentAndUpcoming ? { today } : {}),
    ...(shown.length === 0
      ? { hint: 'No matching term. Try fewer title words (e.g. "fall 2026" or "2026").' }
      : {}),
  };
}

/** Cap on subjects scanned to resolve a subject abbreviation. */
export const MAX_SUBJECT_SCAN = 2000;
/** Cap on catalog courses read for one subject. */
export const MAX_COURSE_SCAN = 500;
/** Cap on courses whose sections are listed in one subject search. */
export const MAX_SUBJECT_COURSES = 60;

interface Subject {
  id: string;
  abbreviation?: string;
  title?: string;
}

/** Resolves a subject abbreviation (e.g. "BIOL") to its EEDM subjects record. */
export async function resolveSubject(ethos: EthosClient, abbreviation: string): Promise<Subject> {
  const wanted = abbreviation.trim().toUpperCase();
  let scanned = 0;
  for await (const batch of ethos.getAll<Subject>('subjects', 100)) {
    const hit = batch.find((s) => (s.abbreviation ?? '').toUpperCase() === wanted);
    if (hit) return hit;
    scanned += batch.length;
    if (scanned >= MAX_SUBJECT_SCAN) break;
  }
  throw new ToolInputError(`No subject with abbreviation "${wanted}".`);
}

export interface SectionsBySubjectInput {
  subject: string;
  courseNumber?: string;
  academicPeriodId?: string;
  code?: string;
  number?: string;
  fields?: readonly string[];
}

/**
 * Lists the sections of one subject (optionally one course number), in one
 * term when academicPeriodId is given: subject abbreviation -> subject GUID ->
 * catalog courses -> sections per course. Every step is checked client-side,
 * so an ignored Ethos filter cannot pull in other subjects or terms.
 */
export async function sectionsBySubject(ethos: EthosClient, input: SectionsBySubjectInput) {
  const subject = await resolveSubject(ethos, input.subject);
  const courseNumber = input.courseNumber?.trim();

  const courseCriteria: Record<string, unknown> = { subject: { id: subject.id } };
  if (courseNumber) courseCriteria['number'] = courseNumber;
  const read: Course[] = [];
  let coursesCapped = false;
  for await (const batch of ethos.courses.filterAll(courseCriteria, 100)) {
    read.push(...batch);
    if (read.length >= MAX_COURSE_SCAN) {
      coursesCapped = true;
      read.length = MAX_COURSE_SCAN;
      break;
    }
  }
  const courses = read.filter(
    (c) => c.subject?.id === subject.id && (!courseNumber || c.number === courseNumber),
  );
  const searched = courses.slice(0, MAX_SUBJECT_COURSES);

  let sectionsCapped = false;
  const perCourse = await mapLimit(searched, 4, async (course) => {
    const criteria: Record<string, unknown> = { course: { id: course.id } };
    if (input.academicPeriodId) criteria['academicPeriod'] = { id: input.academicPeriodId };
    if (input.code) criteria['code'] = input.code;
    if (input.number) criteria['number'] = input.number;
    const page = await ethos.sections.filter(criteria, 0, 100);
    if (page.hasMore) sectionsCapped = true;
    return page.data.filter(
      (s) =>
        s.course?.id === course.id &&
        (!input.academicPeriodId || s.academicPeriod?.id === input.academicPeriodId),
    );
  });
  const sections = perCourse
    .flat()
    .sort((a, b) => (a.code ?? '').localeCompare(b.code ?? '', 'en', { numeric: true }));
  const data =
    input.fields && input.fields.length > 0
      ? sections.map((s) => projectFields(s, input.fields))
      : sections.map(summarizeSection);

  const notes: string[] = [];
  if (read.length > courses.length) {
    notes.push(
      `${read.length - courses.length} course(s) returned by Ethos were not in subject ` +
        `${subject.abbreviation ?? input.subject} and were ignored.`,
    );
  }
  if (coursesCapped) notes.push(`Course read stopped at ${MAX_COURSE_SCAN} rows.`);
  if (courses.length > searched.length) {
    notes.push(
      `Only the first ${MAX_SUBJECT_COURSES} of ${courses.length} courses were searched; add courseNumber.`,
    );
  }
  if (sectionsCapped) notes.push('Some courses have more than 100 sections; only 100 were read.');

  return {
    subject: { id: subject.id, abbreviation: subject.abbreviation, title: subject.title },
    coursesMatched: courses.length,
    coursesSearched: searched.length,
    offset: 0,
    count: data.length,
    hasMore: false,
    data,
    ...(notes.length > 0 ? { notes } : {}),
  };
}

export interface StudentContextInput {
  bannerId?: string;
  personId?: string;
  academicPeriodCode?: string;
  maxTerms?: number;
}

/**
 * Hard ceiling on registration rows read per context call. All rows up to it
 * are read before sorting by recency, so the newest terms are not lost to
 * Ethos's (unspecified) default order.
 */
export const MAX_REGISTRATIONS = 1000;
/** Cap on distinct sections resolved per context call. */
export const MAX_SECTION_LOOKUPS = 40;

/**
 * Builds a compact student profile: person summary, student record(s) and
 * recent section registrations grouped by term with section titles.
 */
export async function studentContext(ethos: EthosClient, input: StudentContextInput) {
  if (!!input.bannerId === !!input.personId) {
    throw new ToolInputError('Provide exactly one of bannerId or personId.');
  }

  // 1. Person
  let person: Person;
  if (input.personId) {
    const p = await getOrNull(() => ethos.persons.get(input.personId!));
    if (!p) return { found: false, message: `No person with GUID ${input.personId}.` };
    person = p;
  } else {
    const lookup = { bannerId: input.bannerId };
    const { mode, criteria } = buildPersonLookupCriteria(lookup);
    const page = await ethos.persons.filter(criteria, 0, 5);
    const { rows, dropped } = verifyLookup(page.data, mode, lookup);
    const ignored = dropped > 0 ? { warning: filterIgnoredWarning(mode, dropped) } : {};
    if (rows.length === 0) {
      return { found: false, message: 'No person with that Banner ID.', ...ignored };
    }
    if (rows.length > 1) {
      return {
        found: false,
        ambiguous: true,
        message: 'More than one person matched; call again with personId.',
        matches: rows.map((p) => summarizePerson(p)),
        ...ignored,
      };
    }
    person = rows[0]!;
  }

  // 2. Student record(s)
  const studentsPage = await ethos.students.filter({ person: { id: person.id } }, 0, 10);
  const students: Student[] = studentsPage.data;

  // 3. Registrations (optionally one term)
  let term: AcademicPeriod | undefined;
  const regCriteria: Record<string, unknown> = { registrant: { id: person.id } };
  if (input.academicPeriodCode) {
    term = await resolveTermByCode(ethos, input.academicPeriodCode);
    regCriteria['academicPeriod'] = { id: term.id };
  }
  const regs: SectionRegistration[] = [];
  let regsCapped = false;
  for await (const batch of ethos.sectionRegistrations.filterAll(regCriteria, 100)) {
    regs.push(...batch);
    if (regs.length >= MAX_REGISTRATIONS) {
      regsCapped = true;
      regs.length = MAX_REGISTRATIONS;
      break;
    }
  }

  // Most recent first, so the section budget goes to recent terms.
  const recency = (r: SectionRegistration) => r.originallyRegisteredOn ?? r.statusDate ?? '';
  regs.sort((a, b) => recency(b).localeCompare(recency(a)));

  // 4. Sections (bounded)
  const sectionIds = [...new Set(regs.map((r) => r.section?.id).filter(Boolean))] as string[];
  const lookedUp = sectionIds.slice(0, MAX_SECTION_LOOKUPS);
  const sections = new Map<string, Section>();
  await mapLimit(lookedUp, 6, async (id) => {
    const s = await getOrNull(() => ethos.sections.get(id));
    if (s) sections.set(id, s);
  });

  // 5. Terms
  const termIds = new Set<string>();
  for (const s of sections.values()) if (s.academicPeriod?.id) termIds.add(s.academicPeriod.id);
  const terms = new Map<string, TermSummary>();
  if (term) terms.set(term.id, summarizeTerm(term));
  await mapLimit(
    [...termIds].filter((id) => !terms.has(id)),
    4,
    async (id) => {
      const t = await getOrNull(() => ethos.academicPeriods.get(id));
      if (t) terms.set(id, summarizeTerm(t));
    },
  );

  // 6. Group by term
  type Group = {
    term: TermSummary | null;
    registrations: Array<ReturnType<typeof summarizeRegistration> & { section: unknown }>;
  };
  const groups = new Map<string, Group>();
  let unresolved = 0;
  let otherTermRows = 0;
  for (const r of regs) {
    const section = r.section?.id ? sections.get(r.section.id) : undefined;
    if (!section) {
      unresolved++;
      continue;
    }
    const termId = section.academicPeriod?.id ?? 'unknown';
    if (term && termId !== term.id) {
      // Ethos ignored the academicPeriod filter: never report another term's rows.
      otherTermRows++;
      continue;
    }
    if (!groups.has(termId)) {
      groups.set(termId, { term: terms.get(termId) ?? null, registrations: [] });
    }
    const { id: _sid, ...sectionSummary } = summarizeSection(section);
    groups.get(termId)!.registrations.push({
      ...summarizeRegistration(r),
      section: { id: section.id, ...sectionSummary },
    });
  }
  const maxTerms = input.maxTerms ?? 3;
  const ordered = [...groups.values()].sort((a, b) =>
    (b.term?.startOn ?? '').localeCompare(a.term?.startOn ?? ''),
  );
  const shown = ordered.slice(0, maxTerms);

  let requested: Record<string, unknown> = {};
  if (term) {
    const rows = groups.get(term.id)?.registrations ?? [];
    requested = {
      requestedTerm: summarizeTerm(term),
      registrationRowsInRequestedTerm: rows.length,
      registeredInRequestedTerm: rows.some((r) => r.status === 'registered'),
    };
  }

  return {
    found: true,
    person: summarizePerson(person),
    student: students.length > 0 ? students.map(summarizeStudent) : null,
    ...requested,
    registrations: {
      totalRead: regs.length,
      ...(regsCapped
        ? {
            cappedAt: MAX_REGISTRATIONS,
            capNote:
              `Registration read stopped at ${MAX_REGISTRATIONS} rows in Ethos's default order, ` +
              'before sorting by date, so the most recent terms may be missing. Pass ' +
              'academicPeriodCode to check a specific term.',
          }
        : {}),
      termsShown: shown.length,
      termsOmitted: ordered.length - shown.length,
      byTerm: shown,
      ...(otherTermRows > 0
        ? {
            otherTermRowsIgnored: otherTermRows,
            filterNote:
              'Ethos returned registrations from other terms for this term filter; they were removed.',
          }
        : {}),
      ...(unresolved > 0
        ? {
            unresolvedRegistrations: unresolved,
            note: `Section details were resolved for the ${MAX_SECTION_LOOKUPS} most recent sections only; use banner_section_registrations_search with academicPeriodCode for older terms.`,
          }
        : {}),
      statusNote:
        'Only status "registered" means currently enrolled; "notRegistered" rows are drops/withdrawals (see statusReason).',
    },
  };
}
