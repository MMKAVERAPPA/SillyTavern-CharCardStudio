/**
 * CharCardStudio v4.1.0 — core/lorebook.js
 *
 * External Lorebook CRUD via SillyTavern's /api/worldinfo/* REST endpoints.
 * All read/write operations target the NAMED external lorebook stored in
 * session.lorebookName. Embedded character_book mode is no longer used.
 *
 * Confirmed API shape (from ST src/endpoints/worldinfo.js):
 *   POST /api/worldinfo/list                         → [{ file_id, name, extensions }]
 *   POST /api/worldinfo/get    { name }              → { entries: {...} }
 *   POST /api/worldinfo/edit   { name, data:{...} }  → { ok: true }  (creates if absent)
 *   POST /api/worldinfo/delete { name }              → 200
 *
 * After every save we:
 *   1. Invalidate our 30-second TTL cache for that book.
 *   2. Call ctx.reloadWorldInfoEditor(name, true) if available, so ST's
 *      own World Info editor stays in sync with our changes.
 */

import { getSession } from './session.js';
import { countTokensSync } from './token-utils.js';

// ─── Cache ────────────────────────────────────────────────────────────────────

/** @type {Object.<string, {_ts:number, entries:Object}>} */
const _wiCache = {};
const CACHE_TTL = 30_000; // 30 seconds — matches ST-Copilot reference pattern

function _invalidateCache(bookName) {
    if (bookName) {
        delete _wiCache[bookName];
    } else {
        Object.keys(_wiCache).forEach(k => delete _wiCache[k]);
    }
}

// ─── Internal Helpers ─────────────────────────────────────────────────────────

function _getHeaders() {
    const ctx = SillyTavern?.getContext?.();
    return {
        'Content-Type': 'application/json',
        ...(ctx?.getRequestHeaders?.() || {}),
    };
}

/** Get the currently selected lorebook name from the session. */
function _getBookName() {
    return getSession()?.lorebookName ?? null;
}

/**
 * Fetch the full book data object (with TTL cache).
 * @param {string} bookName
 * @returns {Promise<{entries: Object, _ts: number}|null>}
 */
async function _fetchBook(bookName) {
    if (!bookName) return null;

    const cached = _wiCache[bookName];
    if (cached && Date.now() - cached._ts < CACHE_TTL) {
        return cached;
    }

    try {
        const resp = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: _getHeaders(),
            body: JSON.stringify({ name: bookName }),
        });
        if (!resp.ok) {
            console.error(`[CCS] fetchBook "${bookName}" HTTP ${resp.status}`);
            return null;
        }
        const data = await resp.json();
        if (!data.entries) data.entries = {};
        data._ts = Date.now();
        _wiCache[bookName] = data;
        return data;
    } catch (e) {
        console.error(`[CCS] fetchBook "${bookName}" error:`, e);
        return null;
    }
}

/**
 * Save the full book data back to ST.
 * @param {string} bookName
 * @param {Object} bookData - Full book object (entries + any extra fields)
 * @returns {Promise<boolean>}
 */
async function _saveBook(bookName, bookData) {
    if (!bookName) return false;

    // Strip the cache timestamp before sending
    const { _ts, ...dataToSave } = bookData;
    if (!dataToSave.entries) dataToSave.entries = {};

    try {
        const resp = await fetch('/api/worldinfo/edit', {
            method: 'POST',
            headers: _getHeaders(),
            body: JSON.stringify({ name: bookName, data: dataToSave }),
        });
        if (!resp.ok) {
            console.error(`[CCS] saveBook "${bookName}" HTTP ${resp.status}`);
            return false;
        }
    } catch (e) {
        console.error(`[CCS] saveBook "${bookName}" error:`, e);
        return false;
    }

    // Invalidate cache and sync ST's WI editor (ST-Copilot pattern)
    _invalidateCache(bookName);
    try {
        const ctx = SillyTavern?.getContext?.();
        if (typeof ctx?.reloadWorldInfoEditor === 'function') {
            ctx.reloadWorldInfoEditor(bookName, true);
        }
    } catch (_) { /* ignore if not available */ }

    return true;
}

// ─── Public: Book Management ──────────────────────────────────────────────────

/**
 * List all available external lorebooks.
 * @returns {Promise<Array<{file_id:string, name:string}>>}
 */
export async function listWorldInfoBooks() {
    try {
        const resp = await fetch('/api/worldinfo/list', {
            method: 'POST',
            headers: _getHeaders(),
            body: JSON.stringify({}),
        });
        if (!resp.ok) return [];
        return await resp.json();
    } catch (e) {
        console.error('[CCS] listWorldInfoBooks error:', e);
        return [];
    }
}

