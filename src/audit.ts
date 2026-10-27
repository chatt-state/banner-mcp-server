/**
 * Audit logging for tool calls.
 *
 * Writes exactly one JSON line to stderr per tool call. Arguments are
 * sanitized first: values of fields that identify a person (Banner ID, email,
 * names, SSN, date of birth, identity documents, ...) are replaced with a
 * redaction marker, as is any string that looks like an email or Banner ID
 * wherever it appears. Model-chosen criteria and object payloads are logged as
 * key structure only; string payloads (GraphQL documents) as a keyed HMAC
 * fingerprint that cannot be reversed offline. Response bodies are never
 * logged; only a result count is.
 */

import { createHmac, randomBytes } from 'node:crypto';

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
    'ssnlast4',
    'governmentid',
    'nationalid',
    'identitydocument',
    'identitydocuments',
    'documentid',
    'documentnumber',
    'passport',
    'passportnumber',
    'driverslicense',
    'licensenumber',
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

/**
 * Fields holding free-form payloads (request bodies, GraphQL documents and
 * variables, REST query objects). A string payload is logged as a keyed
 * fingerprint; an object payload is logged as its key structure only.
 */
const PAYLOAD_KEYS = new Set(['data', 'query', 'variables', 'body'].map(normalizeKey));

/**
 * Fields whose keys are chosen by the model (generic Ethos criteria for any
 * resource), so key-name redaction cannot be trusted: only the key structure
 * is logged and every leaf value except a GUID is replaced.
 */
const STRUCTURE_ONLY_KEYS = new Set(['criteria'].map(normalizeKey));

const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Banner ID shape (one letter + 8 digits, e.g. A00123456). */
const BANNER_ID_RE = /^[A-Za-z]\d{8}$/;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Per-process HMAC key. Fingerprints let an auditor see that two calls in the
 * same run sent the same payload, but cannot be dictionary-attacked offline
 * (an unkeyed hash of "A00123456" can be found in seconds).
 */
const FINGERPRINT_KEY = randomBytes(32);

function fingerprint(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? null);
  const mac = createHmac('sha256', FINGERPRINT_KEY).update(text).digest('hex').slice(0, 12);
  return `[redacted hmac:${mac} len=${text.length}]`;
}

/** True for a string that looks like a personal identifier wherever it appears. */
function isIdentifierString(value: string): boolean {
  return value.includes('@') || BANNER_ID_RE.test(value.trim());
}

/** Masks a free string value: emails and Banner IDs are replaced, others kept. */
function sanitizeString(value: string): string {
  return isIdentifierString(value) ? '[redacted]' : value;
}

/**
 * Keeps only the key structure of `value`: every leaf is replaced with
 * "[redacted]" except GUIDs (record references, needed to audit which records
 * were accessed), booleans and null.
 */
function redactLeaves(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[depth]';
  if (value === null || value === undefined || typeof value === 'boolean') return value;
  if (typeof value === 'string') return GUID_RE.test(value) ? value : '[redacted]';
  if (Array.isArray(value)) return value.map((v) => redactLeaves(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = redactLeaves(v, depth + 1);
    }
    return out;
  }
  return '[redacted]';
}

/**
 * Masks REST path segments and drops the query string. The first two
 * segments (the API base, e.g. "/StudentApi/api") are kept unless they look
 * like identifiers; every later segment (resource names, IDs, name or email
 * path parameters) is replaced, since it can carry any value.
 */
export function redactPath(path: string): string {
  const [pathOnly] = path.split('?');
  let index = 0;
  const masked = (pathOnly ?? '')
    .split('/')
    .map((seg) => {
      if (seg === '') return seg;
      index++;
      if (index > 2) return '[seg]';
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
  if (typeof args === 'string') return sanitizeString(args);
  if (Array.isArray(args)) return args.map((v) => sanitizeArgs(v, depth + 1));
  if (typeof args !== 'object') return args;

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args as Record<string, unknown>)) {
    const norm = normalizeKey(key);
    if (value === undefined) continue;
    if (SENSITIVE_KEYS.has(norm)) {
      out[key] = '[redacted]';
    } else if (PAYLOAD_KEYS.has(norm)) {
      out[key] =
        value !== null && typeof value === 'object' ? redactLeaves(value) : fingerprint(value);
    } else if (STRUCTURE_ONLY_KEYS.has(norm)) {
      out[key] = redactLeaves(value);
    } else if (norm === 'path' && typeof value === 'string') {
      out[key] = redactPath(value);
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
