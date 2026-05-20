/**
 * CharCardStudio v4.0.0 — Session Manager
 *
 * Manages persistent session state per character using localforage.
 * Each character gets its own session keyed by avatar filename.
 *
 * Key pattern:  session_{characterAvatar}
 * Memory key:   memory_global  (cross-character preferences)
 * Memory key:   memory_{characterAvatar}  (per-character preferences)
 *
 * Session state is the single source of truth for the extension.
 * All UI components read from it; all mutations go through exported helpers.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const CURRENT_VERSION = 1;
const SAVE_DEBOUNCE_MS = 3000;
const STORE_NAME = 'SillyTavern_CharCardStudio';
const KEY_PREFIX = 'session_';
const MEMORY_GLOBAL_KEY = 'memory_global';
const MEMORY_PREFIX = 'memory_';

// Lazy import to avoid circular deps (pillars.js imports from session.js)
let _ensurePillars = null;
let _syncPillarsWithCard = null;
async function getPillarFns() {
    if (!_ensurePillars) {
        const mod = await import('./pillars.js');
        _ensurePillars = mod.ensurePillars;
        _syncPillarsWithCard = mod.syncPillarsWithCard;
    }
    return { ensurePillars: _ensurePillars, syncPillarsWithCard: _syncPillarsWithCard };
}

// ─── Module State ───────────────────────────────────────────────────────────

/** @type {import('localforage')} */
let store = null;

/** @type {SessionState|null} */
let currentSession = null;

/** @type {number|null} */
let saveTimerId = null;

/** @type {Set<(session: SessionState|null) => void>} */
const changeListeners = new Set();

// ─── Types (JSDoc) ──────────────────────────────────────────────────────────

/**
 * @typedef {Object} Message
 * @property {string} id          - Unique message ID
 * @property {'user'|'ai'|'system'|'tool_result'} role
 * @property {string} content     - Message text (may contain markdown)
 * @property {number} timestamp   - Date.now() when created
 * @property {string} [toolName]  - If role=tool_result, the tool that produced it
 * @property {boolean} [hidden]   - If true, not rendered in chat (stealth tool results)
 */

/**
 * @typedef {Object} PillarState
 * @property {string} id           - Unique pillar ID (e.g. 'description', 'wp_neo_tokyo')
 * @property {string} name         - Display name
 * @property {'structural'|'world'} category
 * @property {'pending'|'in_progress'|'done'|'skipped'} status
 * @property {number} weight       - Weight for progress calculation (core=2, standard=1)
 * @property {string|null} field   - Linked card field (structural pillars only)
 * @property {string[]} linkedFields      - Fields that address this pillar (world pillars)
 * @property {string[]} linkedLoreEntries - Lore entries that address this pillar
 * @property {string|null} summary - Brief resolution summary
 * @property {boolean} isCustom    - User-created pillar
 * @property {number} updatedAt    - Last status change timestamp
 */

/**
 * @typedef {Object} StagedDraft
 * @property {string} id              - Unique draft ID
 * @property {string} field           - Target card field
 * @property {DraftVersion[]} versions - Version history (swipeable)
 * @property {number} activeVersion   - Currently displayed version index
 * @property {'pending'|'applied'|'discarded'|'skipped'} status
 * @property {number|null} greetingIndex - For alternate_greetings, which index
 * @property {string|null} conflictId - If this draft resolves a conflict
 * @property {number} createdAt
 */

/**
 * @typedef {Object} DraftVersion
 * @property {string} content
 * @property {number} tokenCount
 * @property {'ai'|'ai_regen'|'manual'|'conflict_resolution'} source
 * @property {number} createdAt
 */

/**
 * @typedef {Object} Conflict
 * @property {string} id
 * @property {string} fieldA
 * @property {string} fieldB
 * @property {string} description
 * @property {'low'|'medium'|'high'} severity
 * @property {'open'|'pending_fix'|'resolved'|'ignored'|'snoozed'} status
 * @property {string|null} suggestion
 * @property {number} detectedAt
 */

