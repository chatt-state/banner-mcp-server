/**
 * Finance domain module: accounting strings and ledger activities.
 */

import { defineGetTool, defineSearchTool } from '../../tools/resource.js';
import type { ToolRegistrar } from '../../tools/define.js';

/** Registers finance domain tools. */
export function register(reg: ToolRegistrar): void {
  const ethos = reg.deps.ethos;

  defineSearchTool(
    reg,
    'banner_accounting_strings_search',
    'Search Accounting Strings',
    'List accounting strings (EEDM accounting-strings v7).',
    {},
    (a) => ethos().accountingStrings.getPage(a.offset, a.limit),
  );
  defineGetTool(
    reg,
    'banner_accounting_strings_get',
    'Get Accounting String',
    'Get an accounting string by GUID.',
    'Accounting string GUID',
    (id) => ethos().accountingStrings.get(id),
  );

  defineSearchTool(
    reg,
    'banner_ledger_activities_search',
    'Search Ledger Activities',
    'List ledger activities (EEDM ledger-activities, latest version).',
    {},
    (a) => ethos().ledgerActivities.getPage(a.offset, a.limit),
  );
  defineGetTool(
    reg,
    'banner_ledger_activities_get',
    'Get Ledger Activity',
    'Get a ledger activity by GUID.',
    'Ledger activity GUID',
    (id) => ethos().ledgerActivities.get(id),
  );
}
