/**
 * Tool output shaping: field projection, compact JSON and a size cap.
 *
 * Every tool response goes through renderPayload(), so no tool can return
 * more than BANNER_MAX_RESPONSE_CHARS characters. When the cap is hit the
 * response says so explicitly and tells the model how to narrow the request.
 */

import type { PaginatedResponse } from 'ellucian-banner';

/** Fields always kept by a projection so results stay addressable. */
const ALWAYS_KEEP = ['id'];

/** Path segments never followed (prototype pollution guard). */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Returns the part of `source` selected by `parts`, keeping the path's keys
 * (so `pick({a:{b:1,c:2}}, ["a","b"])` is `{a:{b:1}}`). Arrays along the path
 * are mapped element-wise; elements without the path become `undefined` so
 * indexes stay aligned for merging.
 */
function pick(source: unknown, parts: string[]): unknown {
  if (parts.length === 0) return source;
  if (Array.isArray(source)) {
    const mapped = source.map((item) => pick(item, parts));
    return mapped.some((v) => v !== undefined) ? mapped : undefined;
  }
  if (source === null || typeof source !== 'object') return undefined;
  const [head, ...rest] = parts;
  const value = (source as Record<string, unknown>)[head!];
  if (value === undefined) return undefined;
  const sub = pick(value, rest);
  return sub === undefined ? undefined : { [head!]: sub };
}

/** Replaces `undefined` array slots (elements with none of the fields) with `{}`. */
function fillHoles(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? {} : fillHoles(v)));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, fillHoles(v)]),
    );
  }
  return value;
}

function deepMerge(a: unknown, b: unknown): unknown {
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    return Array.from({ length: len }, (_, i) => deepMerge(a[i], b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
    for (const [k, v] of Object.entries(b as Record<string, unknown>)) {
      out[k] = k in out ? deepMerge(out[k], v) : v;
    }
    return out;
  }
  return b === undefined ? a : b;
}

/**
 * Projects a single record to the given dot-paths (e.g. ["names.lastName",
 * "credentials"]). Arrays along a path are mapped element-wise. `id` is always
 * kept. With no fields, returns the record unchanged.
 */
export function projectFields(record: unknown, fields?: readonly string[]): unknown {
  if (!fields || fields.length === 0) return record;
  if (record === null || typeof record !== 'object') return record;
  if (Array.isArray(record)) return record.map((r) => projectFields(r, fields));
  let out: unknown = {};
  for (const field of [...ALWAYS_KEEP, ...fields]) {
    const parts = field.split('.').filter(Boolean);
    if (parts.length === 0 || parts.some((p) => UNSAFE_KEYS.has(p))) continue;
    const picked = pick(record, parts);
    if (picked !== undefined) out = deepMerge(out, picked);
  }
  return fillHoles(out);
}

/** Compact page envelope returned by every search/list tool. */
export interface PageEnvelope<T = unknown> {
  totalCount?: number;
  offset: number;
  count: number;
  hasMore: boolean;
  nextOffset?: number;
  data: T[];
  [key: string]: unknown;
}

/** Converts an SDK page into the tool envelope, applying a field projection. */
export function pageEnvelope<T>(
  page: PaginatedResponse<T>,
  fields?: readonly string[],
  extra: Record<string, unknown> = {},
): PageEnvelope {
  const data = page.data.map((r) => projectFields(r, fields));
  const env: PageEnvelope = {
    ...extra,
    totalCount: page.totalCount,
    offset: page.offset,
    count: data.length,
    hasMore: page.hasMore,
    data,
  };
  if (page.hasMore) env.nextOffset = page.offset + page.data.length;
  return env;
}

export interface RenderResult {
  text: string;
  truncated: boolean;
}

function notice(maxChars: number, extra: string): string {
  return (
    `Response exceeded the ${maxChars}-character limit (BANNER_MAX_RESPONSE_CHARS) and was truncated. ` +
    extra +
    'Narrow the query (add search criteria), lower "limit", or pass "fields" to return fewer properties.'
  );
}

/**
 * Serializes a payload as compact JSON, enforcing the character cap.
 *
 * Payloads with a top-level `data` array (page envelopes) are trimmed to the
 * largest prefix of `data` that fits, keeping the JSON valid and adding a
 * `truncation` object. Anything else is cut and followed by a plain-text
 * notice.
 */
export function renderPayload(payload: unknown, maxChars: number): RenderResult {
  const text = JSON.stringify(payload) ?? 'null';
  if (text.length <= maxChars) return { text, truncated: false };

  if (
    payload !== null &&
    typeof payload === 'object' &&
    !Array.isArray(payload) &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    const env = payload as Record<string, unknown> & { data: unknown[] };
    const total = env.data.length;
    const offset = typeof env['offset'] === 'number' ? env['offset'] : 0;
    const build = (n: number) => {
      const next = offset + n;
      return JSON.stringify({
        ...env,
        count: n,
        hasMore: true,
        nextOffset: next,
        data: env.data.slice(0, n),
        truncation: {
          truncated: true,
          returned: n,
          omittedOnThisPage: total - n,
          notice: notice(
            maxChars,
            `Only ${n} of ${total} records on this page are included; continue with offset=${next}. `,
          ),
        },
      });
    };
    let lo = 0;
    let hi = total;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (build(mid).length <= maxChars) lo = mid;
      else hi = mid - 1;
    }
    const candidate = build(lo);
    if (candidate.length <= maxChars) return { text: candidate, truncated: true };
  }

  const suffix = `\n[TRUNCATED] ${notice(maxChars, `Showing the first part of a ${text.length}-character result; the JSON above is incomplete. `)}`;
  const keep = Math.max(0, maxChars - suffix.length);
  return { text: text.slice(0, keep) + suffix, truncated: true };
}
