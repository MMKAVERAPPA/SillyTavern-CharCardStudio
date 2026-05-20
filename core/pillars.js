/**
 * CharCardStudio v4.0.0 — core/pillars.js
 * Pillar system: structural pillars (10 fixed, map to card fields) + world pillars (dynamic).
 * Manages progress calculation, pillar lifecycle, and auto-marking from draft applies.
 */

import { getSession, updateSession } from './session.js';

// ─── Structural Pillar Definitions ───────────────────────────────────────────

export const STRUCTURAL_PILLARS = [
    { id: 'description',      name: 'Description',        weight: 2,   field: 'description',         category: 'structural' },
    { id: 'first_mes',        name: 'First Message',      weight: 2,   field: 'first_mes',           category: 'structural' },
    { id: 'personality',      name: 'Personality',         weight: 2,   field: 'personality',         category: 'structural' },
    { id: 'system_prompt',    name: 'System Prompt',       weight: 1,   field: 'system_prompt',       category: 'structural' },
    { id: 'scenario',         name: 'Scenario',            weight: 1,   field: 'scenario',            category: 'structural' },
    { id: 'mes_example',      name: 'Example Messages',    weight: 1,   field: 'mes_example',         category: 'structural' },
    { id: 'creator_notes',    name: 'Creator Notes',       weight: 0.5, field: 'creator_notes',       category: 'structural' },
    { id: 'character_note',   name: 'Character Note',      weight: 0.5, field: 'character_note',      category: 'structural' },
    { id: 'alt_greetings',    name: 'Alternate Greetings', weight: 0.5, field: 'alternate_greetings', category: 'structural' },
    { id: 'tags',             name: 'Tags',                weight: 0.5, field: 'tags',                category: 'structural' },
];

// ─── Initialization ──────────────────────────────────────────────────────────

/**
 * Initialize pillar states for a new session. Creates the 10 structural pillars
 * with `pending` status. Called when a new session is created (not on resume).
 */
export function initializePillars() {
    const pillars = STRUCTURAL_PILLARS.map(def => ({
        id: def.id,
        name: def.name,
        weight: def.weight,
        field: def.field,
        category: def.category,
        status: 'pending',
        summary: null,
        isCustom: false,
    }));
    return pillars;
}

/**
 * Ensure a session has pillar states. If empty or missing, initialize them.
 * If the session already has structural pillars, merge any new defaults
 * (forward-compatible for future structural pillar additions).
 */
export function ensurePillars(session) {
    if (!session) return;

    if (!session.pillarStates || session.pillarStates.length === 0) {
        session.pillarStates = initializePillars();
        return;
    }

    // Ensure all structural pillars exist (forward-compat)
    const existingIds = new Set(session.pillarStates.map(p => p.id));
    for (const def of STRUCTURAL_PILLARS) {
        if (!existingIds.has(def.id)) {
            session.pillarStates.push({
                id: def.id,
                name: def.name,
                weight: def.weight,
                field: def.field,
                category: def.category,
                status: 'pending',
                summary: null,
                isCustom: false,
            });
        }
    }
}

// ─── Progress Calculation ────────────────────────────────────────────────────

/**
 * Calculate weighted progress for a set of pillars.
 * Skipped pillars are excluded from the denominator.
 * @param {Array} pillars - Pillar states array
 * @returns {{ percent: number, done: number, pending: number, inProgress: number, skipped: number, total: number }}
 */
export function calculateProgress(pillars) {
    if (!pillars?.length) return { percent: 0, done: 0, pending: 0, inProgress: 0, skipped: 0, total: 0 };

    let totalWeight = 0;
    let doneWeight = 0;

    for (const p of pillars) {
        if (p.status === 'skipped') continue;
        totalWeight += (p.weight || 1);
        if (p.status === 'done') {
            doneWeight += (p.weight || 1);
        }
    }

    return {
        percent: totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0,
        done: pillars.filter(p => p.status === 'done').length,
        pending: pillars.filter(p => p.status === 'pending').length,
        inProgress: pillars.filter(p => p.status === 'in_progress').length,
        skipped: pillars.filter(p => p.status === 'skipped').length,
        total: pillars.length,
    };
}

/**
 * Get sub-progress for structural vs world pillars separately.
 */
export function getSubProgress(pillars) {
    if (!pillars?.length) return { structural: calculateProgress([]), world: calculateProgress([]) };
    const structural = pillars.filter(p => p.category === 'structural');
    const world = pillars.filter(p => p.category === 'world');
    return {
        structural: calculateProgress(structural),
        world: calculateProgress(world),
    };
}

// ─── Pillar Mutations ────────────────────────────────────────────────────────

