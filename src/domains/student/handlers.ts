/**
 * Handler implementations for student MCP tools that do more than one call.
 */

import {
  NotFoundError,
  type AcademicPeriod,
  type EthosClient,
  type Person,
  type Section,
  type SectionRegistration,
  type Student,
} from 'ellucian-banner';
import { ToolInputError } from '../../middleware/error-handler.js';
import { buildPersonLookupCriteria, type PersonLookupInput } from './criteria.js';
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

/** Looks a person up by Banner ID, email or name and returns compact summaries. */
export async function lookupPerson(
  ethos: EthosClient,
  input: PersonLookupInput & { offset?: number; limit?: number },
) {
  const { mode, criteria } = buildPersonLookupCriteria(input);
  const page = await ethos.persons.filter(criteria, input.offset ?? 0, input.limit ?? 10);
  const matches = page.data.map((p) => summarizePerson(p));
  return {
    mode,
    totalCount: page.totalCount,
    offset: page.offset,
    count: matches.length,
    hasMore: page.hasMore,
    ...(page.hasMore ? { nextOffset: page.offset + page.data.length } : {}),
    data: matches,
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

/** Resolves an academic period by Banner term code (STVTERM, e.g. "202680"). */
export async function resolveTermByCode(ethos: EthosClient, code: string): Promise<AcademicPeriod> {
  const page = await ethos.academicPeriods.filter({ code }, 0, 5);
  const match = page.data.find((p) => p.code === code) ?? page.data[0];
  if (!match) {
    throw new ToolInputError(
      `No academic period with code "${code}". Use banner_academic_periods_get to list valid term codes.`,
    );
  }
  return match;
}

export interface StudentContextInput {
  bannerId?: string;
  personId?: string;
  academicPeriodCode?: string;
  maxTerms?: number;
}

/** Cap on registrations read per context call. */
export const MAX_REGISTRATIONS = 200;
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
    const { criteria } = buildPersonLookupCriteria({ bannerId: input.bannerId });
    const page = await ethos.persons.filter(criteria, 0, 5);
    if (page.data.length === 0) {
      return { found: false, message: 'No person with that Banner ID.' };
    }
    if (page.data.length > 1) {
      return {
        found: false,
        ambiguous: true,
        message: 'More than one person matched; call again with personId.',
        matches: page.data.map((p) => summarizePerson(p)),
      };
    }
    person = page.data[0]!;
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
  const groups = new Map<string, { term: TermSummary | null; registrations: unknown[] }>();
  let unresolved = 0;
  for (const r of regs) {
    const section = r.section?.id ? sections.get(r.section.id) : undefined;
    if (!section) {
      unresolved++;
      continue;
    }
    const termId = section.academicPeriod?.id ?? 'unknown';
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

  return {
    found: true,
    person: summarizePerson(person),
    student: students.length > 0 ? students.map(summarizeStudent) : null,
    registrations: {
      totalRead: regs.length,
      ...(regsCapped ? { cappedAt: MAX_REGISTRATIONS } : {}),
      termsShown: shown.length,
      termsOmitted: ordered.length - shown.length,
      byTerm: shown,
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
