/**
 * Finance domain module.
 *
 * Provides tools for searching and retrieving accounting strings
 * and ledger activities via the Ethos typed resource accessors.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../middleware/error-handler.js';
import { getEthosClient } from '../../banner-client.js';

/** Registers finance domain tools with the MCP server. */
export function register(server: McpServer): void {
  server.registerTool(
    'banner_accounting_strings_search',
    {
      title: 'Search Accounting Strings',
      description:
        'Search for accounting strings in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().accountingStrings.getPage(args.offset, args.limit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  totalCount: page.totalCount,
                  offset: page.offset,
                  hasMore: page.hasMore,
                  count: page.data.length,
                  data: page.data,
                },
                null,
                2,
              ),
            },
          ],
        };
      });
    },
  );

  server.registerTool(
    'banner_accounting_strings_get',
    {
      title: 'Get Accounting String',
      description: 'Get a single accounting string by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Accounting string GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const data = await getEthosClient().accountingStrings.get(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_ledger_activities_search',
    {
      title: 'Search Ledger Activities',
      description:
        'Search for ledger activities in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().ledgerActivities.getPage(args.offset, args.limit);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  totalCount: page.totalCount,
                  offset: page.offset,
                  hasMore: page.hasMore,
                  count: page.data.length,
                  data: page.data,
                },
                null,
                2,
              ),
            },
          ],
        };
      });
    },
  );

  server.registerTool(
    'banner_ledger_activities_get',
    {
      title: 'Get Ledger Activity',
      description: 'Get a single ledger activity by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Ledger activity GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const data = await getEthosClient().ledgerActivities.get(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      });
    },
  );
}
