/**
 * Ethos criteria builders for the student domain.
 *
 * The shapes follow the EEDM `?criteria=` filters documented for Banner's
 * Ethos API (and used by the ellucian-banner SDK's own recipes):
 *
 *   persons v12          {"credentials":[{"type":"bannerId","value":"A00123456"}]}
 *                        {"emails":[{"address":"x@example.edu"}]}
 *                        {"names":[{"firstName":"Ada","lastName":"Lovelace"}]}
 *                        {"roles":[{"role":"student"}]}
 *   students v16         {"person":{"id":"<person guid>"}}
 *   sections v16         {"academicPeriod":{"id":"<guid>"},"code":"...","number":"...","course":{"id":"<guid>"}}
 *   section-registrations v16
 *                        {"registrant":{"id":"<person guid>"},"section":{"id":"<guid>"},"academicPeriod":{"id":"<guid>"}}
 *   academic-periods v16 {"code":"202680"}
 *   employees v12        {"person":{"id":"<person guid>"}}
 *   institution-jobs v12 {"person":{"id":"<person guid>"}}
 *
 * Whether a given filter is supported, and whether matching is exact or
 * case-insensitive, is decided by the Banner Ethos API version deployed at
 * the institution. Unsupported filters are usually rejected with HTTP 400 or
 * silently ignored, so tool descriptions tell the model to check results.
 */

import { ToolInputError } from '../../middleware/error-handler.js';

export interface PersonLookupInput {
  bannerId?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}

export type PersonLookupMode = 'bannerId' | 'email' | 'name';

/** Banner IDs are short alphanumerics (e.g. A00123456); reject anything else early. */
const BANNER_ID_RE = /^[A-Za-z0-9@._-]{1,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Builds persons criteria for exactly one lookup mode.
 * @throws ToolInputError when zero or several modes are given.
 */
export function buildPersonLookupCriteria(input: PersonLookupInput): {
  mode: PersonLookupMode;
  criteria: Record<string, unknown>;
} {
  const bannerId = input.bannerId?.trim();
  const email = input.email?.trim();
  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  const modes = [bannerId ? 1 : 0, email ? 1 : 0, firstName || lastName ? 1 : 0].reduce(
    (a, b) => a + b,
    0,
  );
  if (modes !== 1) {
    throw new ToolInputError(
      'Provide exactly one of: bannerId, email, or a name (lastName, optionally with firstName).',
    );
  }
  if (bannerId) {
    if (!BANNER_ID_RE.test(bannerId)) {
      throw new ToolInputError('bannerId contains unexpected characters');
    }
    return { mode: 'bannerId', criteria: { credentials: [{ type: 'bannerId', value: bannerId }] } };
  }
  if (email) {
    if (!EMAIL_RE.test(email)) throw new ToolInputError('email is not a valid address');
    return { mode: 'email', criteria: { emails: [{ address: email }] } };
  }
  if (!lastName) {
    throw new ToolInputError('A name lookup needs lastName (firstName alone is too broad).');
  }
  const name: Record<string, string> = { lastName };
  if (firstName) name['firstName'] = firstName;
  return { mode: 'name', criteria: { names: [name] } };
}

/** persons search criteria from optional name/role filters; undefined when none given. */
export function buildPersonSearchCriteria(input: {
  firstName?: string;
  lastName?: string;
  role?: string;
}): Record<string, unknown> | undefined {
  const criteria: Record<string, unknown> = {};
  const name: Record<string, string> = {};
  if (input.firstName?.trim()) name['firstName'] = input.firstName.trim();
  if (input.lastName?.trim()) name['lastName'] = input.lastName.trim();
  if (Object.keys(name).length > 0) criteria['names'] = [name];
  if (input.role) criteria['roles'] = [{ role: input.role }];
  return Object.keys(criteria).length > 0 ? criteria : undefined;
}

/** sections criteria; undefined when no filter given. */
export function buildSectionCriteria(input: {
  academicPeriodId?: string;
  code?: string;
  number?: string;
  courseId?: string;
}): Record<string, unknown> | undefined {
  const criteria: Record<string, unknown> = {};
  if (input.academicPeriodId) criteria['academicPeriod'] = { id: input.academicPeriodId };
  if (input.code) criteria['code'] = input.code;
  if (input.number) criteria['number'] = input.number;
  if (input.courseId) criteria['course'] = { id: input.courseId };
  return Object.keys(criteria).length > 0 ? criteria : undefined;
}

/** section-registrations criteria; undefined when no filter given. */
export function buildRegistrationCriteria(input: {
  registrantId?: string;
  sectionId?: string;
  academicPeriodId?: string;
}): Record<string, unknown> | undefined {
  const criteria: Record<string, unknown> = {};
  if (input.registrantId) criteria['registrant'] = { id: input.registrantId };
  if (input.sectionId) criteria['section'] = { id: input.sectionId };
  if (input.academicPeriodId) criteria['academicPeriod'] = { id: input.academicPeriodId };
  return Object.keys(criteria).length > 0 ? criteria : undefined;
}

/** `{"person":{"id":...}}` criteria used by students, employees and jobs. */
export function personRefCriteria(personId?: string): Record<string, unknown> | undefined {
  return personId ? { person: { id: personId } } : undefined;
}
