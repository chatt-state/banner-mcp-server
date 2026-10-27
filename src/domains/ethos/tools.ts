/**
 * MCP tool definitions for generic Ethos access.
 *
 * Read tools are always registered when the domain loads. Tools that change
 * data or queue state (create, update, delete, consume notifications) are
 * registered only when BANNER_ALLOW_WRITES=true; otherwise they do not exist
 * on the server at all.
 */

import { z } from 'zod';
import { defineTool, fieldsShape, pagingShape, type ToolRegistrar } from '../../tools/define.js';
import { pageEnvelope, projectFields } from '../../output.js';
import { ToolInputError } from '../../middleware/error-handler.js';

/** Names of the write tools, for documentation and tests. */
export const ETHOS_WRITE_TOOLS = [
  'banner_ethos_create',
  'banner_ethos_update',
  'banner_ethos_delete',
  'banner_ethos_consume_notifications',
] as const;

const resourceSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,100}$/, 'must be a plain EEDM resource name such as "persons"')
  .describe('EEDM resource name (e.g. "persons", "sections", "academic-levels")');

const idSchema = z.string().min(1).max(100).describe('Resource GUID');

const versionSchema = z
  .union([z.number().int().min(1).max(999), z.string().regex(/^\d+(\.\d+){0,2}$/)])
  .optional()
  .describe(
    'EEDM version (e.g. 12 or "12.1.0"). Omit for the latest version, whose schema may change on upgrade.',
  );

const criteriaSchema = z.record(z.string(), z.unknown());

/** Removes string literals and comments so keyword checks see only GraphQL syntax. */
function stripGraphqlLiterals(query: string): string {
  return query
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/#[^\n\r]*/g, '');
}

/** True when the GraphQL document declares a mutation or subscription operation. */
export function isNonQueryGraphql(query: string): boolean {
  return /(^|[^A-Za-z0-9_])(mutation|subscription)\b/.test(stripGraphqlLiterals(query));
}

/**
 * Registers Ethos tools.
 */
