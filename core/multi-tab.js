/**
 * CharCardStudio v4.0.0 — Multi-Tab Coordinator
 *
 * Prevents two tabs from editing the same character simultaneously.
 * Uses localStorage for heartbeat (survives page refresh) and
 * BroadcastChannel for instant cross-tab messaging.
 *
 * Strategy:
 *   - Each tab gets a unique tabId on init
 *   - When a tab opens a character, it writes a heartbeat to localStorage
 *   - Heartbeat is refreshed every HEARTBEAT_INTERVAL ms
 *   - When another tab tries to open the same character, it checks the heartbeat
 *   - If a heartbeat exists and is fresh (< STALE_THRESHOLD ms old), the character is locked
 *   - The new tab enters read-only mode and shows a warning
 *   - Different characters in different tabs are always allowed
 *
 * localStorage key pattern:  ccs_tab_{characterAvatar}
 * localStorage value:        JSON { tabId, timestamp }
 */

// ─── Constants ──────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL = 5000;   // Write heartbeat every 5s
const STALE_THRESHOLD = 12000;     // Heartbeat older than 12s = stale (dead tab)
const LS_PREFIX = 'ccs_tab_';
const CHANNEL_NAME = 'ccs_tabs';

// ─── Module State ───────────────────────────────────────────────────────────

/** @type {string} Unique ID for this tab instance */
let tabId = '';

/** @type {string|null} Currently locked character avatar */
let lockedAvatar = null;

/** @type {number|null} Heartbeat interval timer */
let heartbeatTimer = null;

/** @type {BroadcastChannel|null} */
let channel = null;

/** @type {boolean} Whether this tab is in read-only (locked out) mode */
let isLockedOut = false;

/** @type {Set<(locked: boolean, avatar: string) => void>} */
const conflictListeners = new Set();

// ─── Initialization ─────────────────────────────────────────────────────────

/**
 * Initialize the multi-tab coordinator. Call once at extension startup.
 * Generates a unique tab ID and sets up the BroadcastChannel listener.
 */
export function initMultiTab() {
    // Generate unique tab ID
    tabId = `tab_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 7)}`;

    // Set up BroadcastChannel for instant cross-tab communication
    try {
        channel = new BroadcastChannel(CHANNEL_NAME);
        channel.onmessage = handleBroadcast;
    } catch (err) {
        // BroadcastChannel not supported — fall back to storage events only
        console.warn('[CCS] BroadcastChannel not supported, using storage events only');
    }

    // Listen for storage events (cross-tab localStorage changes)
    window.addEventListener('storage', handleStorageEvent);

    // Clean up on page unload
    window.addEventListener('beforeunload', () => {
        releaseLock();
        destroyMultiTab();
    });

    console.log(`[CCS] Multi-tab initialized: ${tabId}`);
}

// ─── Lock Management ────────────────────────────────────────────────────────

/**
 * Attempt to acquire a lock on a character.
 * Returns true if the lock was acquired (this tab owns the character).
 * Returns false if another tab already owns it (this tab is locked out).
 *
 * @param {string} avatar - Character avatar filename
 * @returns {boolean} Whether the lock was acquired
 */
export function acquireLock(avatar) {
    if (!avatar) return false;

    // Release any previous lock
    if (lockedAvatar && lockedAvatar !== avatar) {
        releaseLock();
    }

    // Check if another tab holds this character
    const existing = readHeartbeat(avatar);
    if (existing && existing.tabId !== tabId && !isStale(existing.timestamp)) {
        // Another active tab has this character
        isLockedOut = true;
        lockedAvatar = avatar;
        notifyConflict(true, avatar);
        console.warn(`[CCS] Character "${avatar}" locked by tab ${existing.tabId}`);
        return false;
    }

    // We can take it
    isLockedOut = false;
    lockedAvatar = avatar;
    writeHeartbeat(avatar);
    startHeartbeat(avatar);

    // Broadcast to other tabs that we took this character
    broadcast({ type: 'lock_acquired', avatar, tabId });

    console.log(`[CCS] Lock acquired: ${avatar}`);
    return true;
}

/**
 * Release the current lock. Call when closing the studio, switching characters,
 * or on page unload.
 */
export function releaseLock() {
    if (!lockedAvatar) return;

    const avatar = lockedAvatar;

    // Stop heartbeat
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    // Only clear the localStorage entry if WE own it
    if (!isLockedOut) {
        try {
            localStorage.removeItem(`${LS_PREFIX}${avatar}`);
        } catch (err) {
            console.warn('[CCS] Failed to remove lock from localStorage:', err);
        }

        // Notify other tabs
        broadcast({ type: 'lock_released', avatar, tabId });
    }

    isLockedOut = false;
    lockedAvatar = null;

    console.log(`[CCS] Lock released: ${avatar}`);
}

/**
 * Check if this tab is currently locked out from editing.
 * @returns {boolean}
 */
export function isLocked() {
    return isLockedOut;
}

/**
 * Get the current tab's ID.
 * @returns {string}
 */
export function getTabId() {
    return tabId;
}

/**
 * Register a callback for lock conflict events.
 * Called when another tab takes or releases a lock on the same character.
 *
 * @param {(locked: boolean, avatar: string) => void} callback
 * @returns {() => void} Unsubscribe function
 */
