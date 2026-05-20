/**
 * CharCardStudio v4.0.0 — modes/fictionlab.js
 * FictionLab Mode: BLOCKED placeholder.
 *
 * FictionLab recently updated its card format. This mode will be
 * available when the new format is documented. For now it shows
 * a "coming soon" message and disables all input.
 */

// ─── Welcome Content ────────────────────────────────────────────────────────

/**
 * Get the blocked placeholder HTML for FictionLab mode.
 * @returns {string} HTML string for the blocked message
 */
export function getFictionLabWelcome() {
    return `
        <div class="ccs-welcome-icon ccs-welcome-icon--muted">
            <i class="fa-solid fa-flask"></i>
        </div>
        <h3 class="ccs-welcome-title">FictionLab Mode</h3>
        <div class="ccs-blocked-notice">
            <div class="ccs-blocked-badge">
                <i class="fa-solid fa-triangle-exclamation"></i>
                Coming in a Future Update
            </div>
            <p>FictionLab recently updated its card format. This mode will be available when the new format is documented.</p>
            <p>Your concepts are saved in the session and will be ready when this mode launches.</p>
        </div>
    `;
}

/**
 * Check if FictionLab mode is blocked.
 * @returns {boolean} Always true — mode is not yet implemented
 */
export function isFictionLabBlocked() {
    return true;
}

/**
 * Get chips for FictionLab mode (empty — mode is blocked).
 * @returns {Array}
 */
export function getFictionLabChips() {
    return [];
}
