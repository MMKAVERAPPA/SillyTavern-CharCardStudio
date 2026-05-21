/**
 * CharCardStudio v4.0.0 — modes/imageprompt.js
 * Image Prompt Mode: welcome screen, suggestion chips.
 *
 * This mode generates optimized image generation prompts for the character
 * based on card data. Supports multiple AI image models with model-specific
 * prompt structures, quality tags, and negative prompts.
 */

// ─── Welcome Content ────────────────────────────────────────────────────────

/**
 * Get the welcome HTML for Image Prompt mode.
 * @returns {string} HTML string for the welcome message
 */
export function getImagePromptWelcome() {
    return `
        <div class="ccs-welcome-icon">
            <i class="fa-solid fa-image"></i>
        </div>
        <h3 class="ccs-welcome-title">Image Prompt Generator</h3>
        <p class="ccs-welcome-text">I'll create optimized image generation prompts for your character. Choose your target model and I'll generate 3 variations (portrait, action, scene).</p>
        <div class="ccs-mode-info">
            <p><strong>Supported Models:</strong></p>
            <div class="ccs-model-grid">
                <span class="ccs-model-tag">SD 1.5 / SDXL</span>
                <span class="ccs-model-tag">Pony Diffusion XL</span>
                <span class="ccs-model-tag">Illustrious / NoobAI</span>
                <span class="ccs-model-tag">Flux</span>
                <span class="ccs-model-tag">NovelAI</span>
                <span class="ccs-model-tag">MidJourney / Niji</span>
            </div>
        </div>
        <p class="ccs-mode-note"><i class="fa-solid fa-circle-info"></i> Read-only mode — prompts are for you to copy into your image generator.</p>
    `;
}

/**
 * Get suggestion chips for Image Prompt mode.
 * @returns {Array<{text: string, icon: string}>}
 */
export function getImagePromptChips() {
    return [
        { text: 'SD / SDXL prompt', icon: 'fa-solid fa-cube' },
        { text: 'Pony Diffusion', icon: 'fa-solid fa-horse' },
        { text: 'Illustrious / NoobAI', icon: 'fa-solid fa-paintbrush' },
        { text: 'Flux prompt', icon: 'fa-solid fa-bolt' },
        { text: 'NovelAI prompt', icon: 'fa-solid fa-pen-nib' },
        { text: 'MidJourney / Niji', icon: 'fa-solid fa-diamond' },
    ];
}