export function onLockConflict(callback) {
    conflictListeners.add(callback);
    return () => conflictListeners.delete(callback);
}

// ─── Heartbeat ──────────────────────────────────────────────────────────────

/**
 * Write this tab's heartbeat for a character to localStorage.
 * @param {string} avatar
 */
function writeHeartbeat(avatar) {
    try {
        localStorage.setItem(`${LS_PREFIX}${avatar}`, JSON.stringify({
            tabId,
            timestamp: Date.now(),
        }));
    } catch (err) {
        console.warn('[CCS] Failed to write heartbeat:', err);
    }
}

/**
 * Read the current heartbeat for a character from localStorage.
 * @param {string} avatar
 * @returns {{ tabId: string, timestamp: number }|null}
 */
function readHeartbeat(avatar) {
    try {
        const raw = localStorage.getItem(`${LS_PREFIX}${avatar}`);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (err) {
        return null;
    }
}

/**
 * Check if a heartbeat timestamp is stale (tab probably closed).
 * @param {number} timestamp
 * @returns {boolean}
 */
function isStale(timestamp) {
    return Date.now() - timestamp > STALE_THRESHOLD;
}

/**
 * Start the heartbeat interval for the current character.
 * @param {string} avatar
 */
function startHeartbeat(avatar) {
    // Clear any existing heartbeat
    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
    }

    heartbeatTimer = setInterval(() => {
        if (lockedAvatar === avatar && !isLockedOut) {
            writeHeartbeat(avatar);
        }
    }, HEARTBEAT_INTERVAL);
}

// ─── Cross-Tab Communication ────────────────────────────────────────────────

/**
 * Broadcast a message to other tabs.
 * @param {Object} message
 */
function broadcast(message) {
    if (!channel) return;
    try {
        channel.postMessage(message);
    } catch (err) {
        // Channel may be closed
        console.warn('[CCS] BroadcastChannel send failed:', err);
    }
}

/**
 * Handle incoming BroadcastChannel messages from other tabs.
 * @param {MessageEvent} event
 */
function handleBroadcast(event) {
    const msg = event.data;
    if (!msg || !msg.type) return;
    if (msg.tabId === tabId) return; // Ignore our own messages

    switch (msg.type) {
        case 'lock_acquired':
            // Another tab took a character we might be watching
            if (msg.avatar === lockedAvatar && !isLockedOut) {
                // We thought we had it, but another tab just took it
                // This shouldn't happen if heartbeats are working, but handle gracefully
                console.warn(`[CCS] Another tab claimed "${msg.avatar}" — entering read-only`);
                isLockedOut = true;
                if (heartbeatTimer) {
                    clearInterval(heartbeatTimer);
                    heartbeatTimer = null;
                }
                notifyConflict(true, msg.avatar);
            }
            break;

        case 'lock_released':
            // Another tab released a character we were locked out of
            if (msg.avatar === lockedAvatar && isLockedOut) {
                console.log(`[CCS] Lock released by other tab for "${msg.avatar}" — attempting re-acquire`);
                // Try to acquire the lock now
                isLockedOut = false;
                if (acquireLock(msg.avatar)) {
                    notifyConflict(false, msg.avatar);
                }
            }
            break;

        case 'ping':
            // Health check from another tab
            broadcast({ type: 'pong', tabId, avatar: lockedAvatar });
            break;
    }
}

/**
 * Handle localStorage storage events (fired when another tab modifies localStorage).
 * This is the fallback for when BroadcastChannel isn't available,
 * and also catches direct localStorage modifications.
 *
 * @param {StorageEvent} event
 */
function handleStorageEvent(event) {
    if (!event.key || !event.key.startsWith(LS_PREFIX)) return;

    const avatar = event.key.replace(LS_PREFIX, '');
    if (avatar !== lockedAvatar) return; // Not our character

    if (event.newValue === null) {
        // Lock was removed — another tab released it
        if (isLockedOut) {
            console.log(`[CCS] Lock cleared for "${avatar}" via storage event`);
            isLockedOut = false;
            acquireLock(avatar);
            notifyConflict(false, avatar);
        }
        return;
    }

    try {
        const data = JSON.parse(event.newValue);
        if (data.tabId !== tabId && !isLockedOut) {
            // Someone else wrote a heartbeat for our character
            console.warn(`[CCS] Heartbeat conflict for "${avatar}" — tab ${data.tabId}`);
            isLockedOut = true;
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
            notifyConflict(true, avatar);
        }
    } catch (err) {
        // Ignore malformed data
    }
}

// ─── Listeners ──────────────────────────────────────────────────────────────

/**
 * Notify all conflict listeners.
 * @param {boolean} locked - Whether the character is now locked
 * @param {string} avatar
 */
function notifyConflict(locked, avatar) {
    for (const cb of conflictListeners) {
        try {
            cb(locked, avatar);
        } catch (err) {
            console.error('[CCS] Lock conflict listener error:', err);
        }
    }
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Clean up all multi-tab resources.
 * Call on extension unload.
 */
export function destroyMultiTab() {
    releaseLock();

    if (channel) {
        try { channel.close(); } catch (_) {}
        channel = null;
    }

    window.removeEventListener('storage', handleStorageEvent);

    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
    }

    conflictListeners.clear();
    console.log('[CCS] Multi-tab destroyed');
}
