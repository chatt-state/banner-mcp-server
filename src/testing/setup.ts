/**
 * Vitest setup: keep audit lines out of test output. Tests that assert on
 * audit output install their own sink.
 */
import { setAuditSink } from '../audit.js';

setAuditSink(() => undefined);