/**
 * @typedef {Object} SessionMemory
 * @property {MemoryEntry[]} globalRules   - Persist across all sessions
 * @property {MemoryEntry[]} sessionRules  - This session only
 * @property {MemoryEntry[]} learnings     - AI observations
 */

/**
 * @typedef {Object} MemoryEntry
 * @property {string} id
 * @property {string} content
 * @property {number} addedAt
 * @property {'user'|'ai'} source
 */

/**
 * @typedef {Object} SessionState
 * @property {number} version          - Schema version for migration
 * @property {string} characterAvatar  - ST character avatar filename (unique key)
 * @property {string} characterName    - Display name
 * @property {'studio'|'janitor'|'html'|'imageprompt'} mode
 * @property {'ideate'|'build'|'lore'} phase
 * @property {'prose'|'plist'} cardFormat
 * @property {Message[]} messages
 * @property {PillarState[]} pillarStates
 * @property {StagedDraft[]} stagedDrafts
 * @property {Conflict[]} conflicts
 * @property {Object[]} loreCategories
 * @property {Object<string, string>} fieldHashes  - { fieldName: hash }
 * @property {Object<string, string>} fieldFormats - { fieldName: 'prose'|'plist' }
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {string} autoSummary      - Auto-generated context summary
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Generate a short unique ID.
 * @param {string} [prefix='']
 * @returns {string}
 */
export function generateId(prefix = '') {
    const rand = Math.random().toString(36).substring(2, 9);
    const ts = Date.now().toString(36);
    return prefix ? `${prefix}_${ts}${rand}` : `${ts}${rand}`;
}

/**
 * Simple string hash (djb2). Used for manual edit detection.
 * @param {string} str
 * @returns {string}
 */
export function hashString(str) {
    if (!str) return '0';
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
}

/**
 * Create a default empty session for a character.
 * @param {string} avatar - Character avatar filename
 * @param {string} [name=''] - Character display name
 * @returns {SessionState}
 */
function createDefaultSession(avatar, name = '') {
    return {
        version: CURRENT_VERSION,
        characterAvatar: avatar,
        characterName: name,
        mode: 'studio',
        phase: 'ideate',
        cardFormat: 'prose',
        messages: [],
        pillarStates: [],
        stagedDrafts: [],
        conflicts: [],
        loreCategories: [],
        fieldHashes: {},
        fieldFormats: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
        autoSummary: '',
        autoSummaryCount: 0,       // Tracks how many messages were in last summary
        falsePositives: [],         // Ignored/marked false-positive conflicts
        loreDrafts: [],             // Staged lore entry drafts pending user apply
        cardDrafts: {},             // Staged card field drafts: { fieldKey: StagedDraft }
    };
}

/**
 * Migrate a loaded session to the current schema version.
 * Each version bump gets a migration step.
 * @param {Object} data - Raw session data from storage
 * @returns {SessionState}
 */
function migrateSession(data) {
    if (!data || typeof data !== 'object') {
        console.warn('[CCS] Invalid session data, returning null');
        return null;
    }

    let session = { ...data };

    // Version 0 → 1: Initial migration (add missing fields)
    if (!session.version || session.version < 1) {
        session.version = 1;
        session.fieldFormats = session.fieldFormats || {};
        session.autoSummary = session.autoSummary || '';
        session.autoSummaryCount = session.autoSummaryCount || 0;
        session.conflicts = session.conflicts || [];
        session.falsePositives = session.falsePositives || [];
        session.loreCategories = session.loreCategories || [];
        session.fieldHashes = session.fieldHashes || {};
        session.loreDrafts = session.loreDrafts || [];
        session.cardDrafts = session.cardDrafts || {};
        console.log('[CCS] Migrated session to v1:', session.characterAvatar);
    }

    // Future migrations go here:
    // if (session.version < 2) { ... session.version = 2; }

    return session;
}

