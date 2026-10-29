/**
 * Financial Aid domain module: applications and student awards.
 */

import { defineGetTool, defineSearchTool } from '../../tools/resource.js';
import type { ToolRegistrar } from '../../tools/define.js';

/** Registers financial aid domain tools. */
export function register(reg: ToolRegistrar): void {
  const ethos = reg.deps.ethos;

  defineSearchTool(
    reg,
    'banner_financial_aid_applications_search',
    'Search Financial Aid Applications',
    'List financial aid applications (EEDM financial-aid-applications v9).',
    {},
    (a) => ethos().financialAidApplications.getPage(a.offset, a.limit),
  );
  defineGetTool(
    reg,
    'banner_financial_aid_applications_get',
    'Get Financial Aid Application',
    'Get a financial aid application by GUID.',
    'Financial aid application GUID',
    (id) => ethos().financialAidApplications.get(id),
  );

  defineSearchTool(
    reg,
    'banner_financial_aid_awards_search',
    'Search Financial Aid Awards',
    'List student financial aid awards (EEDM student-financial-aid-awards v11).',
    {},
    (a) => ethos().studentFinancialAidAwards.getPage(a.offset, a.limit),
  );
  defineGetTool(
    reg,
    'banner_financial_aid_awards_get',
    'Get Financial Aid Award',
    'Get a student financial aid award by GUID.',
    'Financial aid award GUID',
    (id) => ethos().studentFinancialAidAwards.get(id),
  );
}
