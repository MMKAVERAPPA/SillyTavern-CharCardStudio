// prompts/base.js
// v3.0 — Delegates to skill-router for system prompt assembly.
// Kept for backward compatibility — wraps skillRouter.buildSystemPrompt()

import { skillRouter } from '../core/skill-router.js';

// Re-export individual prompts for any code that still imports them directly
export { SKILL_IDENTITY as IDENTITY_PROMPT } from './skills/core.js';
export { SKILL_FIELD_DEFINITIONS as FIELD_DEFINITIONS_PROMPT } from './skills/core.js';
export { SKILL_WRITING_PHILOSOPHY as WRITING_PHILOSOPHY_PROMPT } from './skills/core.js';
export { SKILL_NAMING as NO_GENERIC_NAMES_RULE } from './skills/core.js';

/**
 * Build the base system prompt using the skill router.
 * This is the backward-compatible entry point used by existing code.
 *
 * @param {string} [customRules] - User's custom system prompt rules
 * @param {Object} [skillOptions] - Optional skill routing options
 * @returns {string} Assembled system prompt
 */
export function buildBaseSystemPrompt(customRules = '', skillOptions = {}) {
    return skillRouter.buildSystemPrompt({
        customRules,
        ...skillOptions,
    });
}
