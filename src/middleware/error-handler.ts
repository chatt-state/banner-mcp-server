/**
 * Error handler middleware for MCP tool execution.
 *
 * Provides consistent error formatting and logging for all
 * tool handler errors, mapping Banner SDK errors to MCP error responses.
 */

import { BannerError, AuthError, NotFoundError, RateLimitError } from 'ellucian-banner';

/** MCP-formatted error response shape. */
export interface McpErrorResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

/**
 * Formats an error into an MCP-compatible error response object.
 *
 * - BannerError subclasses: includes status code and specific message
 * - Error: includes the error message
 * - Unknown: generic fallback message
 */
export function formatMcpError(error: unknown): McpErrorResponse {
  let text: string;

  if (error instanceof AuthError) {
    text = `Authentication Error (${error.statusCode}): ${error.message}`;
  } else if (error instanceof NotFoundError) {
    text = `Not Found: ${error.message}`;
  } else if (error instanceof RateLimitError) {
    const retryInfo = error.retryAfter ? ` Retry after ${error.retryAfter}s.` : '';
    text = `Rate Limited: ${error.message}${retryInfo}`;
  } else if (error instanceof BannerError) {
    text = `Banner API Error (${error.statusCode}): ${error.message}`;
  } else if (error instanceof Error) {
    text = `Error: ${error.message}`;
  } else {
    text = 'An unexpected error occurred';
  }

  return {
    content: [{ type: 'text', text }],
    isError: true,
  };
}

/**
 * Wraps a tool handler function with error handling.
 *
 * On success, returns the handler's result. On failure, catches the error
 * and returns an MCP-formatted error response.
 */
export async function wrapToolHandler<T>(
  handler: () => Promise<T>,
): Promise<T | McpErrorResponse> {
  try {
    return await handler();
  } catch (error: unknown) {
    return formatMcpError(error);
  }
}
