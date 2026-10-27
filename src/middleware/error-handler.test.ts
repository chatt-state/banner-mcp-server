import { describe, it, expect } from 'vitest';
import { formatMcpError, ToolInputError, wrapToolHandler } from './error-handler.js';
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  BannerError,
  ValidationError,
  TimeoutError,
  ServerError,
} from 'ellucian-banner';

describe('formatMcpError', () => {
  it('formats AuthError and hints at Ethos grants on 403', () => {
    const r401 = formatMcpError(new AuthError('Unauthorized', 401));
    expect(r401.isError).toBe(true);
    expect(r401.content[0]?.text).toContain('Authentication Error (401)');
    const r403 = formatMcpError(new AuthError('Forbidden', 403));
    expect(r403.content[0]?.text).toContain('Ethos administrator');
  });

  it('formats NotFoundError', () => {
    expect(formatMcpError(new NotFoundError('Resource missing')).content[0]?.text).toContain(
      'Not Found',
    );
  });

  it('formats RateLimitError with retryAfter', () => {
    const text = formatMcpError(new RateLimitError('Too many requests', 30)).content[0]?.text;
    expect(text).toContain('Rate Limited');
    expect(text).toContain('30s');
  });

  it('formats other SDK errors', () => {
    expect(formatMcpError(new ValidationError('bad')).content[0]?.text).toContain(
      'Validation Error',
    );
    expect(formatMcpError(new TimeoutError('slow')).content[0]?.text).toContain('Timeout');
    expect(formatMcpError(new ServerError('boom', 503)).content[0]?.text).toContain('503');
    expect(formatMcpError(new BannerError('Server error', 418)).content[0]?.text).toContain(
      'Banner API Error (418)',
    );
  });

  it('never includes responseBody', () => {
    const err = new BannerError('Bad Gateway', 502, '{"ssn":"123-45-6789"}');
    expect(formatMcpError(err).content[0]?.text).not.toContain('123-45-6789');
  });

  it('formats input and generic errors', () => {
    expect(formatMcpError(new ToolInputError('x')).content[0]?.text).toBe('Invalid input: x');
    expect(formatMcpError(new Error('oops')).content[0]?.text).toBe('Error: oops');
    expect(formatMcpError('string error').content[0]?.text).toBe('An unexpected error occurred');
  });
});

describe('wrapToolHandler', () => {
  it('returns handler result on success', async () => {
    const result = await wrapToolHandler(async () => ({
      content: [{ type: 'text' as const, text: 'ok' }],
    }));
    expect(result).toEqual({ content: [{ type: 'text', text: 'ok' }] });
  });

  it('catches errors and returns MCP error response', async () => {
    const result = await wrapToolHandler(async () => {
      throw new NotFoundError('missing');
    });
    expect(result).toHaveProperty('isError', true);
  });
});
