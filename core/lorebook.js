/**
 * CharCardStudio v4.0.0 — core/lorebook.js
 * Lorebook CRUD: Read, create, update, delete character lorebook entries via ST API.
 * 
 * ST stores lorebook data in the character's `data.character_book` object.
 * Entries are in `character_book.entries` as an object keyed by UID.
 * 
 * After any mutation, we call getOneCharacter to refresh ST's in-memory data
 * and emit CHARACTER_EDITED to update ST's World Info editor.
 */

import { getSession, updateSession } from './session.js';

// ─── Cache ───────────────────────────────────────────────────────────────────

let _loreCache = null;
let _loreCacheTime = 0;
const CACHE_TTL = 30_000; // 30 seconds

function invalidateCache() {
    _loreCache = null;
    _loreCacheTime = 0;
}

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * Get the character's lorebook entries.
 * @param {boolean} [forceRefresh=false] - Bypass cache
 * @returns {Promise<{entries: object[], bookName: string|null}>}
 */
export async function getLorebookEntries(forceRefresh = false) {
    const ctx = SillyTavern?.getContext?.();
    if (!ctx) return { entries: [], bookName: null };

    // Cache check
    if (!forceRefresh && _loreCache && Date.now() - _loreCacheTime < CACHE_TTL) {
        return _loreCache;
    }

    const charId = ctx.characterId;
    const char = ctx.characters?.[charId];
    if (!char) return { entries: [], bookName: null };

    const book = char.data?.character_book;
    if (!book) return { entries: [], bookName: null };

    const entries = book.entries
        ? Object.values(book.entries).map(e => ({
            uid: e.uid,
            name: e.comment || e.name || '',
            content: e.content || '',
            keys: Array.isArray(e.key) ? e.key : (e.key ? [e.key] : []),
            secondaryKeys: Array.isArray(e.keysecondary) ? e.keysecondary : [],
            constant: !!e.constant,
            enabled: e.disable !== true,
            position: _positionToString(e.position),
            depth: e.depth ?? 4,
            order: e.order ?? 100,
            preventRecursion: !!e.preventRecursion,
            selectiveLogic: e.selectiveLogic ?? 0,
            tokens: Math.round((e.content?.length || 0) / 4),
        }))
        : [];

    const result = { entries, bookName: book.name || null };
    _loreCache = result;
    _loreCacheTime = Date.now();
    return result;
}

/**
 * Get total token count of all lorebook entries.
 */
export async function getLorebookTokenBudget() {
    const { entries } = await getLorebookEntries();
    const constantTokens = entries.filter(e => e.constant && e.enabled).reduce((sum, e) => sum + e.tokens, 0);
    const conditionalTokens = entries.filter(e => !e.constant && e.enabled).reduce((sum, e) => sum + e.tokens, 0);
    return {
        total: entries.length,
        enabled: entries.filter(e => e.enabled).length,
        constantTokens,
        conditionalTokens,
        estimatedUsage: constantTokens + Math.round(conditionalTokens * 0.7),
    };
}

// ─── Create ──────────────────────────────────────────────────────────────────

/**
 * Create a new lorebook entry in the character's book.
 * @param {object} entry - Entry data
 * @returns {Promise<{success: boolean, uid?: number, error?: string}>}
 */
export async function createLorebookEntry(entry) {
    const ctx = SillyTavern?.getContext?.();
    if (!ctx) return { success: false, error: 'No ST context' };

    const charId = ctx.characterId;
    const char = ctx.characters?.[charId];
    if (!char) return { success: false, error: 'No character loaded' };

    try {
        // Ensure character_book exists
        if (!char.data.character_book) {
            char.data.character_book = { entries: {}, name: `${char.name}'s Lorebook` };
        }
        const book = char.data.character_book;
        if (!book.entries) book.entries = {};

        // Find next UID
        const existingUids = Object.keys(book.entries).map(Number).filter(n => !isNaN(n));
        const nextUid = existingUids.length > 0 ? Math.max(...existingUids) + 1 : 0;

        // Build ST-format entry
        const stEntry = {
            uid: nextUid,
            key: entry.keys || [],
            keysecondary: entry.secondaryKeys || [],
            comment: entry.name || '',
            content: entry.content || '',
            constant: entry.constant || false,
            selective: (entry.secondaryKeys?.length > 0),
            selectiveLogic: 0,
            addMemo: true,
            order: entry.order ?? 100,
            position: _stringToPosition(entry.position || 'after_char'),
            disable: false,
            excludeRecursion: entry.preventRecursion || false,
            preventRecursion: entry.preventRecursion || false,
            depth: entry.depth ?? 4,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: null,
            caseSensitive: false,
            matchWholeWords: null,
            automationId: '',
            role: null,
            vectorized: false,
        };

        book.entries[nextUid] = stEntry;

        // Save to server via merge-attributes
        const body = JSON.stringify({
            avatar: char.avatar,
            data: { character_book: book }
        });

        const resp = await fetch('/api/characters/merge-attributes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...ctx.getRequestHeaders() },
            body,
        });

        if (!resp.ok) {
            const errText = await resp.text();
            console.error('[CCS] Lorebook create failed:', resp.status, errText);
            return { success: false, error: `Server error: ${resp.status}` };
        }

        // Refresh ST data
        await ctx.getOneCharacter(char.avatar);
        if (ctx.eventSource && ctx.event_types) {
            await ctx.eventSource.emit(ctx.event_types.CHARACTER_EDITED, {
                detail: { id: ctx.this_chid, character: ctx.characters[ctx.this_chid] }
            });
        }

        invalidateCache();
        console.log(`[CCS] Lorebook entry created: "${entry.name}" (uid: ${nextUid})`);
        return { success: true, uid: nextUid };
    } catch (err) {
        console.error('[CCS] Lorebook create error:', err);
        return { success: false, error: err.message };
    }
}

