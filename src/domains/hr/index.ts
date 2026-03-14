/**
 * HR domain module.
 *
 * Provides tools for searching and retrieving employees, positions,
 * and jobs via the Ethos typed resource accessors.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../middleware/error-handler.js';
import { getEthosClient } from '../../banner-client.js';

/** Registers HR domain tools with the MCP server. */
export function register(server: McpServer): void {
  server.registerTool(
    'banner_employees_search',
    {
      title: 'Search Employees',
      description: 'Search for employees in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().employees.getPage(args.offset, args.limit);
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
    'banner_employees_get',
    {
      title: 'Get Employee',
      description: 'Get a single employee by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Employee GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const data = await getEthosClient().employees.get(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_positions_search',
    {
      title: 'Search Positions',
      description: 'Search for positions in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().positions.getPage(args.offset, args.limit);
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
    'banner_positions_get',
    {
      title: 'Get Position',
      description: 'Get a single position by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Position GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const data = await getEthosClient().positions.get(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_jobs_search',
    {
      title: 'Search Jobs',
      description: 'Search for jobs in Banner via Ethos. Returns paginated results.',
      inputSchema: {
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().jobs.getPage(args.offset, args.limit);
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
    'banner_jobs_get',
    {
      title: 'Get Job',
      description: 'Get a single job by GUID from Banner via Ethos.',
      inputSchema: {
        id: z.string().describe('Job GUID'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const data = await getEthosClient().jobs.get(args.id);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      });
    },
  );
}
