/**
 * CharCardStudio v4.0.0 — modes/janitor.js
 * JanitorAI Conversion Mode: welcome screen, suggestion chips.
 *
 * This mode converts an existing ST card to JanitorAI-compatible format.
 * The AI reads the card (read-only) and presents converted fields
 * as copyable code blocks in the chat.
 */

// ─── Welcome Content ────────────────────────────────────────────────────────

/**
 * Get the welcome HTML for JanitorAI conversion mode.
 * @returns {string} HTML string for the welcome message
 */
export function getJanitorWelcome() {
    return `
        <div class="ccs-welcome-icon">
            <i class="fa-solid fa-rotate"></i>
        </div>
        <h3 class="ccs-welcome-title">JanitorAI Conversion</h3>
        <p class="ccs-welcome-text">I'll convert your SillyTavern character card to JanitorAI-compatible format. I'll read your current card, analyze each field, and show you exactly what needs to change.</p>
        <div class="ccs-mode-info">
            <p><strong>What I'll check:</strong></p>
            <ul>
                <li>Merge Personality → Janitor Description</li>
                <li>Move Character Note PList → Scenario</li>
                <li>Fix Example Messages format</li>
                <li>Rewrite First Message if it acts for {{user}}</li>
                <li>Token efficiency pass</li>
            </ul>
            <p class="ccs-mode-note"><i class="fa-solid fa-circle-info"></i> Read-only mode — your card won't be modified. Copy the converted output to JanitorAI manually.</p>
        </div>
    `;
}

/**
 * Get suggestion chips for JanitorAI conversion mode.
 * @returns {Array<{text: string, icon: string}>}
 */
export function getJanitorChips() {
    return [
        { text: 'Convert my card', icon: 'fa-solid fa-rotate' },
        { text: 'Show conversion checklist', icon: 'fa-solid fa-list-check' },
        { text: 'Focus on token efficiency', icon: 'fa-solid fa-gauge-high' },
        { text: 'Just check compatibility', icon: 'fa-solid fa-magnifying-glass' },
    ];
}
