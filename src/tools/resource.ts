/**
 * Helpers for the common "search a resource" / "get one by GUID" tool pair.
 */

import type { z } from 'zod';
import type { PaginatedResponse } from 'ellucian-banner';
import { pageEnvelope, projectFields } from '../output.js';
import { defineTool, fieldsShape, guid, pagingShape, type ToolRegistrar } from './define.js';

type PagingArgs = { offset?: number; limit?: number; fields?: string[] };

/** Registers a paged search tool with paging + fields params plus `extra` filters. */
export function defineSearchTool<Extra extends z.ZodRawShape>(
  reg: ToolRegistrar,
  name: string,
  title: string,
  description: string,
  extra: Extra,
  fetchPage: (
    args: z.output<z.ZodObject<Extra>> & PagingArgs,
  ) => Promise<PaginatedResponse<unknown>>,
): void {
  defineTool(
    reg,
    name,
    { title, description, inputSchema: { ...extra, ...pagingShape, ...fieldsShape } },
    async (args) => {
      const typed = args as unknown as z.output<z.ZodObject<Extra>> & PagingArgs;
      const page = await fetchPage(typed);
      return { payload: pageEnvelope(page, typed.fields), resultCount: page.data.length };
    },
  );
}

/** Registers a get-by-GUID tool with a fields param. */
export function defineGetTool(
  reg: ToolRegistrar,
  name: string,
  title: string,
  description: string,
  idLabel: string,
  get: (id: string) => Promise<unknown>,
): void {
  defineTool(
    reg,
    name,
    { title, description, inputSchema: { id: guid(idLabel), ...fieldsShape } },
    async (args) => ({ payload: projectFields(await get(args.id), args.fields), resultCount: 1 }),
  );
}
