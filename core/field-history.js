/**
 * CharCardStudio v4.1.0 — core/field-history.js
 * Manages version history and diffs for character card fields.
 *
 * Stores up to 2 historical versions of card fields in the session,
 * allowing users to track changes, view differences using DiffMatchPatch,
 * and revert/restore previous field states.
 *
 * @module core/field-history
 */

const MAX_VERSIONS = 2;

/**
 * Pushes a new version of a field to the history cache.
 * Avoids duplicates if the content matches the last saved version.
 *
 * @param {object} session - Current session object
 * @param {string} fieldName - Card field name (e.g. 'description', 'personality')
 * @param {string} content - Assembled text content of the field
 * @param {string} source - Change source: 'direct_edit' | 'draft_applied' | 'ai_action'
 */
export function pushFieldVersion(session, fieldName, content, source = 'direct_edit') {
    if (!session) return;
    if (!session.fieldHistory) {
        session.fieldHistory = {};
    }

    const fieldHist = session.fieldHistory[fieldName] || [];

    // Check if duplicate of latest history version
    if (fieldHist.length > 0 && fieldHist[fieldHist.length - 1].content === content) {
        return;
    }

    const newVersion = {
        content,
        source,
        timestamp: Date.now(),
    };

    fieldHist.push(newVersion);

    // Keep only last N versions
    if (fieldHist.length > MAX_VERSIONS) {
        fieldHist.shift();
    }

    session.fieldHistory[fieldName] = fieldHist;
}

/**
 * Get the history of a card field.
 * @param {object} session
 * @param {string} fieldName
 * @returns {Array<object>} History entries: { content, source, timestamp }
 */
export function getFieldHistory(session, fieldName) {
    if (!session?.fieldHistory) return [];
    return session.fieldHistory[fieldName] || [];
}

/**
 * Clear history for a field.
 * @param {object} session
 * @param {string} fieldName
 */
export function clearFieldHistory(session, fieldName) {
    if (!session?.fieldHistory) return;
    delete session.fieldHistory[fieldName];
}

/**
 * Computes a visual diff between two strings using SillyTavern's bundled DiffMatchPatch.
 * Returns an HTML string showing additions (ins) and deletions (del).
 *
 * @param {string} oldText
 * @param {string} newText
 * @returns {string} Safe HTML representation of the diff
 */
export function buildFieldDiffHtml(oldText, newText) {
    const DMP = SillyTavern?.libs?.DiffMatchPatch;
    if (!DMP) {
        // Fallback: simple text comparison indicator
        return `<div class="ccs-diff-fallback">Diff Match Patch library unavailable.</div>`;
    }

    try {
        const dmp = new DMP();
        const diffs = dmp.diff_main(oldText || '', newText || '');
        dmp.diff_cleanupSemantic(diffs);

        return diffs.map(([op, text]) => {
            const escaped = escapeHtml(text);
            if (op === 1) { // Insert
                return `<ins class="ccs-diff-add">${escaped}</ins>`;
            } else if (op === -1) { // Delete
                return `<del class="ccs-diff-del">${escaped}</del>`;
            } else { // Equal
                return `<span class="ccs-diff-equal">${escaped}</span>`;
            }
        }).join('');
    } catch (e) {
        console.error('[CCS] Error computing diff:', e);
        return `<div class="ccs-diff-error">Error generating diff representation.</div>`;
    }
}

/**
 * Simple HTML escaping utility since DOMPurify/showdown might not be imported.
 */
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