// ─── Storage Key Helpers ────────────────────────────────────────────────────

function sessionKey(avatar) {
    return `${KEY_PREFIX}${avatar}`;
}

function memoryKey(avatar) {
    return avatar ? `${MEMORY_PREFIX}${avatar}` : MEMORY_GLOBAL_KEY;
}

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the session manager. Must be called once at extension startup.
 * Creates the localforage instance.
 */
export function initSessionManager() {
    if (store) {
        console.warn('[CCS] Session manager already initialized');
        return;
    }

    if (typeof window.localforage === 'undefined') {
        console.error('[CCS] localforage not available — session persistence disabled');
        return;
    }

    store = window.localforage.createInstance({
        name: STORE_NAME,
        storeName: 'sessions',
        description: 'CharCardStudio session data',
    });

    console.log('[CCS] Session manager initialized');
}

// ─── Session CRUD ───────────────────────────────────────────────────────────

/**
 * Get the current active session.
 * @returns {SessionState|null}
 */
export function getSession() {
    return currentSession;
}

/**
 * Shallow-merge a patch into the current session and save.
 * @param {object} patch - Key/value pairs to merge into session
 * @returns {Promise<void>}
 */
export async function updateSession(patch) {
    if (!currentSession) return;
    Object.assign(currentSession, patch);
    currentSession.updatedAt = Date.now();
    saveSession();
    notifyListeners();
}

/**
 * Load a session for a character. Creates a new one if none exists.
 * Sets it as the current active session.
 *
 * @param {string} avatar - Character avatar filename
 * @param {string} [name=''] - Character display name (used for new sessions)
 * @returns {Promise<SessionState>}
 */
export async function loadSession(avatar, name = '') {
    if (!store) {
        console.warn('[CCS] Store not initialized, using in-memory session');
        currentSession = createDefaultSession(avatar, name);
        notifyListeners();
        return currentSession;
    }

    if (!avatar) {
        console.error('[CCS] Cannot load session: no avatar provided');
        return null;
    }

    try {
        const key = sessionKey(avatar);
        const data = await store.getItem(key);

        if (data) {
            currentSession = migrateSession(data);
            // Update name in case it changed
            if (name && currentSession.characterName !== name) {
                currentSession.characterName = name;
            }
            console.log(`[CCS] Loaded session for "${currentSession.characterName}" (${avatar})`);
        } else {
            currentSession = createDefaultSession(avatar, name);
            console.log(`[CCS] Created new session for "${name}" (${avatar})`);
        }

        // Ensure pillar states are initialized and synced with card
        try {
            const { ensurePillars, syncPillarsWithCard } = await getPillarFns();
            ensurePillars(currentSession);
            syncPillarsWithCard();
        } catch (e) {
            console.warn('[CCS] Pillar init deferred:', e.message);
        }

        notifyListeners();
        return currentSession;
    } catch (err) {
        console.error('[CCS] Failed to load session:', err);
        currentSession = createDefaultSession(avatar, name);
        notifyListeners();
        return currentSession;
    }
}

/**
 * Save the current session to localforage.
 * Debounced by default (3s). Pass force=true to save immediately.
 *
 * @param {boolean} [force=false] - Skip debounce and save immediately
 * @returns {Promise<void>|void}
 */
export function saveSession(force = false) {
    if (!currentSession) return;

    currentSession.updatedAt = Date.now();

    if (force) {
        // Cancel any pending debounced save
        if (saveTimerId) {
            clearTimeout(saveTimerId);
            saveTimerId = null;
        }
        return _saveNow();
    }

    // Debounced save
    if (saveTimerId) {
        clearTimeout(saveTimerId);
    }
    saveTimerId = setTimeout(() => {
        saveTimerId = null;
        _saveNow();
    }, SAVE_DEBOUNCE_MS);
}

