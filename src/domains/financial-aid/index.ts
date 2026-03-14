/**
 * Financial Aid domain module.
 *
 * Provides tools for searching and retrieving financial aid
 * applications and awards via the Ethos typed resource accessors.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../middleware/error-handler.js';
import { getEthosClient } from '../../banner-client.js';

/** Registers financial aid domain tools with the MCP server. */
export function register(server: McpServer): void {
  server.registerTool(
    'banner_financial_aid_applications_search',
    {
      title: 'Search Financial Aid Applications',
      description:
        'Search for financial aid applications in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().financialAidApplications.getPage(
          args.offset,
          args.limit,
        );
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
    'banner_financial_aid_applications_get',
    {
      title: 'Get Financial Aid Application',
      description: 'Get a single financial aid application by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Financial aid application GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const data = await getEthosClient().financialAidApplications.get(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_financial_aid_awards_search',
    {
      title: 'Search Financial Aid Awards',
      description:
        'Search for financial aid awards in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().financialAidAwards.getPage(args.offset, args.limit);
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
    'banner_financial_aid_awards_get',
    {
      title: 'Get Financial Aid Award',
      description: 'Get a single financial aid award by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Financial aid award GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const data = await getEthosClient().financialAidAwards.get(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      });
    },
  );
}
