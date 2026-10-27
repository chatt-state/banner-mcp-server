/**
 * Tool definition helper shared by every domain.
 *
 * `defineTool()` registers a tool with the MCP server and wraps its handler
 * so that every call:
 *  - is timed and audit-logged (sanitized args, result count, error),
 *  - has SDK errors converted to MCP error results,
 *  - has its payload rendered as compact JSON under the size cap,
 *  - is recorded on the registrar, so the domain registry reports the tools a
 *    domain actually registered instead of a hand-maintained list.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { BannerClient, EthosClient } from 'ellucian-banner';
import type { BannerMcpConfig } from '../config.js';
import { audit } from '../audit.js';
import { describeError } from '../middleware/error-handler.js';
import { renderPayload } from '../output.js';

/** Dependencies available to tool handlers. */
export interface ToolDeps {
  config: BannerMcpConfig;
  ethos: () => EthosClient;
  /** Null when Banner REST is not configured. */
  banner: () => BannerClient | null;
}

/** What a handler returns: the payload to render plus an optional result count. */
export interface ToolOutput {
  payload: unknown;
  resultCount?: number;
}

/**
 * Registers tools on one McpServer and records their names. Domains receive a
 * registrar rather than the raw server.
 */
export class ToolRegistrar {
  readonly registered: string[] = [];

  constructor(
    readonly server: McpServer,
    readonly deps: ToolDeps,
  ) {}

  get config(): BannerMcpConfig {
    return this.deps.config;
  }

  /** Returns names recorded since `mark` (an earlier `registered.length`). */
  namesSince(mark: number): string[] {
    return this.registered.slice(mark);
  }
}

export interface ToolMeta<Shape extends z.ZodRawShape> {
  title: string;
  description: string;
  inputSchema: Shape;
  annotations?: ToolAnnotations;
}

/** Annotations for tools that only read data. */
export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

type CallResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Executes a handler with audit logging, error mapping and output shaping.
 * Exported for unit tests; tools use defineTool().
 */
export async function runTool(
  name: string,
  args: unknown,
  maxChars: number,
  handler: () => Promise<ToolOutput>,
  sessionId?: string,
): Promise<CallResult> {
  const started = performance.now();
  try {
    const out = await handler();
    const rendered = renderPayload(out.payload, maxChars);
    audit({
      tool: name,
      args,
      durationMs: performance.now() - started,
      resultCount: out.resultCount,
      truncated: rendered.truncated,
      sessionId,
    });
    return { content: [{ type: 'text', text: rendered.text }] };
  } catch (error: unknown) {
    const message = describeError(error);
    audit({ tool: name, args, durationMs: performance.now() - started, error: message, sessionId });
    return { content: [{ type: 'text', text: message }], isError: true };
  }
}

/** Registers a tool through the registrar. */
export function defineTool<Shape extends z.ZodRawShape>(
  reg: ToolRegistrar,
  name: string,
  meta: ToolMeta<Shape>,
  handler: (args: z.output<z.ZodObject<Shape>>) => Promise<ToolOutput>,
): void {
  const cb = async (args: z.output<z.ZodObject<Shape>>, extra: { sessionId?: string }) =>
    runTool(name, args, reg.config.maxResponseChars, () => handler(args), extra?.sessionId);

  reg.server.registerTool(
    name,
    {
      title: meta.title,
      description: meta.description,
      inputSchema: meta.inputSchema,
      annotations: { title: meta.title, ...(meta.annotations ?? READ_ONLY) },
    },
    cb as never,
  );
  reg.registered.push(name);
}

// ---------------------------------------------------------------------------
// Shared input schema fragments
// ---------------------------------------------------------------------------

/** Paging parameters. Ethos caps page size per resource (often 100-500). */
export const pagingShape = {
  offset: z.number().int().min(0).optional().describe('Pagination offset (default: 0)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Page size (default: 25). Prefer small pages; responses are size-capped.'),
};

/** Optional field projection. */
export const fieldsShape = {
  fields: z
    .array(z.string().min(1).max(200))
    .max(50)
    .optional()
    .describe(
      'Optional projection: dot-paths of properties to return per record, e.g. ' +
        '["names.firstName","names.lastName","credentials"]. "id" is always included.',
    ),
};

/** A GUID parameter. */
export function guid(description: string) {
  return z
    .string()
    .regex(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      'must be a GUID (8-4-4-4-12 hex)',
    )
    .describe(description);
}
