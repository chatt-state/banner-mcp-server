import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { SERVER_VERSION } from './version.js';

describe('version', () => {
  it('matches package.json', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version: string;
    };
    expect(SERVER_VERSION).toBe(pkg.version);
  });
});
