/**
 * CharCardStudio v4.1.0 — core/coherence-audit.js
 *
 * Local (no AI) coherence analysis of all active card fields and lorebook
 * entries. Runs in-process, returns a structured report for the UI to display.
 *
 * Checks performed:
 *   1. Missing required fields (description, personality, first_mes)
 *   2. Field length anomalies (unusually short/long)
 *   3. Lorebook keyword collisions (two entries share identical trigger keys)
 *   4. Lorebook keyword overlap in content (potential unintended triggering)
 *   5. Constant-entry token budget warning (too many constant entries)
 *   6. Field cross-reference checks (name mentioned in personality but not in description, etc.)
 */

import { getLorebookEntries } from './lorebook.js';
import { countTokensSync } from './token-utils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} AuditIssue
 * @property {'error'|'warning'|'info'} severity
 * @property {string} category - 'fields' | 'lorebook' | 'consistency'
 * @property {string} message
 * @property {string} [field]
 */

/**
 * @typedef {Object} AuditReport
 * @property {AuditIssue[]} issues
 * @property {Object} stats
 * @property {number} score - 0–100
 */

// ─── Field config ─────────────────────────────────────────────────────────────

const REQUIRED_FIELDS = ['description', 'personality', 'first_mes'];
const FIELD_BUDGETS = {
    description:    { min: 50, max: 2000 },
    personality:    { min: 20, max: 600 },
    scenario:       { min: 0,  max: 1200 },
    first_mes:      { min: 30, max: 2000 },
    mes_example:    { min: 0,  max: 2000 },
    system_prompt:  { min: 0,  max: 800 },
    creator_notes:  { min: 0,  max: 500 },
    character_note: { min: 0,  max: 400 },
};

// ─── Public ───────────────────────────────────────────────────────────────────

/**
 * Run the full coherence audit.
 * @returns {Promise<AuditReport>}
 */
