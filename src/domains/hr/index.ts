/**
 * HR domain module: employees, institution positions and institution jobs.
 */

import { defineGetTool, defineSearchTool } from '../../tools/resource.js';
import { guid, type ToolRegistrar } from '../../tools/define.js';
import { personRefCriteria } from '../student/criteria.js';

/** Registers HR domain tools. */
export function register(reg: ToolRegistrar): void {
  const ethos = reg.deps.ethos;

  defineSearchTool(
    reg,
    'banner_employees_search',
    'Search Employees',
    'List employee records (EEDM employees v12). Pass personId (person GUID, from ' +
      'banner_person_lookup) to get the employee record for one person.',
    { personId: guid('Person GUID').optional() },
    (a) => {
      const criteria = personRefCriteria(a.personId);
      return criteria
        ? ethos().employees.filter(criteria, a.offset, a.limit)
        : ethos().employees.getPage(a.offset, a.limit);
    },
  );
  defineGetTool(
    reg,
    'banner_employees_get',
    'Get Employee',
    'Get an employee record by GUID.',
    'Employee GUID',
    (id) => ethos().employees.get(id),
  );

  defineSearchTool(
    reg,
    'banner_positions_search',
    'Search Positions',
    'List institution positions (EEDM institution-positions v12).',
    {},
    (a) => ethos().positions.getPage(a.offset, a.limit),
  );
  defineGetTool(
    reg,
    'banner_positions_get',
    'Get Position',
    'Get an institution position by GUID.',
    'Position GUID',
    (id) => ethos().positions.get(id),
  );

  defineSearchTool(
    reg,
    'banner_jobs_search',
    'Search Jobs',
    'List institution jobs (EEDM institution-jobs v12). Pass personId to list the jobs one person ' +
      'holds. The person filter depends on the Banner Ethos API version; verify results.',
    { personId: guid('Person GUID').optional() },
    (a) => {
      const criteria = personRefCriteria(a.personId);
      return criteria
        ? ethos().jobs.filter(criteria, a.offset, a.limit)
        : ethos().jobs.getPage(a.offset, a.limit);
    },
  );
  defineGetTool(
    reg,
    'banner_jobs_get',
    'Get Job',
    'Get an institution job by GUID.',
    'Job GUID',
    (id) => ethos().jobs.get(id),
  );
}
