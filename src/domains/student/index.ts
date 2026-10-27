/**
 * Student domain module.
 *
 * Registers person lookup, student context and student-record tools.
 */

import type { ToolRegistrar } from '../../tools/define.js';
import { registerStudentTools } from './tools.js';

/** Registers student domain tools. */
export function register(reg: ToolRegistrar): void {
  registerStudentTools(reg);
}
