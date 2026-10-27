/**
 * MCP server factory.
 *
 * createBannerMcpServer() builds a fully configured McpServer: navigator
 * tools (banner_navigate, banner_status), the optional Banner REST tool
 * (banner_api_get), and any pre-loaded domains. The stdio transport creates
 * one; the HTTP transport creates one per session.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { BannerMcpConfig } from './config.js';
import { getBannerClient, getEthosClient } from './banner-client.js';
import { DOMAIN_DESCRIPTIONS, DOMAIN_NAMES, DomainRegistry } from './domains/registry.js';
import { ToolInputError } from './middleware/error-handler.js';
import { projectFields } from './output.js';
import { defineTool, ToolRegistrar, type ToolDeps } from './tools/define.js';
import { SERVER_NAME, SERVER_VERSION } from './version.js';

export interface BannerMcpServer {
  server: McpServer;
  registry: DomainRegistry;
  registrar: ToolRegistrar;
}

/**
 * Validates a Banner REST path for banner_api_get. Must be an absolute path
 * on the configured host: no scheme/host, no dot segments, no encoded
 * separators, no query string (use the `query` argument).
 */
export function validateBannerApiPath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new ToolInputError('path must start with a single "/" (e.g. "/StudentApi/api/terms")');
  }
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\s\\#?\u0000-\u001f\u007f]/.test(path)) {
    throw new ToolInputError('path must not contain whitespace, "\\", "#" or "?" (use "query")');
  }
  if (/%(2e|2f|5c|00)/i.test(path)) {
    throw new ToolInputError('path must not contain encoded ".", "/", "\\" or NUL');
  }
  if (path.split('/').some((seg) => seg === '.' || seg === '..')) {
    throw new ToolInputError('path must not contain "." or ".." segments');
  }
  if (!/^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/.test(path)) {
    throw new ToolInputError('path contains characters outside RFC 3986');
  }
  return path;
}

/** Default dependencies: the process-wide shared clients. */
export function defaultDeps(config: BannerMcpConfig): ToolDeps {
  return {
    config,
    ethos: getEthosClient,
    banner: () => (config.bannerRestEnabled ? getBannerClient() : null),
  };
}

/**
 * Creates an McpServer with navigator tools and pre-loaded domains.
 */
export function createBannerMcpServer(
  config: BannerMcpConfig,
  deps: ToolDeps = defaultDeps(config),
): BannerMcpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: { listChanged: true } },
      instructions:
        'Banner (Ellucian ERP) data via Ethos. Data is FERPA-protected: share it only with the ' +
        'person asking and only as needed. Start with banner_person_lookup (Banner ID, email or ' +
        'name -> person GUID) or banner_student_context. Use banner_navigate to load more tool ' +
        'sets. Responses are size-capped; narrow queries or pass "fields" when truncated.',
    },
  );
  const registrar = new ToolRegistrar(server, deps);
  const registry = new DomainRegistry(registrar);

  defineTool(
    registrar,
    'banner_navigate',
    {
      title: 'Load Banner Domain',
      description:
        'Load a Banner domain tool set. Domains: ' +
        DOMAIN_NAMES.map((d) => `${d} (${DOMAIN_DESCRIPTIONS[d]})`).join('; ') +
        '.',
      inputSchema: { domain: z.enum(DOMAIN_NAMES) },
    },
    async ({ domain }) => {
      if (registry.isDomainLoaded(domain)) {
        return {
          payload: {
            loaded: domain,
            alreadyLoaded: true,
            tools: registry.getToolNamesForDomain(domain),
          },
        };
      }
      const tools = registry.loadDomain(domain);
      return {
        payload: {
          loaded: domain,
          tools,
          message: `Domain "${domain}" loaded with ${tools.length} tool(s).`,
        },
        resultCount: tools.length,
      };
    },
  );

  defineTool(
    registrar,
    'banner_status',
    {
      title: 'Banner MCP Status',
      description:
        'Server status: version, loaded domains and their tools, whether write tools are enabled, ' +
        'and which back ends are configured.',
      inputSchema: {},
    },
    async () => ({
      payload: {
        server: SERVER_NAME,
        version: SERVER_VERSION,
        transport: config.transport,
        writesEnabled: config.allowWrites,
        loadedDomains: registry.getLoadedDomains(),
        availableDomains: registry.getAvailableDomains(),
        toolsByDomain: registry.getToolsByDomain(),
        ethosBaseUrl: config.ethosBaseUrl,
        bannerRestEnabled: config.bannerRestEnabled,
        bannerBaseUrl: config.bannerBaseUrl ?? null,
        maxResponseChars: config.maxResponseChars,
      },
    }),
  );

  if (config.bannerRestEnabled) {
    defineTool(
      registrar,
      'banner_api_get',
      {
        title: 'Banner REST GET',
        description:
          'Read-only GET against a native Banner REST API on the configured BANNER_BASE_URL host ' +
          '(e.g. "/StudentApi/api/terms", "/BannerAdminBPAPI/api/..."). The path must be absolute ' +
          'on that host; put query parameters in "query". Only GET is supported.',
        inputSchema: {
          path: z.string().min(1).max(1000).describe('Absolute path on the Banner host'),
          query: z
            .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
            .optional()
            .describe('Query-string parameters'),
          fields: z.array(z.string()).max(50).optional().describe('Optional projection'),
        },
      },
      async (args) => {
        const banner = deps.banner();
        if (!banner) throw new ToolInputError('Banner REST is not configured');
        const path = validateBannerApiPath(args.path);
        const qs = args.query
          ? new URLSearchParams(
              Object.entries(args.query).map(([k, v]) => [k, String(v)] as [string, string]),
            ).toString()
          : '';
        const data = await banner.api('').get(qs ? `${path}?${qs}` : path);
        if (Array.isArray(data)) {
          const rows = data.map((d) => projectFields(d, args.fields));
          // Envelope so an oversized list is trimmed to valid JSON, not cut mid-record.
          return {
            payload: { offset: 0, count: rows.length, hasMore: false, data: rows },
            resultCount: rows.length,
          };
        }
        return { payload: projectFields(data, args.fields), resultCount: data == null ? 0 : 1 };
      },
    );
  }

  for (const domain of config.preloadDomains) {
    registry.loadDomain(domain);
  }

  return { server, registry, registrar };
}
