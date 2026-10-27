/**
 * Compact summaries of EEDM records for LLM consumption.
 *
 * Full EEDM person records are large (addresses, races, identity documents,
 * ...). Summaries keep what is needed to identify a record and decide what to
 * fetch next, and deliberately leave out date of birth, SSN-type credentials,
 * addresses and phones. Use banner_persons_get for the full record.
 */

import type {
  AcademicPeriod,
  Person,
  Section,
  SectionRegistration,
  Student,
} from 'ellucian-banner';

export interface PersonSummary {
  id: string;
  bannerId?: string;
  name?: string;
  legalName?: string;
  emails?: Array<{ type?: string; address: string; preferred?: boolean }>;
  roles?: string[];
  privacy?: string;
}

function fullName(n: Person['names'][number] | undefined): string | undefined {
  if (!n) return undefined;
  if (n.fullName) return n.fullName;
  const parts = [n.firstName, n.middleName, n.lastNamePrefix, n.lastName, n.pedigree].filter(
    Boolean,
  );
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function isActive(endOn: string | undefined, today: string): boolean {
  return !endOn || endOn >= today;
}

/** Privacy category, e.g. "restricted" for a Banner confidential (FERPA) flag. */
function privacyOf(p: Person): string | undefined {
  const ps = p.privacyStatus as unknown;
  if (typeof ps === 'string') return ps;
  if (ps && typeof ps === 'object' && 'privacyCategory' in ps) {
    const cat = (ps as { privacyCategory?: unknown }).privacyCategory;
    return typeof cat === 'string' ? cat : undefined;
  }
  return undefined;
}

/** Summarizes a person record (no DOB, SSN, address or phone). */
export function summarizePerson(
  p: Person,
  today = new Date().toISOString().slice(0, 10),
): PersonSummary {
  const names = p.names ?? [];
  const legal = names.find((n) => n.type?.category === 'legal');
  const preferred =
    names.find((n) => n.preference === 'preferred') ??
    names.find((n) => n.type?.category === 'personal') ??
    legal ??
    names[0];
  const summary: PersonSummary = { id: p.id };
  const bannerId = p.credentials?.find(
    (c) => c.type === 'bannerId' && isActive(c.endOn, today),
  )?.value;
  if (bannerId) summary.bannerId = bannerId;
  const name = fullName(preferred);
  if (name) summary.name = name;
  const legalName = fullName(legal);
  if (legalName && legalName !== name) summary.legalName = legalName;
  if (p.emails?.length) {
    summary.emails = p.emails.map((e) => ({
      type: e.type?.type,
      address: e.address,
      ...(e.preference === 'primary' ? { preferred: true } : {}),
    }));
  }
  const roles = (p.roles ?? []).filter((r) => isActive(r.endOn, today)).map((r) => r.role);
  if (roles.length) summary.roles = [...new Set(roles)];
  const privacy = privacyOf(p);
  if (privacy) summary.privacy = privacy;
  return summary;
}

/** Summarizes a student record (GUID references only; resolve with banner_ethos_get). */
export function summarizeStudent(s: Student) {
  return {
    id: s.id,
    personId: s.person?.id,
    types: s.types?.map((t) => t.type?.id).filter(Boolean),
    residencies: s.residencies?.map((r) => ({ residencyId: r.residency?.id, startOn: r.startOn })),
    levelClassifications: s.levelClassifications?.map((l) => ({
      levelId: l.level?.id,
      classificationId: l.latestClassification?.classification?.id,
    })),
  };
}

export interface TermSummary {
  id: string;
  code?: string;
  title?: string;
  startOn?: string;
  endOn?: string;
}

export function summarizeTerm(t: AcademicPeriod): TermSummary {
  return { id: t.id, code: t.code, title: t.title, startOn: t.startOn, endOn: t.endOn };
}

export function sectionTitle(s: Section): string | undefined {
  const titles = s.titles ?? [];
  return (titles.find((t) => t.type === 'long') ?? titles[0])?.value;
}

export function summarizeSection(s: Section) {
  return {
    id: s.id,
    code: s.code,
    number: s.number,
    title: sectionTitle(s),
    courseId: s.course?.id,
    startOn: s.startOn,
    endOn: s.endOn,
  };
}

export function summarizeRegistration(r: SectionRegistration) {
  return {
    id: r.id,
    sectionId: r.section?.id,
    status: r.status?.registrationStatus,
    statusReason: r.status?.sectionRegistrationStatusReason,
    statusDate: r.statusDate,
    originallyRegisteredOn: r.originallyRegisteredOn,
    credit: r.credit?.measure
      ? { measure: r.credit.measure, value: r.credit.minimum ?? r.credit.maximum }
      : undefined,
  };
}
