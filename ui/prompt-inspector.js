/**
 * CharCardStudio v4.1.0 — ui/prompt-inspector.js
 *
 * Opens a read-only modal showing the exact system prompt + message history
 * that would be sent to the LLM on the next turn. Useful for debugging
 * prompt construction and estimating token usage.
 */

import { buildSystemPrompt } from '../prompts/phase-instructions.js';
import { getSession } from '../core/session.js';
import { countTokensSync } from '../core/token-utils.js';

// ─── Public ──────────────────────────────────────────────────────────────────

/**
 * Build and display the Prompt Inspector modal.
 * Async because buildSystemPrompt may await session-memory.
 */
export async function openPromptInspector() {
    const session = getSession();
    if (!session) return;

    // Assemble the system prompt exactly as the agent would
    let systemPrompt = '';
    try {
        systemPrompt = await buildSystemPrompt(session);
    } catch (e) {
        systemPrompt = `(Failed to build prompt: ${e.message})`;
    }

    const messages = session.messages || [];
    const systemTokens  = countTokensSync(systemPrompt);
    const historyTokens = messages.reduce((s, m) => s + countTokensSync(m.content || ''), 0);
    const totalTokens   = systemTokens + historyTokens;

    // Remove stale modal if any
    document.getElementById('ccs_inspector_overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'ccs_inspector_overlay';
    overlay.className = 'ccs-inspector-overlay';
    overlay.innerHTML = `
    <div class="ccs-inspector-modal" role="dialog" aria-modal="true" aria-label="Prompt Inspector">
        <div class="ccs-inspector-header">
            <h3><i class="fa-solid fa-magnifying-glass-chart"></i> Prompt Inspector</h3>
            <button id="ccs_inspector_close" class="ccs-icon-btn" title="Close">
                <i class="fa-solid fa-xmark"></i>
            </button>
        </div>

        <div class="ccs-inspector-meta">
            <span title="Current mode and phase">
                <i class="fa-solid fa-layer-group"></i>
                ${_cap(session.mode)} / ${_cap(session.phase)}
            </span>
            <span title="Message history size">
                <i class="fa-solid fa-comments"></i>
                ${messages.length} msgs (~${historyTokens.toLocaleString()}t)
            </span>
            <span title="System prompt token estimate">
                <i class="fa-solid fa-server"></i>
                System: ~${systemTokens.toLocaleString()}t
            </span>
            <span class="ccs-inspector-total" title="Estimated total context size">
                <i class="fa-solid fa-calculator"></i>
                Total: ~${totalTokens.toLocaleString()}t
            </span>
        </div>

        <div class="ccs-inspector-tabs">
            <button class="ccs-inspector-tab-btn active" data-itab="system">
                <i class="fa-solid fa-scroll"></i> System Prompt
            </button>
            <button class="ccs-inspector-tab-btn" data-itab="history">
                <i class="fa-solid fa-clock-rotate-left"></i> History (${messages.length})
            </button>
        </div>

        <div class="ccs-inspector-body">
            <pre class="ccs-inspector-pre" id="ccs_inspector_content">${_esc(systemPrompt)}</pre>
        </div>

        <div class="ccs-inspector-footer">
            <button id="ccs_inspector_copy" class="ccs-btn ccs-btn--secondary">
                <i class="fa-solid fa-copy"></i> Copy
            </button>
            <span class="ccs-inspector-hint">Read-only · shows the exact context the AI receives</span>
        </div>
    </div>`;

    document.body.appendChild(overlay);

    // ── Wire events ────────────────────────────────────────────────────────

    const pre = overlay.querySelector('#ccs_inspector_content');

    // Build history text once (lazy)
    const historyText = messages.length
        ? messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n────────────────\n\n')
        : '(No messages in history for this mode)';

    // Tab switching
    overlay.querySelectorAll('.ccs-inspector-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            overlay.querySelectorAll('.ccs-inspector-tab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            pre.textContent = btn.dataset.itab === 'system' ? systemPrompt : historyText;
            pre.scrollTop = 0;
        });
    });

    // Copy
    overlay.querySelector('#ccs_inspector_copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(pre.textContent);
            const copyBtn = overlay.querySelector('#ccs_inspector_copy');
            const orig = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
            setTimeout(() => { copyBtn.innerHTML = orig; }, 2000);
        } catch (e) {
            console.warn('[CCS] Clipboard write failed:', e);
        }
    });

    // Close
    overlay.querySelector('#ccs_inspector_close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

    // Escape key
    function _onKey(e) {
        if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _onKey); }
    }
    document.addEventListener('keydown', _onKey);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function _cap(str) {
    if (!str) return '';
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function _esc(str) {
    const el = document.createElement('div');
    el.textContent = str;
    return el.innerHTML;
}
