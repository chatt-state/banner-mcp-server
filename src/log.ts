/**
 * Minimal diagnostic logger (stderr). Separate from the audit log: these are
 * operational messages and never contain request arguments or Banner data.
 */

import type { LogLevel } from './config.js';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
let threshold: number = ORDER.info;

/** Sets the minimum level written (BANNER_LOG_LEVEL). */
export function setLogLevel(level: LogLevel): void {
  threshold = ORDER[level];
}

/** Writes `message` to stderr when `level` is at or above the threshold. */
export function log(level: LogLevel, message: string): void {
  if (ORDER[level] < threshold) return;
  process.stderr.write(`[${level}] ${message}\n`);
}