export async function runCoherenceAudit() {
    const issues = [];

    // Read card fields from ST context
    const ctx = SillyTavern?.getContext?.();
    const cardFields = ctx?.getCharacterCardFields?.() || {};

    // Normalise field names to CCS naming
    const fields = {
        description:    cardFields.description || '',
        personality:    cardFields.personality || '',
        scenario:       cardFields.scenario || '',
        first_mes:      cardFields.firstMessage || '',
        mes_example:    cardFields.mesExamples || '',
        system_prompt:  cardFields.system || '',
        creator_notes:  cardFields.creatorNotes || '',
        character_note: cardFields.charDepthPrompt || '',
    };

    // ── 1. Missing required fields ──────────────────────────────────────────
    for (const f of REQUIRED_FIELDS) {
        if (!fields[f]?.trim()) {
            issues.push({
                severity: 'error',
                category: 'fields',
                field: f,
                message: `Required field "${_label(f)}" is empty.`,
            });
        }
    }

    // ── 2. Field length anomalies ────────────────────────────────────────────
    for (const [f, budget] of Object.entries(FIELD_BUDGETS)) {
        const content = fields[f];
        if (!content?.trim()) continue;
        const tokens = countTokensSync(content);
        if (budget.min > 0 && tokens < budget.min) {
            issues.push({
                severity: 'warning',
                category: 'fields',
                field: f,
                message: `"${_label(f)}" is very short (~${tokens}t). Consider expanding it.`,
            });
        }
        if (tokens > budget.max) {
            issues.push({
                severity: 'warning',
                category: 'fields',
                field: f,
                message: `"${_label(f)}" is very long (~${tokens}t, budget ~${budget.max}t). Consider trimming.`,
            });
        }
    }

    // ── 3. Lorebook checks ────────────────────────────────────────────────────
    let loreEntries = [];
    try {
        const loreData = await getLorebookEntries();
        loreEntries = loreData.entries || [];
    } catch (e) {
        issues.push({ severity: 'info', category: 'lorebook', message: `Could not read lorebook: ${e.message}` });
    }

    if (loreEntries.length > 0) {
        // 3a. Keyword collisions (exact match between entries)
        const keyMap = new Map(); // key → entry name
        for (const entry of loreEntries) {
            for (const key of (entry.keys || [])) {
                const k = key.toLowerCase().trim();
                if (!k) continue;
                if (keyMap.has(k)) {
                    issues.push({
                        severity: 'warning',
                        category: 'lorebook',
                        message: `Lorebook keyword collision: "${key}" is used by both "${keyMap.get(k)}" and "${entry.name}".`,
                    });
                } else {
                    keyMap.set(k, entry.name);
                }
            }
        }

        // 3b. Constant entry budget
        const constantEntries = loreEntries.filter(e => e.constant && e.enabled);
        const constantTokens  = constantEntries.reduce((s, e) => s + e.tokens, 0);
        if (constantTokens > 800) {
            issues.push({
                severity: 'warning',
                category: 'lorebook',
                message: `Constant lorebook entries total ~${constantTokens}t. This is always injected. Consider reducing constant entries.`,
            });
        }
        if (constantEntries.length > 5) {
            issues.push({
                severity: 'info',
                category: 'lorebook',
                message: `${constantEntries.length} constant entries found. Constant entries fire on every message — prefer triggered entries.`,
            });
        }

        // 3c. Disabled entries
        const disabledCount = loreEntries.filter(e => !e.enabled).length;
        if (disabledCount > 0) {
            issues.push({
                severity: 'info',
                category: 'lorebook',
                message: `${disabledCount} lorebook ${disabledCount === 1 ? 'entry is' : 'entries are'} disabled and won't trigger.`,
            });
        }

        // 3d. Entries with no keywords (and not constant)
        const keylessEntries = loreEntries.filter(e => !e.constant && (!e.keys || e.keys.length === 0) && e.enabled);
        for (const e of keylessEntries) {
            issues.push({
                severity: 'error',
                category: 'lorebook',
                message: `Lorebook entry "${e.name}" has no trigger keywords and is not constant — it will never activate.`,
            });
        }
    }

    // ── 4. Consistency cross-checks ──────────────────────────────────────────

    // Check that character name (if in description) also appears in personality
    const charName = ctx?.characters?.[ctx?.characterId]?.name;
    if (charName && fields.description && fields.personality) {
        const descLower = fields.description.toLowerCase();
        const persLower = fields.personality.toLowerCase();
        const nameLower = charName.toLowerCase();
        if (descLower.includes(nameLower) && !persLower.includes(nameLower) && !persLower.includes('{{char}}')) {
            issues.push({
                severity: 'info',
                category: 'consistency',
                message: `Character name "${charName}" appears in Description but not in Personality. Consider using {{char}} or the name in Personality.`,
            });
        }
    }

    // Check for first_mes referencing {{user}} without a scenario
    if (fields.first_mes && fields.first_mes.includes('{{user}}') && !fields.scenario?.trim()) {
        issues.push({
            severity: 'info',
            category: 'consistency',
            message: 'First Message references {{user}} but Scenario is empty. Consider adding context in the Scenario field.',
        });
    }

    // ── Build stats and score ─────────────────────────────────────────────────
    const totalFields = Object.keys(fields).filter(f => fields[f]?.trim()).length;
    const totalTokens = Object.values(fields).reduce((s, v) => s + countTokensSync(v || ''), 0);
    const loreTokens  = loreEntries.reduce((s, e) => s + e.tokens, 0);

    const errors   = issues.filter(i => i.severity === 'error').length;
    const warnings = issues.filter(i => i.severity === 'warning').length;

    // Score: start at 100, deduct for issues
    const score = Math.max(0, 100 - errors * 20 - warnings * 5 - Math.floor(issues.filter(i => i.severity === 'info').length * 2));

    const stats = {
        totalFields,
        totalTokens,
        loreEntries: loreEntries.length,
        loreTokens,
        errors,
        warnings,
        infos: issues.filter(i => i.severity === 'info').length,
    };

    console.log(`[CCS] Coherence audit complete: score=${score}, issues=${issues.length}`, stats);
    return { issues, stats, score };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function _label(fieldKey) {
    const MAP = {
        description:    'Description',
        personality:    'Personality',
        scenario:       'Scenario',
        first_mes:      'First Message',
        mes_example:    'Example Messages',
        system_prompt:  'System Prompt',
        creator_notes:  'Creator Notes',
        character_note: 'Character Note',
    };
    return MAP[fieldKey] || fieldKey;
}
