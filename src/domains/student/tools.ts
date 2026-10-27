/**
 * MCP tool definitions for the student domain.
 */

import { z } from 'zod';
import {
  defineTool,
  fieldsShape,
  guid,
  pagingShape,
  type ToolRegistrar,
} from '../../tools/define.js';
import { pageEnvelope, projectFields } from '../../output.js';
import { ToolInputError } from '../../middleware/error-handler.js';
import {
  buildPersonSearchCriteria,
  buildRegistrationCriteria,
  buildSectionCriteria,
  personRefCriteria,
} from './criteria.js';
import {
  lookupPerson,
  resolveTermByCode,
  searchAcademicPeriods,
  sectionsBySubject,
  studentContext,
} from './handlers.js';

const CRITERIA_NOTE =
  ' Filters use Ethos criteria; support and matching rules depend on the Banner Ethos API ' +
  'version installed, so verify results.';

/**
 * Registers all student-related tools.
 */
export function registerStudentTools(reg: ToolRegistrar): void {
  const ethos = reg.deps.ethos;

  defineTool(
    reg,
    'banner_person_lookup',
    {
      title: 'Look Up Person',
      description:
        'Find a person by Banner ID (e.g. "A00123456"), email address, or name, and return their ' +
        'person GUID with a compact summary (name, Banner ID, emails, active roles, privacy flag). ' +
        'Use this first to turn a Banner ID/email/name into the GUID other tools need. ' +
        'Give exactly one of bannerId, email, or lastName (+ optional firstName). ' +
        'Banner ID and email must match exactly. Name matching semantics (exact vs. partial, case) ' +
        'depend on the Banner Ethos API version and are not guaranteed. ' +
        'A privacy value of "restricted" means the record is FERPA-confidential: do not disclose it.',
      inputSchema: {
        bannerId: z.string().min(1).max(30).optional().describe('Banner ID, e.g. "A00123456"'),
        email: z.string().min(3).max(254).optional().describe('Email address (exact match)'),
        firstName: z.string().min(1).max(100).optional().describe('First name (with lastName)'),
        lastName: z.string().min(1).max(100).optional().describe('Last name'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default 0)'),
        limit: z.number().int().min(1).max(50).optional().describe('Max matches (default 10)'),
      },
    },
    async (args) => {
      const payload = await lookupPerson(ethos(), args);
      return { payload, resultCount: payload.count };
    },
  );

  defineTool(
    reg,
    'banner_student_context',
    {
      title: 'Student Context',
      description:
        'Given a Banner ID or person GUID, return a compact student profile in one call: person ' +
        'summary, student record(s), and section registrations for the most recent terms, each ' +
        'with section code/title and the term code/title/dates. Optionally restrict to one term ' +
        'with academicPeriodCode (Banner term code such as "202680"). Registration status ' +
        '"registered" means enrolled; "notRegistered" means dropped/withdrawn.',
      inputSchema: {
        bannerId: z.string().min(1).max(30).optional().describe('Banner ID, e.g. "A00123456"'),
        personId: guid('Person GUID').optional(),
        academicPeriodCode: z
          .string()
          .min(1)
          .max(20)
          .optional()
          .describe('Only this term (Banner term code, e.g. "202680")'),
        maxTerms: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe('Number of most recent terms to include (default 3)'),
      },
    },
    async (args) => {
      const payload = await studentContext(ethos(), args);
      const count =
        'registrations' in payload && payload.registrations ? payload.registrations.totalRead : 0;
      return { payload, resultCount: payload.found ? count : 0 };
    },
  );

  defineTool(
    reg,
    'banner_persons_search',
    {
      title: 'Search Persons',
      description:
        'List persons, optionally filtered by lastName/firstName and/or role (e.g. "student", ' +
        '"instructor", "employee"). Returns full EEDM person records (large); use "fields" to ' +
        'project, or prefer banner_person_lookup for finding a specific person.' +
        CRITERIA_NOTE,
      inputSchema: {
        lastName: z.string().min(1).max(100).optional(),
        firstName: z.string().min(1).max(100).optional(),
        role: z
          .enum([
            'student',
            'instructor',
            'employee',
            'vendor',
            'alumni',
            'prospectiveStudent',
            'advisor',
          ])
          .optional()
          .describe('Person role filter'),
        ...pagingShape,
        ...fieldsShape,
      },
    },
    async (args) => {
      const criteria = buildPersonSearchCriteria(args);
      const page = criteria
        ? await ethos().persons.filter(criteria, args.offset, args.limit)
        : await ethos().persons.getPage(args.offset, args.limit);
      return { payload: pageEnvelope(page, args.fields), resultCount: page.data.length };
    },
  );

  defineTool(
    reg,
    'banner_persons_get',
    {
      title: 'Get Person',
      description: 'Get a full person record (EEDM persons v12) by GUID.',
      inputSchema: { id: guid('Person GUID'), ...fieldsShape },
    },
    async (args) => ({
      payload: projectFields(await ethos().persons.get(args.id), args.fields),
      resultCount: 1,
    }),
  );

  defineTool(
    reg,
    'banner_students_search',
    {
      title: 'Search Students',
      description:
        'List student records (EEDM students v16). Pass personId to get the student record for ' +
        'one person.' +
        CRITERIA_NOTE,
      inputSchema: { personId: guid('Person GUID').optional(), ...pagingShape, ...fieldsShape },
    },
    async (args) => {
      const criteria = personRefCriteria(args.personId);
      const page = criteria
        ? await ethos().students.filter(criteria, args.offset, args.limit)
        : await ethos().students.getPage(args.offset, args.limit);
      return { payload: pageEnvelope(page, args.fields), resultCount: page.data.length };
    },
  );

  defineTool(
    reg,
    'banner_students_get',
    {
      title: 'Get Student',
      description: 'Get a student record by student GUID (not person GUID).',
      inputSchema: { id: guid('Student GUID'), ...fieldsShape },
    },
    async (args) => ({
      payload: projectFields(await ethos().students.get(args.id), args.fields),
      resultCount: 1,
    }),
  );

  defineTool(
    reg,
    'banner_courses_get',
    {
      title: 'Get Course',
      description: 'Get a catalog course (EEDM courses v6) by GUID.',
      inputSchema: { id: guid('Course GUID'), ...fieldsShape },
    },
    async (args) => ({
      payload: projectFields(await ethos().courses.get(args.id), args.fields),
      resultCount: 1,
    }),
  );

  defineTool(
    reg,
    'banner_sections_search',
    {
      title: 'Search Sections',
      description:
        'Search course sections (EEDM sections v16). Filter by term (academicPeriodCode such as ' +
        '"202680", or academicPeriodId), section code, section number and/or courseId. To list ' +
        'the sections of a subject (e.g. "which BIOL sections run in 202680?") pass subject ' +
        '(e.g. "BIOL", optionally with courseNumber such as "1110") with the term: the server ' +
        'resolves the subject and its catalog courses and returns compact section summaries ' +
        '(full records when "fields" is given). Or use keyword for a keyword search (Ethos ' +
        '"keywordSearch" named query, cannot be combined with other filters).' +
        CRITERIA_NOTE,
      inputSchema: {
        academicPeriodCode: z.string().min(1).max(20).optional().describe('Banner term code'),
        academicPeriodId: guid('Academic period GUID').optional(),
        code: z.string().min(1).max(50).optional().describe('Section code'),
        number: z.string().min(1).max(20).optional().describe('Section number'),
        courseId: guid('Course GUID').optional(),
        subject: z
          .string()
          .regex(/^[A-Za-z0-9]{1,10}$/, 'must be a subject abbreviation such as "BIOL"')
          .optional()
          .describe('Subject abbreviation, e.g. "BIOL"'),
        courseNumber: z
          .string()
          .regex(/^[A-Za-z0-9]{1,10}$/, 'must be a course number such as "1110"')
          .optional()
          .describe('Catalog course number within subject, e.g. "1110" (needs subject)'),
        keyword: z.string().min(2).max(100).optional().describe('Keyword search text'),
        ...pagingShape,
        ...fieldsShape,
      },
    },
    async (args) => {
      if (args.academicPeriodCode && args.academicPeriodId) {
        throw new ToolInputError('Give academicPeriodCode or academicPeriodId, not both.');
      }
      if (args.courseNumber && !args.subject) {
        throw new ToolInputError('courseNumber needs subject (e.g. subject "BIOL").');
      }
      if (args.subject && (args.courseId || args.keyword)) {
        throw new ToolInputError('subject cannot be combined with courseId or keyword.');
      }
      let academicPeriodId = args.academicPeriodId;
      if (args.academicPeriodCode) {
        academicPeriodId = (await resolveTermByCode(ethos(), args.academicPeriodCode)).id;
      }
      if (args.subject) {
        const payload = await sectionsBySubject(ethos(), {
          subject: args.subject,
          courseNumber: args.courseNumber,
          academicPeriodId,
          code: args.code,
          number: args.number,
          fields: args.fields,
        });
        return { payload, resultCount: payload.count };
      }
      const criteria = buildSectionCriteria({ ...args, academicPeriodId });
      if (args.keyword) {
        if (criteria) {
          throw new ToolInputError(
            'keyword cannot be combined with other filters. To list the sections of a subject ' +
              'in a term, use subject (+ courseNumber) with academicPeriodCode.',
          );
        }
        const page = await ethos().sections.namedQuery(
          'keywordSearch',
          args.keyword,
          args.offset,
          args.limit,
        );
        return { payload: pageEnvelope(page, args.fields), resultCount: page.data.length };
      }
      const page = criteria
        ? await ethos().sections.filter(criteria, args.offset, args.limit)
        : await ethos().sections.getPage(args.offset, args.limit);
      return { payload: pageEnvelope(page, args.fields), resultCount: page.data.length };
    },
  );

  defineTool(
    reg,
    'banner_sections_get',
    {
      title: 'Get Section',
      description: 'Get a course section (EEDM sections v16) by GUID.',
      inputSchema: { id: guid('Section GUID'), ...fieldsShape },
    },
    async (args) => ({
      payload: projectFields(await ethos().sections.get(args.id), args.fields),
      resultCount: 1,
    }),
  );

  defineTool(
    reg,
    'banner_section_registrations_search',
    {
      title: 'Search Section Registrations',
      description:
        'Search section registrations (EEDM section-registrations v16) by registrantId (person ' +
        'GUID), sectionId and/or term (academicPeriodCode or academicPeriodId). At least one ' +
        'filter is required. status.registrationStatus "registered" means enrolled.' +
        CRITERIA_NOTE,
      inputSchema: {
        registrantId: guid('Person GUID of the student').optional(),
        sectionId: guid('Section GUID').optional(),
        academicPeriodCode: z.string().min(1).max(20).optional().describe('Banner term code'),
        academicPeriodId: guid('Academic period GUID').optional(),
        ...pagingShape,
        ...fieldsShape,
      },
    },
    async (args) => {
      if (args.academicPeriodCode && args.academicPeriodId) {
        throw new ToolInputError('Give academicPeriodCode or academicPeriodId, not both.');
      }
      let academicPeriodId = args.academicPeriodId;
      if (args.academicPeriodCode) {
        academicPeriodId = (await resolveTermByCode(ethos(), args.academicPeriodCode)).id;
      }
      const criteria = buildRegistrationCriteria({ ...args, academicPeriodId });
      if (!criteria) {
        throw new ToolInputError(
          'Give registrantId, sectionId and/or a term; listing all registrations is not allowed.',
        );
      }
      const page = await ethos().sectionRegistrations.filter(criteria, args.offset, args.limit);
      return { payload: pageEnvelope(page, args.fields), resultCount: page.data.length };
    },
  );

  defineTool(
    reg,
    'banner_academic_periods_get',
    {
      title: 'Find Academic Periods',
      description:
        'Find academic periods (terms) and their Banner term codes. Use title to turn a name ' +
        'into a code (e.g. title "fall 2026"; every word must appear in the title, case-' +
        'insensitive), currentAndUpcoming=true for terms that have not ended yet (soonest ' +
        'first), or code for an exact Banner term code (e.g. "202680"). With none of these, ' +
        'returns raw pages in API order. Returns id, code, title, start/end dates and category ' +
        '(term/subterm/year). Do not guess term codes; look them up here.',
      inputSchema: {
        code: z.string().min(1).max(20).optional().describe('Exact Banner term code'),
        title: z
          .string()
          .min(2)
          .max(100)
          .optional()
          .describe('Words that must appear in the term title, e.g. "fall 2026"'),
        currentAndUpcoming: z
          .boolean()
          .optional()
          .describe('Only terms that end today or later, soonest first'),
        ...pagingShape,
        ...fieldsShape,
      },
    },
    async (args) => {
      if (args.code && (args.title || args.currentAndUpcoming)) {
        throw new ToolInputError('Give code, or title/currentAndUpcoming, not both.');
      }
      if (args.title || args.currentAndUpcoming) {
        const payload = await searchAcademicPeriods(ethos(), {
          title: args.title,
          currentAndUpcoming: args.currentAndUpcoming,
          limit: args.limit,
        });
        return { payload, resultCount: payload.count };
      }
      if (args.code) {
        const code = args.code.trim();
        const page = await ethos().academicPeriods.filter({ code }, args.offset, args.limit);
        const exact = page.data.filter((p) => p.code === code);
        if (exact.length === page.data.length) {
          return { payload: pageEnvelope(page, args.fields), resultCount: page.data.length };
        }
        // The tenant ignored or loosened the code filter: return only the exact match.
        return {
          payload: {
            ...pageEnvelope({ ...page, data: exact, hasMore: false }, args.fields),
            totalCount: exact.length,
            filterIgnored: true,
            droppedRows: page.data.length - exact.length,
          },
          resultCount: exact.length,
        };
      }
      const page = await ethos().academicPeriods.getPage(args.offset, args.limit);
      return { payload: pageEnvelope(page, args.fields), resultCount: page.data.length };
    },
  );
}