/**
 * Mark a pillar as done (called when a draft is Applied).
 * @param {string} fieldName - The CCS field name (e.g., 'description', 'first_mes')
 * @param {string} [summary] - Optional summary of what was resolved
 */
export function markPillarDoneByField(fieldName, summary) {
    const session = getSession();
    if (!session?.pillarStates) return;

    const pillar = session.pillarStates.find(p => p.field === fieldName);
    if (pillar && pillar.status !== 'done') {
        pillar.status = 'done';
        if (summary) pillar.summary = summary;
        updateSession({ pillarStates: session.pillarStates });
        console.log(`[CCS] Pillar auto-marked done: ${pillar.name} (field: ${fieldName})`);
    }
}

/**
 * Update a pillar's status and/or summary. Used by the ccs_update_pillar tool.
 * @param {string} pillarId - Pillar ID
 * @param {string} status - New status
 * @param {string} [summary] - Optional summary
 * @returns {{ success: boolean, pillar?: object, error?: string }}
 */
export function updatePillar(pillarId, status, summary) {
    const session = getSession();
    if (!session?.pillarStates) return { success: false, error: 'No session' };

    let pillar = session.pillarStates.find(p => p.id === pillarId);

    // If not found by id, try fuzzy match (AI might use different ID format)
    if (!pillar) {
        const normalized = pillarId.toLowerCase().replace(/[^a-z0-9]/g, '_');
        pillar = session.pillarStates.find(p =>
            p.id.toLowerCase().replace(/[^a-z0-9]/g, '_') === normalized ||
            p.name.toLowerCase().replace(/[^a-z0-9]/g, '_') === normalized
        );
    }

    if (!pillar) {
        return { success: false, error: `Pillar not found: ${pillarId}` };
    }

    pillar.status = status;
    if (summary !== undefined) pillar.summary = summary;
    updateSession({ pillarStates: session.pillarStates });
    return { success: true, pillar };
}

/**
 * Add a world pillar (dynamic, AI-proposed or user-created).
 * @param {string} name - Pillar name
 * @param {string} [summary] - Optional summary
 * @returns {object} The created pillar
 */
export function addWorldPillar(name, summary) {
    const session = getSession();
    if (!session) return null;

    if (!session.pillarStates) session.pillarStates = initializePillars();

    const id = `world_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').substring(0, 30)}`;

    // Prevent duplicates
    if (session.pillarStates.find(p => p.id === id)) {
        return session.pillarStates.find(p => p.id === id);
    }

    const pillar = {
        id,
        name,
        weight: 1,
        field: null,
        category: 'world',
        status: 'pending',
        summary: summary || null,
        isCustom: true,
    };

    session.pillarStates.push(pillar);
    updateSession({ pillarStates: session.pillarStates });
    return pillar;
}

/**
 * Remove a world pillar (only custom/world pillars can be deleted).
 * Structural pillars can only be skipped.
 * @param {string} pillarId - Pillar ID
 * @returns {boolean} Whether the pillar was removed
 */
export function removeWorldPillar(pillarId) {
    const session = getSession();
    if (!session?.pillarStates) return false;

    const idx = session.pillarStates.findIndex(p => p.id === pillarId && p.category === 'world');
    if (idx === -1) return false;

    session.pillarStates.splice(idx, 1);
    updateSession({ pillarStates: session.pillarStates });
    return true;
}

/**
 * Auto-detect pillar status from current card fields.
 * Marks structural pillars as "done" if their corresponding field has content.
 * Used on session load to sync pillar state with actual card content.
 */
export function syncPillarsWithCard() {
    const session = getSession();
    if (!session?.pillarStates) return;

    const ctx = SillyTavern?.getContext?.();
    const fields = ctx?.getCharacterCardFields?.();
    if (!fields) return;

    // Map ST field keys to CCS field names
    const ST_TO_CCS = {
        description: 'description',
        personality: 'personality',
        scenario: 'scenario',
        firstMessage: 'first_mes',
        mesExamples: 'mes_example',
        system: 'system_prompt',
        creatorNotes: 'creator_notes',
        charDepthPrompt: 'character_note',
        alternateGreetings: 'alternate_greetings',
    };

    let changed = false;
    for (const [stKey, ccsField] of Object.entries(ST_TO_CCS)) {
        const value = fields[stKey];
        const hasContent = Array.isArray(value) ? value.length > 0 : (value?.trim()?.length > 0);
        const pillar = session.pillarStates.find(p => p.field === ccsField);

        if (pillar && hasContent && pillar.status === 'pending') {
            pillar.status = 'done';
            pillar.summary = 'Pre-existing content detected';
            changed = true;
        }
    }

    if (changed) {
        updateSession({ pillarStates: session.pillarStates });
        console.log('[CCS] Pillars synced with card fields');
    }
}