/**
 * Internal: persist current session to localforage immediately.
 * @returns {Promise<void>}
 */
async function _saveNow() {
    if (!store || !currentSession) return;

    try {
        const key = sessionKey(currentSession.characterAvatar);
        await store.setItem(key, JSON.parse(JSON.stringify(currentSession)));
        // console.debug('[CCS] Session saved:', key);
    } catch (err) {
        console.error('[CCS] Failed to save session:', err);
    }
}

/**
 * Delete a session from storage.
 * If it's the current session, clears it.
 *
 * @param {string} avatar
 * @returns {Promise<void>}
 */
export async function deleteSession(avatar) {
    if (!store) return;

    try {
        await store.removeItem(sessionKey(avatar));
        if (currentSession?.characterAvatar === avatar) {
            currentSession = null;
            notifyListeners();
        }
        console.log(`[CCS] Deleted session: ${avatar}`);
    } catch (err) {
        console.error('[CCS] Failed to delete session:', err);
    }
}

/**
 * List all stored sessions (avatar + name + updatedAt).
 * Useful for session management UI.
 *
 * @returns {Promise<Array<{avatar: string, name: string, updatedAt: number}>>}
 */
export async function listSessions() {
    if (!store) return [];

    try {
        const keys = await store.keys();
        const sessions = [];

        for (const key of keys) {
            if (!key.startsWith(KEY_PREFIX)) continue;

            const data = await store.getItem(key);
            if (data && typeof data === 'object') {
                sessions.push({
                    avatar: data.characterAvatar || key.replace(KEY_PREFIX, ''),
                    name: data.characterName || 'Unknown',
                    updatedAt: data.updatedAt || 0,
                    mode: data.mode || 'studio',
                    phase: data.phase || 'ideate',
                });
            }
        }

        // Sort by most recently updated
        sessions.sort((a, b) => b.updatedAt - a.updatedAt);
        return sessions;
    } catch (err) {
        console.error('[CCS] Failed to list sessions:', err);
        return [];
    }
}

/**
 * Clear the current session reference (does NOT delete from storage).
 * Used when closing the studio or switching characters.
 */
export function clearCurrentSession() {
    // Flush any pending save first
    if (saveTimerId && currentSession) {
        clearTimeout(saveTimerId);
        saveTimerId = null;
        _saveNow();
    }
    currentSession = null;
    notifyListeners();
}

// ─── Session Memory ─────────────────────────────────────────────────────────

/**
 * Load session memory (global or per-character).
 * @param {string} [avatar] - If provided, loads per-character memory. Otherwise global.
 * @returns {Promise<SessionMemory>}
 */
export async function loadMemory(avatar) {
    if (!store) return createDefaultMemory();

    try {
        const key = memoryKey(avatar);
        const data = await store.getItem(key);
        if (data && typeof data === 'object') {
            return {
                globalRules: data.globalRules || [],
                sessionRules: data.sessionRules || [],
                learnings: data.learnings || [],
            };
        }
    } catch (err) {
        console.error('[CCS] Failed to load memory:', err);
    }

    return createDefaultMemory();
}

/**
 * Save session memory.
 * @param {SessionMemory} memory
 * @param {string} [avatar] - If provided, saves as per-character memory. Otherwise global.
 * @returns {Promise<void>}
 */
export async function saveMemory(memory, avatar) {
    if (!store) return;

    try {
        const key = memoryKey(avatar);
        await store.setItem(key, JSON.parse(JSON.stringify(memory)));
    } catch (err) {
        console.error('[CCS] Failed to save memory:', err);
    }
}

function createDefaultMemory() {
    return {
        globalRules: [],
        sessionRules: [],
        learnings: [],
    };
}

// ─── Session Mutation Helpers ───────────────────────────────────────────────

/**
 * Add a message to the current session.
 * @param {Message} message
 */
