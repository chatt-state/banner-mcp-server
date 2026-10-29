import { describe, it, expect } from 'vitest';
import { describeError, ToolInputError } from './error-handler.js';
import { runTool } from '../tools/define.js';
import {
  AuthError,
  NotFoundError,
  RateLimitError,
  BannerError,
  ValidationError,
  TimeoutError,
  ServerError,
} from 'ellucian-banner';

describe('describeError', () => {
  it('formats AuthError and hints at Ethos grants on 403', () => {
    expect(describeError(new AuthError('Unauthorized', 401))).toContain(
      'Authentication Error (401)',
    );
    expect(describeError(new AuthError('Forbidden', 403))).toContain('Ethos administrator');
  });

  it('formats NotFoundError', () => {
    expect(describeError(new NotFoundError('Resource missing'))).toContain('Not Found');
  });

  it('formats RateLimitError with retryAfter', () => {
    const text = describeError(new RateLimitError('Too many requests', 30));
    expect(text).toContain('Rate Limited');
    expect(text).toContain('30s');
  });

  it('formats other SDK errors', () => {
    expect(describeError(new ValidationError('bad'))).toContain('Validation Error');
    expect(describeError(new TimeoutError('slow'))).toContain('Timeout');
    expect(describeError(new ServerError('boom', 503))).toContain('503');
    expect(describeError(new BannerError('Server error', 418))).toContain('Banner API Error (418)');
  });

  it('never includes responseBody', () => {
    const err = new BannerError('Bad Gateway', 502, '{"ssn":"123-45-6789"}');
    expect(describeError(err)).not.toContain('123-45-6789');
  });

  it('formats input and generic errors', () => {
    expect(describeError(new ToolInputError('x'))).toBe('Invalid input: x');
    expect(describeError(new Error('oops'))).toBe('Error: oops');
    expect(describeError('string error')).toBe('An unexpected error occurred');
  });
});

describe('runTool error mapping', () => {
  it('returns the rendered payload on success', async () => {
    const result = await runTool('t', {}, 10_000, async () => ({ payload: { ok: true } }));
    expect(result).toEqual({ content: [{ type: 'text', text: '{"ok":true}' }] });
  });

  it('turns a thrown SDK error into an MCP error result', async () => {
    const result = await runTool('t', {}, 10_000, async () => {
      throw new NotFoundError('missing');
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(describeError(new NotFoundError('missing')));
  });
});
