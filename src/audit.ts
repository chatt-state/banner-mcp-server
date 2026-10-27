/**
 * Audit logging for tool calls.
 *
 * Writes exactly one JSON line to stderr per tool call. Arguments are
 * sanitized first: values of fields that identify a person (Banner ID, email,
 * names, SSN, date of birth, ...) and free-form payloads (request bodies,
 * GraphQL documents) are replaced with a redaction marker. Response bodies are
 * never logged; only a result count is.
 */

import { createHash } from 'node:crypto';

/** Field names (case-insensitive, punctuation ignored) whose values are always redacted. */
const SENSITIVE_KEYS = new Set(
  [
    'bannerid',
    'email',
    'emails',
    'emailaddress',
    'address',
    'addresses',
    'addresslines',
    'ssn',
    'sin',
    'taxid',
    'dateofbirth',
    'dob',
    'birthdate',
    'name',
    'names',
    'fullname',
    'firstname',
    'lastname',
    'middlename',
    'preferredname',
    'credentials',
    'alternativecredentials',
    'value',
    'phone',
    'phones',
    'password',
    'token',
    'apikey',
    'authorization',
    'secret',
    'keyword',
    'keywordsearch',
    'username',
  ].map(normalizeKey),
);

/** Fields holding free-form payloads: logged as a fingerprint, never verbatim. */
const PAYLOAD_KEYS = new Set(['data', 'query', 'variables', 'body'].map(normalizeKey));

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fingerprint(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 12);
  return `[redacted sha256:${hash} len=${text.length}]`;
}

/** Masks identifier-looking path segments and drops the query string. */
export function redactPath(path: string): string {
  const [pathOnly] = path.split('?');
  const masked = (pathOnly ?? '')
    .split('/')
    .map((seg) => {
      if (seg === '') return seg;
      let decoded = seg;
      try {
        decoded = decodeURIComponent(seg);
      } catch {
        /* keep raw */
      }
      if (
        /@/.test(decoded) ||
        /\d{3,}/.test(decoded) ||
        /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(decoded)
      ) {
        return '[id]';
      }
      return seg;
    })
    .join('/');
  return path.includes('?') ? `${masked}?[query]` : masked;
}

/**
 * Returns a deep copy of `args` that is safe to log.
 */
export function sanitizeArgs(args: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (args === null || args === undefined) return args;
  if (Array.isArray(args)) return args.map((v) => sanitizeArgs(v, depth + 1));
  if (typeof args !== 'object') return args;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    const norm = normalizeKey(key);
    if (value === undefined) continue;
    if (SENSITIVE_KEYS.has(norm)) {
      out[key] = '[redacted]';
    } else if (PAYLOAD_KEYS.has(norm)) {
      out[key] = fingerprint(value);
    } else if (norm === 'path' && typeof value === 'string') {
      out[key] = redactPath(value);
    } else if (typeof value === 'string' && /@/.test(value)) {
      // An email address under an unexpected key name.
      out[key] = '[redacted]';
    } else {
      out[key] = sanitizeArgs(value, depth + 1);
    }
  }
  return out;
}

export interface AuditEntry {
  tool: string;
  args: unknown;
  durationMs: number;
  resultCount?: number;
  truncated?: boolean;
  error?: string;
  sessionId?: string;
}

/** Sink for audit lines; replaceable in tests. */
let sink: (line: string) => void = (line) => {
  process.stderr.write(`${line}\n`);
};

let enabled = true;

/** Replace the audit sink (tests) and return the previous one. */
export function setAuditSink(fn: (line: string) => void): (line: string) => void {
  const prev = sink;
  sink = fn;
  return prev;
}

/** Enable or disable audit output (BANNER_AUDIT_LOG). */
export function setAuditEnabled(value: boolean): void {
  enabled = value;
}

/** Writes one audit line for a tool call. */
export function audit(entry: AuditEntry): void {
  if (!enabled) return;
  const record: Record<string, unknown> = {
    ts: new Date().toISOString(),
    type: 'tool_call',
    tool: entry.tool,
    args: sanitizeArgs(entry.args),
    durationMs: Math.round(entry.durationMs),
  };
  if (entry.sessionId) record['sessionId'] = entry.sessionId;
  if (entry.resultCount !== undefined) record['resultCount'] = entry.resultCount;
  if (entry.truncated) record['truncated'] = true;
  if (entry.error !== undefined) record['error'] = entry.error;
  sink(JSON.stringify(record));
}

/** Writes a non-tool security event (e.g. rejected HTTP auth). */
export function auditEvent(type: string, fields: Record<string, unknown> = {}): void {
  if (!enabled) return;
  sink(JSON.stringify({ ts: new Date().toISOString(), type, ...(sanitizeArgs(fields) as object) }));
}