export function addMessage(message) {
    if (!currentSession) return;
    if (!message.id) message.id = generateId('msg');
    if (!message.timestamp) message.timestamp = Date.now();
    currentSession.messages.push(message);
    saveSession();
    notifyListeners();
}

/**
 * Remove a message from the current session by ID.
 * @param {string} messageId
 * @returns {boolean} Whether the message was found and removed
 */
export function removeMessage(messageId) {
    if (!currentSession) return false;
    const idx = currentSession.messages.findIndex(m => m.id === messageId);
    if (idx === -1) return false;
    currentSession.messages.splice(idx, 1);
    saveSession();
    notifyListeners();
    return true;
}

/**
 * Update a message in the current session.
 * @param {string} messageId
 * @param {Partial<Message>} updates
 * @returns {boolean}
 */
export function updateMessage(messageId, updates) {
    if (!currentSession) return false;
    const msg = currentSession.messages.find(m => m.id === messageId);
    if (!msg) return false;
    Object.assign(msg, updates);
    saveSession();
    notifyListeners();
    return true;
}

/**
 * Add a staged draft to the current session.
 * @param {StagedDraft} draft
 */
export function addStagedDraft(draft) {
    if (!currentSession) return;
    if (!draft.id) draft.id = generateId('draft');
    if (!draft.createdAt) draft.createdAt = Date.now();
    currentSession.stagedDrafts.push(draft);
    saveSession();
    notifyListeners();
}

/**
 * Get a staged draft by ID.
 * @param {string} draftId
 * @returns {StagedDraft|undefined}
 */
export function getStagedDraft(draftId) {
    return currentSession?.stagedDrafts.find(d => d.id === draftId);
}

/**
 * Get the active staged draft for a field (if any).
 * @param {string} field
 * @returns {StagedDraft|undefined}
 */
export function getStagedDraftForField(field) {
    return currentSession?.stagedDrafts.find(
        d => d.field === field && d.status === 'pending'
    );
}

/**
 * Update session mode.
 * @param {'studio'|'janitor'|'html'|'imageprompt'} mode
 */
export function setMode(mode) {
    if (!currentSession) return;
    currentSession.mode = mode;
    saveSession();
    notifyListeners();
}

/**
 * Update session phase.
 * @param {'ideate'|'build'|'lore'} phase
 */
export function setPhase(phase) {
    if (!currentSession) return;
    currentSession.phase = phase;
    saveSession();
    notifyListeners();
}

/**
 * Update card format.
 * @param {'prose'|'plist'} format
 */
export function setCardFormat(format) {
    if (!currentSession) return;
    currentSession.cardFormat = format;
    saveSession();
    notifyListeners();
}

/**
 * Update a field hash (for manual edit detection).
 * @param {string} field
 * @param {string} content
 */
export function updateFieldHash(field, content) {
    if (!currentSession) return;
    currentSession.fieldHashes[field] = hashString(content);
}

// ─── Change Listeners ───────────────────────────────────────────────────────

/**
 * Register a callback that fires whenever the session changes.
 * Returns an unsubscribe function.
 *
 * @param {(session: SessionState|null) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function onSessionChange(callback) {
    changeListeners.add(callback);
    return () => changeListeners.delete(callback);
}

/**
 * Notify all registered listeners of a session change.
 */
function notifyListeners() {
    for (const cb of changeListeners) {
        try {
            cb(currentSession);
        } catch (err) {
            console.error('[CCS] Session change listener error:', err);
        }
    }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Flush any pending saves and clean up.
 * Call on extension unload or page unload.
 */
export function destroySessionManager() {
    if (saveTimerId) {
        clearTimeout(saveTimerId);
        saveTimerId = null;
    }
    // Final save
    if (currentSession && store) {
        _saveNow();
    }
    currentSession = null;
    changeListeners.clear();
    console.log('[CCS] Session manager destroyed');
}
