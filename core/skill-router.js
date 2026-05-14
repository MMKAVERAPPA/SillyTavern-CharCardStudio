// core/skill-router.js
// Assembles the right skill modules for each AI call based on context

import { SKILL_IDENTITY, SKILL_FIELD_DEFINITIONS, SKILL_WRITING_PHILOSOPHY, SKILL_NAMING } from '../prompts/skills/core.js';
import { SKILL_FORMAT_PROSE, SKILL_FORMAT_PLIST, SKILL_FORMAT_ALICHAT } from '../prompts/skills/formats.js';
import { SKILL_TYPE_SINGLE, SKILL_TYPE_MULTI, SKILL_TYPE_SCENARIO } from '../prompts/skills/card-types.js';
import { SKILL_FIRST_MESSAGE, SKILL_SYSTEM_PROMPT, SKILL_NSFW, SKILL_PSYCHOLOGY } from '../prompts/skills/field-craft.js';
import {
    SKILL_IDEATION_GREETING, SKILL_IDEATION_CONCEPT_RATING, SKILL_IDEATION_IDEAS,
    SKILL_IDEATION_PILLAR_DISCUSSION, SKILL_VOICE_CALIBRATION, SKILL_PROPOSED_PROFILE,
    SKILL_LOAD_EXISTING,
} from '../prompts/skills/phase-ideation.js';
import {
    SKILL_GENERATION_COT, SKILL_GENERATION_FIELD_INSTRUCTIONS, SKILL_GENERATE_ALL,
    SKILL_REWRITE_INSTRUCTIONS,
} from '../prompts/skills/phase-generation.js';
import {
    SKILL_LOREBOOK_IDEATION, SKILL_LOREBOOK_GENERATION,
    SKILL_LOREBOOK_KEYWORD_CHECK, SKILL_LOREBOOK_ORGANIZE,
} from '../prompts/skills/phase-lorebook.js';
import {
    SKILL_COHERENCE_AUDIT, SKILL_SMART_SUGGESTIONS, SKILL_MES_EXAMPLE_AUDIT,
    SKILL_CHARACTER_SIMULATION, SKILL_CONFLICT_CHECK, SKILL_CARD_REVIEW,
} from '../prompts/skills/phase-audit.js';
import { IDEATION_CHAT_SKILL, BUILDING_CHAT_SKILL } from '../prompts/skills/chat-skills.js';

// Field dependency graph: when generating field X, which other fields need FULL content (not truncated)
const FIELD_DEPENDENCIES = {
    description:        [],
    personality:        ['description'],
    scenario:           ['description'],
    first_mes:          ['description', 'scenario', 'personality'],
    mes_example:        ['description', 'personality', 'first_mes'],
    system_prompt:      ['description'],
    creator_notes:      [],
    alternate_greeting: ['first_mes', 'description', 'scenario'],
    tags:               ['description', 'personality'],
    name:               [],
};

// Fields that should get field-craft skills when being generated
const FIELD_CRAFT_MAP = {
    first_mes:          SKILL_FIRST_MESSAGE,
    alternate_greeting: SKILL_FIRST_MESSAGE,
    system_prompt:      SKILL_SYSTEM_PROMPT,
};

export class SkillRouter {

    /**
     * Build the system prompt by assembling relevant skills.
     * @param {Object} options
     * @param {string} options.phase - 'ideation' | 'generation' | 'lorebook' | 'audit'
     * @param {string} [options.task] - Specific task within the phase
     * @param {string} [options.field] - Field being generated/edited
     * @param {string} [options.cardType] - 'single' | 'multi' | 'scenario'
     * @param {string} [options.format] - 'prose' | 'plist_alichat'
     * @param {boolean} [options.nsfw] - Whether NSFW content is involved
     * @param {string} [options.customRules] - User's custom system prompt rules
     * @returns {string} Assembled system prompt
     */
    buildSystemPrompt(options = {}) {
        const {
            phase = 'generation',
            task = '',
            field = '',
            cardType = 'single',
            format = 'prose',
            nsfw = false,
            customRules = '',
        } = options;

        const skills = [];

        // ── Layer 1: Core (always loaded) ──────────────────────────────
        skills.push(SKILL_IDENTITY);
        skills.push(SKILL_FIELD_DEFINITIONS);
        skills.push(SKILL_WRITING_PHILOSOPHY);
        skills.push(SKILL_NAMING);

        // ── Layer 2: Format ────────────────────────────────────────────
        if (format === 'plist_alichat') {
            skills.push(SKILL_FORMAT_PLIST);
            skills.push(SKILL_FORMAT_ALICHAT);
        } else {
            skills.push(SKILL_FORMAT_PROSE);
        }

        // ── Layer 3: Card Type ─────────────────────────────────────────
        if (cardType === 'multi') {
            skills.push(SKILL_TYPE_MULTI);
        } else if (cardType === 'scenario') {
            skills.push(SKILL_TYPE_SCENARIO);
        } else {
            skills.push(SKILL_TYPE_SINGLE);
        }

        // ── Layer 4: Phase-specific skills ─────────────────────────────
        switch (phase) {
            case 'ideation':
                this._addIdeationSkills(skills, task);
                break;
            case 'generation':
                this._addGenerationSkills(skills, field, nsfw, task);
                break;
            case 'lorebook':
                this._addLorebookSkills(skills, task);
                break;
            case 'audit':
                this._addAuditSkills(skills, task);
                break;
        }

        // ── Phase Awareness Context ────────────────────────────────────
        const phaseNames = {
            'ideation': 'IDEATION (Brainstorming & Setup)',
            'generation': 'BUILDING (Drafting Card Fields)',
            'lorebook': 'LOREBOOK (Worldbuilding)',
            'audit': 'AUDIT (Review & Polish)'
        };
        skills.push(`## Current Phase: ${phaseNames[phase] || phase.toUpperCase()}`);

        // ── Layer 5: Custom rules ──────────────────────────────────────
        if (customRules?.trim()) {
            skills.push('## User Custom Rules\n' + customRules);
        }

        return skills.join('\n\n');
    }

