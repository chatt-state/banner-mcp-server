/**
 * MCP Server setup and configuration.
 *
 * Responsible for creating and configuring the MCP server instance,
 * registering navigator tools, and managing the server lifecycle.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from './config.js';
import { domainRegistry, DOMAIN_NAMES } from './domains/registry.js';

/** Create and export the McpServer instance. */
export const mcpServer = new McpServer(
  {
    name: 'banner-mcp-server',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: { listChanged: true },
    },
  },
);

/**
 * Register the always-available navigator tools.
 * These tools allow clients to discover and load domain tool sets.
 */

mcpServer.registerTool(
  'banner_navigate',
  {
    description:
      'Load a Banner domain tool set. ' +
      'Available domains: student, financial_aid, finance, hr, ethos.',
    inputSchema: {
      domain: z.enum(DOMAIN_NAMES),
    },
  },
  async ({ domain }) => {
    if (domainRegistry.isDomainLoaded(domain)) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Domain "${domain}" is already loaded. Use banner_status to see available tools.`,
          },
        ],
      };
    }

    const toolNames = await domainRegistry.loadDomain(domain);
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              loaded: domain,
              tools: toolNames,
              message: `Domain "${domain}" loaded successfully with ${toolNames.length} tool(s).`,
            },
            null,
            2,
          ),
        },
      ],
    };
  },
);

mcpServer.registerTool(
  'banner_status',
  {
    description: 'Returns the current status of the Banner MCP server.',
  },
  async () => {
    const config = getConfig();
    const status = {
      loadedDomains: domainRegistry.getLoadedDomains(),
      ethosBaseUrl: config.ethosBaseUrl,
      bannerBaseUrl: config.bannerBaseUrl ?? null,
      hasBannerAuth: !!(config.bannerUsername && config.bannerPassword),
    };

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(status, null, 2),
        },
      ],
    };
  },
);