/**
 * Create a new empty named external lorebook (or silently succeed if it exists).
 * Uses /api/worldinfo/edit which creates the file atomically.
 * @param {string} name
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function createWorldInfoBook(name) {
    if (!name?.trim()) return { success: false, error: 'Name is required' };

    const bookName = name.trim();
    try {
        const resp = await fetch('/api/worldinfo/edit', {
            method: 'POST',
            headers: _getHeaders(),
            body: JSON.stringify({ name: bookName, data: { entries: {} } }),
        });
        if (!resp.ok) return { success: false, error: `Server error: ${resp.status}` };
        console.log(`[CCS] Created lorebook: "${bookName}"`);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ─── Public: Read ─────────────────────────────────────────────────────────────

/**
 * Get lorebook entries from the session's selected external book.
 * @param {boolean} [forceRefresh=false]
 * @returns {Promise<{entries: Object[], bookName: string|null}>}
 */
export async function getLorebookEntries(forceRefresh = false) {
    const bookName = _getBookName();
    if (!bookName) return { entries: [], bookName: null };

    if (forceRefresh) _invalidateCache(bookName);

    const book = await _fetchBook(bookName);
    if (!book) return { entries: [], bookName };

    const entries = Object.values(book.entries || {}).map(e => ({
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
        preventRecursion: !!(e.excludeRecursion || e.preventRecursion),
        selectiveLogic: e.selectiveLogic ?? 0,
        tokens: countTokensSync(e.content || ''),
        group: e.group || '',
        scanDepth: e.scanDepth ?? null,
        caseSensitive: !!e.caseSensitive,
        matchWholeWords: e.matchWholeWords ?? null,
        automationId: e.automationId || '',
    }));

    return { entries, bookName };
}

/**
 * Get token budget summary for the selected lorebook.
 * @returns {Promise<{total:number, enabled:number, constantTokens:number, conditionalTokens:number, estimatedUsage:number}>}
 */
export async function getLorebookTokenBudget() {
    const { entries } = await getLorebookEntries();
    const constantTokens = entries
        .filter(e => e.constant && e.enabled)
        .reduce((s, e) => s + e.tokens, 0);
    const conditionalTokens = entries
        .filter(e => !e.constant && e.enabled)
        .reduce((s, e) => s + e.tokens, 0);
    return {
        total: entries.length,
        enabled: entries.filter(e => e.enabled).length,
        constantTokens,
        conditionalTokens,
        estimatedUsage: constantTokens + Math.round(conditionalTokens * 0.7),
    };
}

// ─── Public: Create ───────────────────────────────────────────────────────────

/**
 * Create a new entry in the selected external lorebook.
 * @param {Object} entry
 * @returns {Promise<{success:boolean, uid?:number, error?:string}>}
 */
export async function createLorebookEntry(entry) {
    const bookName = _getBookName();
    if (!bookName) return { success: false, error: 'No lorebook selected. Pick one in the Lore tab.' };

    try {
        const book = await _fetchBook(bookName) || { entries: {} };
        const existingUids = Object.keys(book.entries || {}).map(Number).filter(n => !isNaN(n));
        const nextUid = existingUids.length > 0 ? Math.max(...existingUids) + 1 : 0;

        const stEntry = {
            uid: nextUid,
            key: entry.keys || [],
            keysecondary: entry.secondaryKeys || [],
            comment: entry.name || '',
            content: entry.content || '',
            constant: entry.constant || false,
            selective: (entry.secondaryKeys?.length > 0),
            selectiveLogic: entry.selectiveLogic ?? 0,
            addMemo: true,
            order: entry.order ?? 100,
            position: _stringToPosition(entry.position || 'after_char'),
            disable: false,
            excludeRecursion: entry.preventRecursion || false,
            preventRecursion: entry.preventRecursion || false,
            depth: entry.depth ?? 4,
            group: entry.group || '',
            groupOverride: false,
            groupWeight: 100,
            scanDepth: entry.scanDepth ?? null,
            caseSensitive: entry.caseSensitive || false,
            matchWholeWords: entry.matchWholeWords ?? null,
            automationId: entry.automationId || '',
            role: null,
            vectorized: false,
        };

        book.entries = book.entries || {};
        book.entries[nextUid] = stEntry;

        const saved = await _saveBook(bookName, book);
        if (!saved) return { success: false, error: 'Failed to save lorebook' };

        console.log(`[CCS] Created lore entry "${entry.name}" (uid:${nextUid}) in "${bookName}"`);
        return { success: true, uid: nextUid };
    } catch (e) {
        console.error('[CCS] createLorebookEntry error:', e);
        return { success: false, error: e.message };
    }
}

// ─── Public: Update ───────────────────────────────────────────────────────────

