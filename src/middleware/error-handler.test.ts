import { describe, it, expect } from 'vitest';
import { formatMcpError, wrapToolHandler } from './error-handler.js';
import { AuthError, NotFoundError, RateLimitError, BannerError } from 'ellucian-banner';

describe('formatMcpError', () => {
  it('should format AuthError', () => {
    const result = formatMcpError(new AuthError('Unauthorized', 401));
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('Authentication Error');
    expect(result.content[0]?.text).toContain('401');
  });

  it('should format NotFoundError', () => {
    const result = formatMcpError(new NotFoundError('Resource missing'));
    expect(result.content[0]?.text).toContain('Not Found');
  });

  it('should format RateLimitError with retryAfter', () => {
    const result = formatMcpError(new RateLimitError('Too many requests', 30));
    expect(result.content[0]?.text).toContain('Rate Limited');
    expect(result.content[0]?.text).toContain('30s');
  });

  it('should format generic BannerError', () => {
    const result = formatMcpError(new BannerError('Server error', 500));
    expect(result.content[0]?.text).toContain('Banner API Error');
    expect(result.content[0]?.text).toContain('500');
  });

  it('should format standard Error', () => {
    const result = formatMcpError(new Error('oops'));
    expect(result.content[0]?.text).toBe('Error: oops');
  });

  it('should handle unknown errors', () => {
    const result = formatMcpError('string error');
    expect(result.content[0]?.text).toBe('An unexpected error occurred');
  });
});

describe('wrapToolHandler', () => {
  it('should return handler result on success', async () => {
    const result = await wrapToolHandler(async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }));
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('should catch errors and return MCP error response', async () => {
    const result = await wrapToolHandler(async () => {
      throw new NotFoundError('missing');
    });
    expect(result).toHaveProperty('isError', true);
  });
});
