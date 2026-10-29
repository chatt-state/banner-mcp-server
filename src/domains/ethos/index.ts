/**
 * Ethos domain module.
 *
 * Generic access to any EEDM resource by name: get, list, criteria filter,
 * QAPI search and GraphQL. Create/update/delete and change-notification
 * consumption are registered only when BANNER_ALLOW_WRITES=true.
 */

import type { ToolRegistrar } from '../../tools/define.js';
import { registerEthosTools } from './tools.js';

/** Registers ethos domain tools. */
export function register(reg: ToolRegistrar): void {
  registerEthosTools(reg);
}
