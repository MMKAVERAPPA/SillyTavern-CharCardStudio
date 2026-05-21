/**
 * CharCardStudio v4.0.0 — modes/html.js
 * HTML Intro Mode: welcome screen, suggestion chips, iframe preview.
 *
 * This mode generates HTML introduction documents for publishing
 * character cards online. Supports three complexity tiers:
 *   - Simple (JanitorAI) — inline tags only
 *   - Intermediate (ChubAI/Venus) — inline CSS, flexbox
 *   - Advanced (Full Web) — HTML5 + CSS3 + animations
 */

// ─── Welcome Content ────────────────────────────────────────────────────────

/**
 * Get the welcome HTML for HTML Intro mode.
 * @returns {string} HTML string for the welcome message
 */
export function getHtmlWelcome() {
    return `
        <div class="ccs-welcome-icon">
            <i class="fa-solid fa-code"></i>
        </div>
        <h3 class="ccs-welcome-title">HTML Intro Generator</h3>
        <p class="ccs-welcome-text">I'll create a beautiful HTML introduction for your character card. Choose a complexity tier based on where you're publishing:</p>
        <div class="ccs-mode-tiers">
            <div class="ccs-tier-item">
                <strong>Simple</strong> — JanitorAI compatible. Inline tags only, RGB colors.
            </div>
            <div class="ccs-tier-item">
                <strong>Intermediate</strong> — ChubAI / Venus. Inline CSS, gradients, flexbox.
            </div>
            <div class="ccs-tier-item">
                <strong>Advanced</strong> — Full web. HTML5 + CSS3, animations, Google Fonts.
            </div>
        </div>
        <p class="ccs-mode-note"><i class="fa-solid fa-circle-info"></i> Read-only mode — HTML is not saved to your card. Copy the output to your publishing platform.</p>
    `;
}

/**
 * Get suggestion chips for HTML Intro mode.
 * @returns {Array<{text: string, icon: string}>}
 */
export function getHtmlChips() {
    return [
        { text: 'Simple (JanitorAI)', icon: 'fa-solid fa-file-code' },
        { text: 'Intermediate (ChubAI)', icon: 'fa-solid fa-palette' },
        { text: 'Advanced (Full Web)', icon: 'fa-solid fa-wand-magic-sparkles' },
        { text: 'Preview last output', icon: 'fa-solid fa-eye' },
    ];
}

// ─── HTML Preview ───────────────────────────────────────────────────────────

/**
 * Extract HTML code from the last assistant message in chat.
 * Looks for ```html ... ``` code blocks.
 * @param {string} messageContent - The assistant message content
 * @returns {string|null} Extracted HTML, or null if not found
 */
export function extractHtmlFromMessage(messageContent) {
    if (!messageContent) return null;

    // Match ```html ... ``` code blocks
    const match = messageContent.match(/```html\s*\n([\s\S]*?)```/);
    if (match) return match[1].trim();

    // Fallback: match ``` ... ``` that looks like HTML
    const genericMatch = messageContent.match(/```\s*\n([\s\S]*?)```/);
    if (genericMatch) {
        const content = genericMatch[1].trim();
        if (content.startsWith('<') || content.includes('<!DOCTYPE')) {
            return content;
        }
    }

    return null;
}

/**
 * Render an HTML preview in a sandboxed iframe.
 * Creates or updates an iframe element in the given container.
 * @param {HTMLElement} container - DOM element to place the iframe in
 * @param {string} htmlContent - The HTML to preview
 */
export function renderHtmlPreview(container, htmlContent) {
    if (!container || !htmlContent) return;

    // Clear existing content
    container.innerHTML = '';

    // Create header
    const header = document.createElement('div');
    header.className = 'ccs-preview-header';
    header.innerHTML = `
        <span><i class="fa-solid fa-eye"></i> HTML Preview</span>
        <button class="ccs-btn ccs-btn--sm ccs-preview-close" title="Close preview">
            <i class="fa-solid fa-xmark"></i>
        </button>
    `;
    container.appendChild(header);

    // Create sandboxed iframe
    const iframe = document.createElement('iframe');
    iframe.className = 'ccs-html-preview-frame';
    iframe.sandbox = 'allow-same-origin'; // No scripts, no forms, no popups
    iframe.srcdoc = htmlContent;
    iframe.style.width = '100%';
    iframe.style.height = '400px';
    iframe.style.border = '1px solid var(--ccs-border, #333)';
    iframe.style.borderRadius = '8px';
    iframe.style.backgroundColor = '#1a1a2e';

    container.appendChild(iframe);

    // Bind close button
    const closeBtn = header.querySelector('.ccs-preview-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            container.innerHTML = '';
            container.style.display = 'none';
        });
    }

    container.style.display = 'block';
}