    /**
     * Get the field dependency list for smart context sizing.
     * @param {string} fieldName - The field being generated
     * @returns {string[]} Fields that need full content (not truncated)
     */
    getFieldDependencies(fieldName) {
        return FIELD_DEPENDENCIES[fieldName] || [];
    }

    /**
     * Get the rewrite instruction for a given action.
     */
    getRewriteInstruction(action) {
        return SKILL_REWRITE_INSTRUCTIONS[action] || null;
    }

    /**
     * Get field-specific generation instruction.
     */
    getFieldInstruction(fieldName) {
        return SKILL_GENERATION_FIELD_INSTRUCTIONS[fieldName] || '';
    }

    /**
     * Get the generate-all prompt.
     */
    getGenerateAllPrompt() {
        return SKILL_GENERATE_ALL;
    }

    // ── Ideation task prompts ──────────────────────────────────────────
    getIdeationPrompt(task) {
        const map = {
            greeting: SKILL_IDEATION_GREETING,
            concept_rating: SKILL_IDEATION_CONCEPT_RATING,
            generate_ideas: SKILL_IDEATION_IDEAS,
            pillar_discussion: SKILL_IDEATION_PILLAR_DISCUSSION,
            voice_calibration: SKILL_VOICE_CALIBRATION,
            proposed_profile: SKILL_PROPOSED_PROFILE,
            load_existing: SKILL_LOAD_EXISTING,
        };
        return map[task] || '';
    }

    // ── Lorebook task prompts ──────────────────────────────────────────
    getLorebookPrompt(task) {
        const map = {
            brainstorm: SKILL_LOREBOOK_IDEATION,
            generate: SKILL_LOREBOOK_GENERATION,
            keyword_check: SKILL_LOREBOOK_KEYWORD_CHECK,
            organize: SKILL_LOREBOOK_ORGANIZE,
        };
        return map[task] || '';
    }

    // ── Audit task prompts ─────────────────────────────────────────────
    getAuditPrompt(task) {
        const map = {
            coherence: SKILL_COHERENCE_AUDIT,
            suggestions: SKILL_SMART_SUGGESTIONS,
            mes_example: SKILL_MES_EXAMPLE_AUDIT,
            simulation: SKILL_CHARACTER_SIMULATION,
            conflict: SKILL_CONFLICT_CHECK,
            review: SKILL_CARD_REVIEW,
        };
        return map[task] || '';
    }

    // ── Private: Skill assembly per phase ──────────────────────────────

    _addIdeationSkills(skills, task) {
        skills.push(SKILL_PSYCHOLOGY);
        // Voice calibration skill is loaded when needed
        if (task === 'voice_calibration') {
            skills.push(SKILL_VOICE_CALIBRATION);
        } else if (task === 'general_chat') {
            skills.push(IDEATION_CHAT_SKILL);
        }
    }

    _addGenerationSkills(skills, field, nsfw, task) {
        if (task === 'general_chat') {
            skills.push(BUILDING_CHAT_SKILL);
            return; // Skip COT and field instructions for general chat
        }

        skills.push(SKILL_GENERATION_COT);

        // Field-specific deep expertise
        if (field && SKILL_GENERATION_FIELD_INSTRUCTIONS[field]) {
            skills.push(SKILL_GENERATION_FIELD_INSTRUCTIONS[field]);
        }

        // Field-craft skills (first_mes gets FM craft, system_prompt gets SP craft)
        if (field && FIELD_CRAFT_MAP[field]) {
            skills.push(FIELD_CRAFT_MAP[field]);
        }

        // NSFW skill when relevant
        if (nsfw) {
            skills.push(SKILL_NSFW);
        }

        // Psychology for description/personality generation
        if (['description', 'personality', 'first_mes'].includes(field)) {
            skills.push(SKILL_PSYCHOLOGY);
        }
    }

    _addLorebookSkills(skills, task) {
        // Lorebook generation always gets the full WI spec
        if (task === 'generate' || !task) {
            skills.push(SKILL_LOREBOOK_GENERATION);
        }
    }

    _addAuditSkills(skills, task) {
        // Load specific audit skill based on task
        if (task === 'simulation') {
            skills.push(SKILL_CHARACTER_SIMULATION);
        }
    }
}

export const skillRouter = new SkillRouter();