export function registerEthosTools(reg: ToolRegistrar): void {
  const ethos = reg.deps.ethos;
  const allowWrites = reg.config.allowWrites;

  defineTool(
    reg,
    'banner_ethos_get',
    {
      title: 'Ethos Get Resource',
      description:
        'Get one record of any EEDM resource by name and GUID, e.g. to resolve a GUID reference ' +
        '("academic-levels", "student-types", "sites").',
      inputSchema: {
        resource: resourceSchema,
        id: idSchema,
        version: versionSchema,
        ...fieldsShape,
      },
    },
    async (args) => ({
      payload: projectFields(await ethos().get(args.resource, args.id, args.version), args.fields),
      resultCount: 1,
    }),
  );

  defineTool(
    reg,
    'banner_ethos_get_all',
    {
      title: 'Ethos List Resources',
      description: 'Get one page of any EEDM resource, unfiltered.',
      inputSchema: {
        resource: resourceSchema,
        version: versionSchema,
        ...pagingShape,
        ...fieldsShape,
      },
    },
    async (args) => {
      const page = await ethos().getPage(args.resource, args.offset, args.limit, args.version);
      return {
        payload: pageEnvelope(page, args.fields, { resource: args.resource }),
        resultCount: page.data.length,
      };
    },
  );

  defineTool(
    reg,
    'banner_ethos_filter',
    {
      title: 'Ethos Criteria Filter',
      description:
        'Filter any EEDM resource with an Ethos criteria object (sent as ?criteria=<json>), e.g. ' +
        '{"names":[{"lastName":"Smith"}]} for persons. Criteria shapes mirror the resource schema; ' +
        'supported filters depend on the resource and the Banner Ethos API version.',
      inputSchema: {
        resource: resourceSchema,
        criteria: criteriaSchema.describe('Criteria object, e.g. {"code":"202680"}'),
        version: versionSchema,
        ...pagingShape,
        ...fieldsShape,
      },
    },
    async (args) => {
      const page = await ethos().filter(
        args.resource,
        args.criteria,
        args.offset,
        args.limit,
        args.version,
      );
      return {
        payload: pageEnvelope(page, args.fields, { resource: args.resource }),
        resultCount: page.data.length,
      };
    },
  );

  defineTool(
    reg,
    'banner_ethos_qapi_search',
    {
      title: 'Ethos QAPI Search',
      description:
        'Search an EEDM resource with QAPI (POST /qapi/{resource}) using a partial resource as ' +
        'criteria. Read-only, but only available for resources the tenant exposes via QAPI.',
      inputSchema: {
        resource: resourceSchema,
        criteria: criteriaSchema.describe('Partial resource used as the search body'),
        version: versionSchema,
        ...pagingShape,
        ...fieldsShape,
      },
    },
    async (args) => {
      const page = await ethos().qapi.search(
        args.resource,
        args.criteria,
        args.offset,
        args.limit,
        args.version,
      );
      return {
        payload: pageEnvelope(page, args.fields, { resource: args.resource }),
        resultCount: page.data.length,
      };
    },
  );

  defineTool(
    reg,
    'banner_ethos_graphql',
    {
      title: 'Ethos GraphQL Query',
      description:
        'Run a read-only GraphQL query against Ethos (fields are version-suffixed, e.g. persons12, ' +
        'sections16). Mutations and subscriptions are rejected.',
      inputSchema: {
        query: z.string().min(1).max(20_000).describe('GraphQL query document'),
        variables: z.record(z.string(), z.unknown()).optional().describe('GraphQL variables'),
      },
    },
    async (args) => {
      if (isNonQueryGraphql(args.query)) {
        throw new ToolInputError('Only GraphQL queries are allowed (no mutation/subscription).');
      }
      const result = await ethos().graphql.query({ query: args.query, variables: args.variables });
      return { payload: result };
    },
  );

  if (!allowWrites) return;

  const writeAnnotations = {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  };

  defineTool(
    reg,
    'banner_ethos_create',
    {
      title: 'Ethos Create Resource',
      description:
        'WRITE: create a new EEDM record in Banner via Ethos. Confirm with the user before calling.',
      inputSchema: {
        resource: resourceSchema,
        data: z.record(z.string(), z.unknown()).describe('Resource body'),
        version: versionSchema,
      },
      annotations: writeAnnotations,
    },
    async (args) => ({
      payload: await ethos().create(args.resource, args.data, args.version),
      resultCount: 1,
    }),
  );

  defineTool(
    reg,
    'banner_ethos_update',
    {
      title: 'Ethos Update Resource',
      description:
        'WRITE: replace an EEDM record (PUT) in Banner via Ethos. Confirm with the user before calling.',
      inputSchema: {
        resource: resourceSchema,
        id: idSchema,
        data: z.record(z.string(), z.unknown()).describe('Full updated resource body'),
        version: versionSchema,
      },
      annotations: { ...writeAnnotations, idempotentHint: true },
    },
    async (args) => ({
      payload: await ethos().update(args.resource, args.id, args.data, args.version),
      resultCount: 1,
    }),
  );

  defineTool(
    reg,
    'banner_ethos_delete',
    {
      title: 'Ethos Delete Resource',
      description:
        'WRITE: delete an EEDM record in Banner via Ethos. Irreversible; confirm with the user first.',
      inputSchema: { resource: resourceSchema, id: idSchema, version: versionSchema },
      annotations: { ...writeAnnotations, idempotentHint: true },
    },
    async (args) => {
      await ethos().delete(args.resource, args.id, args.version);
      return { payload: { deleted: true, resource: args.resource, id: args.id }, resultCount: 1 };
    },
  );

  defineTool(
    reg,
    'banner_ethos_consume_notifications',
    {
      title: 'Ethos Consume Change Notifications',
      description:
        'QUEUE WRITE: consume a batch of change notifications for this Ethos application. ' +
        'Requesting a batch acknowledges the previous one (Ethos deletes it from the queue), so ' +
        'other integrations sharing this API key will not see those messages. Pass ' +
        'lastProcessedID to acknowledge only up to that ID.',
      inputSchema: {
        lastProcessedID: z.number().int().min(0).optional().describe('Acknowledge up to this ID'),
        limit: z.number().int().min(1).max(1000).optional().describe('Max notifications (1-1000)'),
      },
      annotations: writeAnnotations,
    },
    async (args) => {
      const batch = await ethos().notifications.consumeBatch({
        lastProcessedID: args.lastProcessedID,
        limit: args.limit,
      });
      return {
        payload: {
          count: batch.notifications.length,
          remaining: batch.remaining,
          notifications: batch.notifications,
        },
        resultCount: batch.notifications.length,
      };
    },
  );
}
