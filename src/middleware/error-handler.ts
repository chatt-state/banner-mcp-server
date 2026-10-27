/**
 * Error handler middleware for MCP tool execution.
 *
 * Provides consistent error formatting for all tool handler errors, mapping
 * Banner SDK errors to MCP error responses. SDK error messages contain only
 * the HTTP status line and Ethos error codes, never response bodies, so they
 * are safe to return to the model and to the audit log. `responseBody` is
 * deliberately never read here.
 */

import {
  BannerError,
  AuthError,
  NotFoundError,
  RateLimitError,
  ValidationError,
  TimeoutError,
  ServerError,
} from 'ellucian-banner';

/** MCP-formatted error response shape. */
export interface McpErrorResponse {
  [key: string]: unknown;
  content: Array<{ type: 'text'; text: string }>;
  isError: true;
}

/** Thrown by tools for invalid argument combinations; shown to the model as-is. */
export class ToolInputError extends Error {
  override readonly name = 'ToolInputError';
}

/** A short, log-safe description of an error (no response bodies). */
export function describeError(error: unknown): string {
  if (error instanceof AuthError) {
    const hint =
      error.statusCode === 403
        ? ' The Ethos application API key is not authorized for this resource/version; ask the Ethos administrator to grant it.'
        : '';
    return `Authentication Error (${error.statusCode}): ${error.message}${hint}`;
  }
  if (error instanceof NotFoundError) return `Not Found: ${error.message}`;
  if (error instanceof RateLimitError) {
    const retryInfo = error.retryAfter ? ` Retry after ${error.retryAfter}s.` : '';
    return `Rate Limited: ${error.message}${retryInfo}`;
  }
  if (error instanceof ValidationError) return `Validation Error (400): ${error.message}`;
  if (error instanceof TimeoutError) return `Timeout: ${error.message}`;
  if (error instanceof ServerError) {
    return `Banner Server Error (${error.statusCode}): ${error.message}`;
  }
  if (error instanceof BannerError) {
    return `Banner API Error (${error.statusCode}): ${error.message}`;
  }
  if (error instanceof ToolInputError) return `Invalid input: ${error.message}`;
  if (error instanceof Error) return `Error: ${error.message}`;
  return 'An unexpected error occurred';
}

/**
 * Formats an error into an MCP-compatible error response object.
 */
export function formatMcpError(error: unknown): McpErrorResponse {
  return {
    content: [{ type: 'text', text: describeError(error) }],
    isError: true,
  };
}

/**
 * Wraps a tool handler function with error handling.
 *
 * On success, returns the handler's result. On failure, catches the error
 * and returns an MCP-formatted error response.
 */
export async function wrapToolHandler<T>(handler: () => Promise<T>): Promise<T | McpErrorResponse> {
  try {
    return await handler();
  } catch (error: unknown) {
    return formatMcpError(error);
  }
}
