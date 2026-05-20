/**
 * CharCardStudio v4.0.0 — ui/mode-panel.js
 * Right panel adaptation for different modes.
 *
 * Studio mode: shows the 3-tab panel (Concept, Card, Lore).
 * Other modes: keeps all tabs visible (read-only reference) but
 * can overlay a preview panel (e.g., HTML iframe preview).
 */

// ─── Panel Adaptation ───────────────────────────────────────────────────────

/**
 * Adapt the right panel for the current mode.
 * For Studio: show all tabs normally.
 * For non-Studio: all tabs remain visible (read-only reference),
 * but a mode badge is shown to indicate read-only state.
 *
 * @param {string} mode - Current mode
 */
export function adaptPanelForMode(mode) {
    const rightPanel = document.getElementById('ccs_right_panel');
    if (!rightPanel) return;

    // Remove any existing mode badge
    const existingBadge = rightPanel.querySelector('.ccs-mode-badge');
    if (existingBadge) existingBadge.remove();

    // Remove preview panel if exists
    const existingPreview = rightPanel.querySelector('.ccs-preview-panel');
    if (existingPreview) existingPreview.remove();

    if (mode === 'studio') {
        // Studio: normal tabs, no badge
        rightPanel.classList.remove('ccs-panel-readonly');
        return;
    }

    // Non-Studio: add read-only badge and class
    rightPanel.classList.add('ccs-panel-readonly');

    const badge = document.createElement('div');
    badge.className = 'ccs-mode-badge';
    badge.innerHTML = `<i class="fa-solid fa-eye"></i> Read-only reference`;

    // Insert badge before the tabs
    const tabs = rightPanel.querySelector('.ccs-tab-headers');
    if (tabs) {
        tabs.parentNode.insertBefore(badge, tabs);
    }

    // If HTML mode, add a preview container (hidden by default)
    if (mode === 'html') {
        const previewContainer = document.createElement('div');
        previewContainer.id = 'ccs_html_preview';
        previewContainer.className = 'ccs-preview-panel';
        previewContainer.style.display = 'none';
        rightPanel.appendChild(previewContainer);
    }
}

// ─── Welcome & Chips Routing ────────────────────────────────────────────────

/**
 * Get the welcome content HTML for a mode.
 * @param {string} mode
 * @returns {Promise<string>} Welcome HTML
 */
export async function getWelcomeForMode(mode) {
    switch (mode) {
        case 'studio':
            return null; // Studio uses the default welcome in window.html
        case 'janitor': {
            const { getJanitorWelcome } = await import('../modes/janitor.js');
            return getJanitorWelcome();
        }
        case 'html': {
            const { getHtmlWelcome } = await import('../modes/html.js');
            return getHtmlWelcome();
        }
        case 'imageprompt': {
            const { getImagePromptWelcome } = await import('../modes/imageprompt.js');
            return getImagePromptWelcome();
        }
        case 'fictionlab': {
            const { getFictionLabWelcome } = await import('../modes/fictionlab.js');
            return getFictionLabWelcome();
        }
        default:
            return null;
    }
}

/**
 * Get the suggestion chips for a mode.
 * @param {string} mode
 * @returns {Promise<Array<{text: string, icon: string}>>}
 */
export async function getChipsForMode(mode) {
    switch (mode) {
        case 'studio':
            return null; // Studio uses default chips in window.html
        case 'janitor': {
            const { getJanitorChips } = await import('../modes/janitor.js');
            return getJanitorChips();
        }
        case 'html': {
            const { getHtmlChips } = await import('../modes/html.js');
            return getHtmlChips();
        }
        case 'imageprompt': {
            const { getImagePromptChips } = await import('../modes/imageprompt.js');
            return getImagePromptChips();
        }
        case 'fictionlab': {
            const { getFictionLabChips } = await import('../modes/fictionlab.js');
            return getFictionLabChips();
        }
        default:
            return [];
    }
}

/**
 * Check if a mode is blocked (chat input should be disabled).
 * @param {string} mode
 * @returns {Promise<boolean>}
 */
export async function isModeBlocked(mode) {
    if (mode === 'fictionlab') {
        const { isFictionLabBlocked } = await import('../modes/fictionlab.js');
        return isFictionLabBlocked();
    }
    return false;
}
