/**
 * MCP tool definitions for raw Ethos proxy operations.
 *
 * These tools provide generic CRUD access to any EEDM resource
 * via the Ethos Integration proxy API, plus GraphQL, QAPI search,
 * criteria filter, and change notification consumption.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { wrapToolHandler } from '../../middleware/error-handler.js';
import { getEthosClient } from '../../banner-client.js';

/**
 * Registers all Ethos proxy tools with the MCP server.
 */
export function registerEthosTools(server: McpServer): void {
  server.registerTool(
    'banner_ethos_get',
    {
      title: 'Ethos Get Resource',
      description:
        'Get a single EEDM resource by name and GUID from Ethos. ' +
        'Works with any resource (persons, students, courses, etc.).',
      inputSchema: {
        resource: z.string().describe('EEDM resource name (e.g., "persons", "students")'),
        id: z.string().describe('Resource GUID'),
        version: z.number().int().optional().describe('EEDM version number'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const data = await getEthosClient().get(args.resource, args.id, args.version);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_ethos_get_all',
    {
      title: 'Ethos List Resources',
      description:
        'Get a paginated list of any EEDM resource from Ethos. ' +
        'Returns one page at a time with total count and pagination info.',
      inputSchema: {
        resource: z.string().describe('EEDM resource name (e.g., "persons", "sections")'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
        version: z.number().int().optional().describe('EEDM version number'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().getPage(
          args.resource,
          args.offset,
          args.limit,
          args.version,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  resource: args.resource,
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
    'banner_ethos_create',
    {
      title: 'Ethos Create Resource',
      description: 'Create a new EEDM resource via the Ethos proxy.',
      inputSchema: {
        resource: z.string().describe('EEDM resource name'),
        data: z.record(z.string(), z.unknown()).describe('Resource data to create'),
        version: z.number().int().optional().describe('EEDM version number'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const result = await getEthosClient().create(args.resource, args.data, args.version);
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_ethos_update',
    {
      title: 'Ethos Update Resource',
      description: 'Update an existing EEDM resource by GUID via the Ethos proxy.',
      inputSchema: {
        resource: z.string().describe('EEDM resource name'),
        id: z.string().describe('Resource GUID'),
        data: z.record(z.string(), z.unknown()).describe('Updated resource data'),
        version: z.number().int().optional().describe('EEDM version number'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const result = await getEthosClient().update(
          args.resource,
          args.id,
          args.data,
          args.version,
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_ethos_delete',
    {
      title: 'Ethos Delete Resource',
      description: 'Delete an EEDM resource by GUID via the Ethos proxy.',
      inputSchema: {
        resource: z.string().describe('EEDM resource name'),
        id: z.string().describe('Resource GUID'),
        version: z.number().int().optional().describe('EEDM version number'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        await getEthosClient().delete(args.resource, args.id, args.version);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Resource ${args.resource}/${args.id} deleted successfully.`,
            },
          ],
        };
      });
    },
  );

  server.registerTool(
    'banner_ethos_graphql',
    {
      title: 'Ethos GraphQL Query',
      description:
        'Execute a GraphQL query against the Ethos Integration GraphQL endpoint. ' +
        'Useful for complex queries that join multiple EEDM resources or need specific field selection.',
      inputSchema: {
        query: z.string().describe('GraphQL query string'),
        variables: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Optional GraphQL variables object'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const result = await getEthosClient().graphql.query({
          query: args.query,
          variables: args.variables,
        });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        };
      });
    },
  );

  server.registerTool(
    'banner_ethos_qapi_search',
    {
      title: 'Ethos QAPI Search',
      description:
        'Search an EEDM resource using QAPI (POST-based criteria search). ' +
        'Accepts a criteria object specific to the resource being searched. ' +
        'Returns paginated results.',
      inputSchema: {
        resource: z.string().describe('EEDM resource name (e.g., "persons", "students")'),
        criteria: z
          .record(z.string(), z.unknown())
          .describe('Search criteria object (resource-specific)'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
        version: z.number().int().optional().describe('EEDM version number'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().qapi.search(
          args.resource,
          args.criteria,
          args.offset,
          args.limit,
          args.version,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  resource: args.resource,
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
    'banner_ethos_filter',
    {
      title: 'Ethos Criteria Filter',
      description:
        'Filter an EEDM resource using GET-based criteria parameters. ' +
        'Criteria are encoded as query parameters per the Ethos filter specification. ' +
        'Returns paginated results.',
      inputSchema: {
        resource: z.string().describe('EEDM resource name (e.g., "persons", "students")'),
        criteria: z
          .record(z.string(), z.unknown())
          .describe('Filter criteria object (e.g., {"names.lastName": "Smith"})'),
        offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
        limit: z.number().int().min(1).max(500).optional().describe('Page size (default: 25)'),
        version: z.number().int().optional().describe('EEDM version number'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const page = await getEthosClient().filter(
          args.resource,
          args.criteria,
          args.offset,
          args.limit,
          args.version,
        );
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  resource: args.resource,
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
    'banner_ethos_consume_notifications',
    {
      title: 'Ethos Consume Change Notifications',
      description:
        'Consume change notifications from the Ethos Integration message queue. ' +
        'Returns a batch of notifications about created, updated, or deleted resources. ' +
        'Use lastProcessedID to resume from a specific point.',
      inputSchema: {
        lastProcessedID: z
          .number()
          .int()
          .optional()
          .describe('Resume from this notification ID (exclusive)'),
        limit: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Max notifications to return per poll'),
      },
    },
    async (args) => {
      return wrapToolHandler(async () => {
        const notifications = await getEthosClient().notifications.consume({
          lastProcessedID: args.lastProcessedID,
          limit: args.limit,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  count: notifications.length,
                  notifications,
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
}
