// prompts/lorebook.js
// v3.0 — Delegates to skill modules. Kept for backward compatibility.

// Re-export from skills for backward compatibility
import {
    SKILL_LOREBOOK_IDEATION,
    SKILL_LOREBOOK_GENERATION,
    SKILL_LOREBOOK_KEYWORD_CHECK,
    SKILL_LOREBOOK_ORGANIZE,
} from './skills/phase-lorebook.js';

export const LOREBOOK_IDEATION_PROMPT = SKILL_LOREBOOK_IDEATION;
export const LOREBOOK_ENTRY_PROMPT = SKILL_LOREBOOK_GENERATION;
export const KEYWORD_QUALITY_CHECK_PROMPT = SKILL_LOREBOOK_KEYWORD_CHECK;
export const LOREBOOK_ORGANIZE_PROMPT = SKILL_LOREBOOK_ORGANIZE;