// ─── Update ──────────────────────────────────────────────────────────────────

/**
 * Update an existing lorebook entry.
 * @param {number} uid - Entry UID
 * @param {object} changes - Fields to update
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function updateLorebookEntry(uid, changes) {
    const ctx = SillyTavern?.getContext?.();
    if (!ctx) return { success: false, error: 'No ST context' };

    const charId = ctx.characterId;
    const char = ctx.characters?.[charId];
    const book = char?.data?.character_book;
    if (!book?.entries?.[uid]) return { success: false, error: `Entry ${uid} not found` };

    const entry = book.entries[uid];

    // Apply changes
    if (changes.content !== undefined) entry.content = changes.content;
    if (changes.keys !== undefined) entry.key = changes.keys;
    if (changes.name !== undefined) entry.comment = changes.name;
    if (changes.constant !== undefined) entry.constant = changes.constant;
    if (changes.position !== undefined) entry.position = _stringToPosition(changes.position);
    if (changes.enabled !== undefined) entry.disable = !changes.enabled;
    if (changes.order !== undefined) entry.order = changes.order;
    if (changes.depth !== undefined) entry.depth = changes.depth;

    // Save
    const body = JSON.stringify({
        avatar: char.avatar,
        data: { character_book: book }
    });

    const resp = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ctx.getRequestHeaders() },
        body,
    });

    if (!resp.ok) return { success: false, error: `Server error: ${resp.status}` };

    await ctx.getOneCharacter(char.avatar);
    invalidateCache();
    console.log(`[CCS] Lorebook entry updated: uid ${uid}`);
    return { success: true };
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Delete a lorebook entry by UID.
 * @param {number} uid - Entry UID
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function deleteLorebookEntry(uid) {
    const ctx = SillyTavern?.getContext?.();
    if (!ctx) return { success: false, error: 'No ST context' };

    const charId = ctx.characterId;
    const char = ctx.characters?.[charId];
    const book = char?.data?.character_book;
    if (!book?.entries?.[uid]) return { success: false, error: `Entry ${uid} not found` };

    delete book.entries[uid];

    const body = JSON.stringify({
        avatar: char.avatar,
        data: { character_book: book }
    });

    const resp = await fetch('/api/characters/merge-attributes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...ctx.getRequestHeaders() },
        body,
    });

    if (!resp.ok) return { success: false, error: `Server error: ${resp.status}` };

    await ctx.getOneCharacter(char.avatar);
    invalidateCache();
    console.log(`[CCS] Lorebook entry deleted: uid ${uid}`);
    return { success: true };
}

// ─── Position Helpers ────────────────────────────────────────────────────────

function _positionToString(pos) {
    switch (pos) {
        case 0: return 'before_char';
        case 1: return 'after_char';
        case 2: return 'before_author';
        case 3: return 'after_author';
        case 4: return 'at_depth';
        default: return 'after_char';
    }
}

function _stringToPosition(str) {
    switch (str) {
        case 'before_char': return 0;
        case 'after_char': return 1;
        case 'before_author': return 2;
        case 'after_author': return 3;
        case 'at_depth': return 4;
        default: return 1;
    }
}

// ─── Recursion Detection ────────────────────────────────────────────────────

/**
 * Detect potential recursion chains in lorebook entries.
 * A recursion occurs when entry A's keywords appear in entry B's content,
 * and entry B's keywords appear in entry C's content, etc.
 *
 * @param {object[]} [entries] - Entries array (fetched if not provided)
 * @returns {Promise<{ chains: object[], maxDepth: number, warnings: string[] }>}
 */
export async function detectRecursion(entries) {
    if (!entries) {
        const data = await getLorebookEntries();
        entries = data.entries || [];
    }

    const enabledEntries = entries.filter(e => e.enabled && !e.preventRecursion);
    const chains = [];
    const warnings = [];

    // Build a map: for each entry, which other entries would it trigger?
    const triggerMap = new Map(); // uid → [triggered uids]

    for (const entry of enabledEntries) {
        const triggered = [];
        for (const other of enabledEntries) {
            if (other.uid === entry.uid) continue;
            // Check if any of entry's keys appear in other's content
            const keysToCheck = entry.keys || [];
            for (const key of keysToCheck) {
                if (key && key.length >= 2 && other.content.toLowerCase().includes(key.toLowerCase())) {
                    triggered.push(other.uid);
                    break;
                }
            }
        }
        if (triggered.length > 0) {
            triggerMap.set(entry.uid, triggered);
        }
    }

    // Walk chains to find max depth
    let maxDepth = 0;

    function walkChain(uid, visited, depth) {
        if (visited.has(uid)) return depth; // Circular — stop
        visited.add(uid);
        const next = triggerMap.get(uid) || [];
        let localMax = depth;
        for (const nextUid of next) {
            localMax = Math.max(localMax, walkChain(nextUid, new Set(visited), depth + 1));
        }
        return localMax;
    }

    for (const entry of enabledEntries) {
        const depth = walkChain(entry.uid, new Set(), 0);
        if (depth > 1) {
            const entryName = entry.name || `uid:${entry.uid}`;
            chains.push({ uid: entry.uid, name: entryName, depth });
            maxDepth = Math.max(maxDepth, depth);
        }
    }

    // Generate warnings for depth > 3
    for (const chain of chains) {
        if (chain.depth > 3) {
            warnings.push(`"${chain.name}" has recursion depth ${chain.depth} — consider enabling preventRecursion`);
        }
    }

    if (maxDepth > 3) {
        console.warn(`[CCS] Lorebook recursion detected: max depth ${maxDepth}`, chains);
    }

    return { chains, maxDepth, warnings };
}