/**
 * Update an existing lorebook entry by UID.
 * @param {number} uid
 * @param {Object} changes
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function updateLorebookEntry(uid, changes) {
    const bookName = _getBookName();
    if (!bookName) return { success: false, error: 'No lorebook selected' };

    try {
        const book = await _fetchBook(bookName);
        if (!book?.entries?.[uid]) return { success: false, error: `Entry ${uid} not found` };

        const entry = book.entries[uid];
        if (changes.content !== undefined)      entry.content = changes.content;
        if (changes.keys !== undefined)         entry.key = changes.keys;
        if (changes.name !== undefined)         entry.comment = changes.name;
        if (changes.constant !== undefined)     entry.constant = changes.constant;
        if (changes.position !== undefined)     entry.position = _stringToPosition(changes.position);
        if (changes.enabled !== undefined)      entry.disable = !changes.enabled;
        if (changes.order !== undefined)        entry.order = changes.order;
        if (changes.depth !== undefined)        entry.depth = changes.depth;
        if (changes.group !== undefined)        entry.group = changes.group;
        if (changes.scanDepth !== undefined)    entry.scanDepth = changes.scanDepth;
        if (changes.caseSensitive !== undefined) entry.caseSensitive = changes.caseSensitive;
        if (changes.automationId !== undefined) entry.automationId = changes.automationId;

        const saved = await _saveBook(bookName, book);
        if (!saved) return { success: false, error: 'Failed to save lorebook' };

        console.log(`[CCS] Updated lore entry uid:${uid} in "${bookName}"`);
        return { success: true };
    } catch (e) {
        console.error('[CCS] updateLorebookEntry error:', e);
        return { success: false, error: e.message };
    }
}

// ─── Public: Delete ───────────────────────────────────────────────────────────

/**
 * Delete a lorebook entry by UID.
 * @param {number} uid
 * @returns {Promise<{success:boolean, error?:string}>}
 */
export async function deleteLorebookEntry(uid) {
    const bookName = _getBookName();
    if (!bookName) return { success: false, error: 'No lorebook selected' };

    try {
        const book = await _fetchBook(bookName);
        if (!book?.entries?.[uid]) return { success: false, error: `Entry ${uid} not found` };

        delete book.entries[uid];

        const saved = await _saveBook(bookName, book);
        if (!saved) return { success: false, error: 'Failed to save lorebook' };

        console.log(`[CCS] Deleted lore entry uid:${uid} from "${bookName}"`);
        return { success: true };
    } catch (e) {
        console.error('[CCS] deleteLorebookEntry error:', e);
        return { success: false, error: e.message };
    }
}

// ─── Position Helpers ─────────────────────────────────────────────────────────

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
        case 'before_char':   return 0;
        case 'after_char':    return 1;
        case 'before_author': return 2;
        case 'after_author':  return 3;
        case 'at_depth':      return 4;
        default:              return 1;
    }
}

// ─── Recursion Detection ──────────────────────────────────────────────────────

/**
 * Detect potential recursion chains in lorebook entries.
 * @param {Object[]} [entries] - Entries array (fetched if not provided)
 * @returns {Promise<{chains: Object[], maxDepth: number, warnings: string[]}>}
 */
export async function detectRecursion(entries) {
    if (!entries) {
        const data = await getLorebookEntries();
        entries = data.entries || [];
    }

    const enabledEntries = entries.filter(e => e.enabled && !e.preventRecursion);
    const chains = [];
    const warnings = [];
    const triggerMap = new Map();

    for (const entry of enabledEntries) {
        const triggered = [];
        for (const other of enabledEntries) {
            if (other.uid === entry.uid) continue;
            // Check if THIS entry's content triggers the OTHER entry's keys
            for (const key of (other.keys || [])) {
                if (key && key.length >= 2 && entry.content.toLowerCase().includes(key.toLowerCase())) {
                    triggered.push(other.uid);
                    break;
                }
            }
        }
        if (triggered.length > 0) triggerMap.set(entry.uid, triggered);
    }

    // Bug H fix: Replace recursive walkChain (exponential Set copies, stack-overflow
    // risk on dense lorebooks) with an iterative DFS using an explicit work stack.
    // Each stack frame is [uid, visitedSet, depth, pathArray].
    const walkChainIterative = (startUid, startName) => {
        let localMaxDepth = 0;
        const stack = [[startUid, new Set(), 0, [startName]]];

        while (stack.length > 0) {
            const [uid, visited, depth, path] = stack.pop();

            if (visited.has(uid)) {
                warnings.push(`Circular recursion detected: ${path.join(' -> ')} -> loops to uid:${uid}`);
                localMaxDepth = Math.max(localMaxDepth, depth);
                continue;
            }

            const newVisited = new Set(visited);
            newVisited.add(uid);
            localMaxDepth = Math.max(localMaxDepth, depth);

            for (const nextUid of (triggerMap.get(uid) || [])) {
                const nextEntry = enabledEntries.find(e => e.uid === nextUid);
                const nextName = nextEntry?.name || `uid:${nextUid}`;
                stack.push([nextUid, newVisited, depth + 1, [...path, nextName]]);
            }
        }

        return localMaxDepth;
    };

    let maxDepth = 0;

    for (const entry of enabledEntries) {
        const depth = walkChainIterative(entry.uid, entry.name || `uid:${entry.uid}`);
        if (depth > 1) {
            chains.push({ uid: entry.uid, name: entry.name || `uid:${entry.uid}`, depth });
            maxDepth = Math.max(maxDepth, depth);
        }
    }

    for (const chain of chains) {
        if (chain.depth > 3) {
            warnings.push(`"${chain.name}" has recursion depth ${chain.depth} — consider enabling preventRecursion`);
        }
    }

    if (maxDepth > 3) console.warn(`[CCS] Lorebook recursion: max depth ${maxDepth}`, chains);
    return { chains, maxDepth, warnings };
}
