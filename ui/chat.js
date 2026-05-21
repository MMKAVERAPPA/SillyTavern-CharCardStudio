/**
 * CharCardStudio v4.0.0 — ui/chat.js
 * Chat panel: message rendering, input handling, send, cancel, chips
 */

import {
    getSession, addMessage, removeMessage, updateMessage,
    generateId, saveSession, updateSession,
} from '../core/session.js';
import { isLocked } from '../core/multi-tab.js';
import { cancelAllGenerations, isGenerating } from '../core/silent-generation.js';
import { applyDraftToCard, applyLoreDraft } from '../core/tools.js';
import { markPillarDoneByField } from '../core/pillars.js';
import { showToast } from './toast.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _onSendCallback = null; // Set by agent.js via onSend()
let _isStreaming = false;
let _draftActionCallbacks = {}; // draft.id → { onRegen }

// ─── DOM ──────────────────────────────────────────────────────────────────────

function el(id) {
    return document.getElementById(id);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register the function to call when user sends a message.
 * agent.js calls this to plug in the AI handler.
 * Signature: callback(text, { appendAssistantMessage, renderDraft, setTyping })
 * @param {function} callback
 */
export function onSend(callback) {
    _onSendCallback = callback;
}

/**
 * Show/hide the typing indicator.
 */
export function setTyping(active, label = 'Thinking...') {
    const indicator = el('ccs_typing');
    if (!indicator) return;
    indicator.style.display = active ? 'flex' : 'none';
    const labelEl = indicator.querySelector('.ccs-typing-label');
    if (labelEl) labelEl.textContent = label;
    _isStreaming = active;
    _syncInputState();
}

/**
 * Render a staged draft card inline in the chat.
 * Shows field name, content preview, token count, and Apply/Skip/Regen buttons.
 * @param {object} draft - Draft object from tools.js
 */
export function renderStagedDraftMessage(draft) {
    console.log('[CCS] renderStagedDraftMessage called:', draft?.id, draft?.field);
    const container = el('ccs_messages');
    if (!container) {
        console.error('[CCS] renderStagedDraftMessage: #ccs_messages container not found!');
        return;
    }

    const welcome = el('ccs_welcome');
    if (welcome) welcome.style.display = 'none';

    // If this draft already has a DOM element (e.g. version added via regen), update it
    const existingEl = container.querySelector(`[data-draft-id="${draft.id}"]`);
    if (existingEl) {
        _updateDraftCardContent(existingEl, draft);
        return;
    }

    const div = document.createElement('div');
    div.className = 'ccs-message ccs-message--draft';
    div.dataset.draftId = draft.id;

    div.innerHTML = _buildDraftCardHtml(draft);

    container.appendChild(div);
    console.log('[CCS] Draft card DOM element appended to #ccs_messages.');
    _scrollToBottom();
}

function _buildDraftCardHtml(draft) {
    const preview = draft.content.length > 400
        ? draft.content.substring(0, 400) + '...'
        : draft.content;

    const hasVersions = draft.versions && draft.versions.length > 1;
    const versionIdx = draft.activeVersion ?? 0;
    const versionLabel = hasVersions ? `v${versionIdx + 1}/${draft.versions.length}` : '';

    return `
        <div class="ccs-draft-card">
            <div class="ccs-draft-header">
                <span class="ccs-draft-field">${escapeHtml(draft.field)}</span>
                ${hasVersions ? `
                    <span class="ccs-draft-version-nav">
                        <button class="ccs-btn ccs-btn--icon" data-draft-action="version-prev" data-draft-id="${draft.id}" ${versionIdx <= 0 ? 'disabled' : ''}>
                            <i class="fa-solid fa-chevron-left"></i>
                        </button>
                        <span class="ccs-draft-version-label">${versionLabel}</span>
                        <button class="ccs-btn ccs-btn--icon" data-draft-action="version-next" data-draft-id="${draft.id}" ${versionIdx >= draft.versions.length - 1 ? 'disabled' : ''}>
                            <i class="fa-solid fa-chevron-right"></i>
                        </button>
                    </span>
                ` : ''}
                <span class="ccs-draft-tokens">${draft.tokenCount || '?'} tokens</span>
                <span class="ccs-draft-status" data-status="${draft.status}">${draft.status}</span>
            </div>
            <div class="ccs-draft-content"><pre>${escapeHtml(preview)}</pre></div>
            <div class="ccs-draft-edit-area" style="display: none;">
                <textarea class="ccs-draft-textarea">${escapeHtml(draft.content)}</textarea>
                <div class="ccs-draft-edit-actions">
                    <button class="ccs-btn ccs-btn--sm ccs-btn--accent" data-draft-action="save-edit" data-draft-id="${draft.id}">Save Edit</button>
                    <button class="ccs-btn ccs-btn--sm" data-draft-action="cancel-edit" data-draft-id="${draft.id}">Cancel</button>
                </div>
            </div>
            <div class="ccs-draft-actions">
                <button class="ccs-btn ccs-btn--sm ccs-btn--accent" data-draft-action="apply" data-draft-id="${draft.id}">
                    <i class="fa-solid fa-check"></i> Apply
                </button>
                <button class="ccs-btn ccs-btn--sm" data-draft-action="edit" data-draft-id="${draft.id}">
                    <i class="fa-solid fa-pen"></i> Edit
                </button>
                <button class="ccs-btn ccs-btn--sm" data-draft-action="regen" data-draft-id="${draft.id}">
                    <i class="fa-solid fa-rotate-right"></i> Regen
                </button>
                <button class="ccs-btn ccs-btn--sm" data-draft-action="skip" data-draft-id="${draft.id}">
                    <i class="fa-solid fa-forward"></i> Skip
                </button>
            </div>
        </div>
    `;
}

function _updateDraftCardContent(draftEl, draft) {
    const preview = draft.content.length > 400
        ? draft.content.substring(0, 400) + '...'
        : draft.content;
    const contentEl = draftEl.querySelector('.ccs-draft-content pre');
    if (contentEl) contentEl.textContent = preview;

    const tokensEl = draftEl.querySelector('.ccs-draft-tokens');
    if (tokensEl) tokensEl.textContent = `${draft.tokenCount || '?'} tokens`;

    const textareaEl = draftEl.querySelector('.ccs-draft-textarea');
    if (textareaEl) textareaEl.value = draft.content;

    // Update version nav
    if (draft.versions && draft.versions.length > 1) {
        const versionLabel = draftEl.querySelector('.ccs-draft-version-label');
        if (versionLabel) versionLabel.textContent = `v${(draft.activeVersion ?? 0) + 1}/${draft.versions.length}`;

        const prevBtn = draftEl.querySelector('[data-draft-action="version-prev"]');
        const nextBtn = draftEl.querySelector('[data-draft-action="version-next"]');
        if (prevBtn) prevBtn.disabled = (draft.activeVersion ?? 0) <= 0;
        if (nextBtn) nextBtn.disabled = (draft.activeVersion ?? 0) >= draft.versions.length - 1;
    }

    // If no version nav exists yet but now has versions, re-render the whole card
    if (draft.versions && draft.versions.length > 1 && !draftEl.querySelector('.ccs-draft-version-nav')) {
        draftEl.innerHTML = _buildDraftCardHtml(draft);
    }
}

/**
 * Render all messages from session state.
 */
export function renderMessages() {
    const container = el('ccs_messages');
    if (!container) return;

    const session = getSession();
    const messages = session?.messages || [];

    // Show welcome if no messages
    const welcome = el('ccs_welcome');
    if (welcome) {
        welcome.style.display = messages.length === 0 ? 'flex' : 'none';
    }

    // Remove all existing rendered messages (not the welcome element)
    const existingMsgs = container.querySelectorAll('.ccs-message');
    existingMsgs.forEach(m => m.remove());

    // Re-render all messages
    messages.forEach(msg => {
        const el = _createMessageElement(msg);
        container.appendChild(el);
    });

    _scrollToBottom();
}

/**
 * Append a single new message to the chat (faster than full re-render).
 */
export function appendMessage(message) {
    const container = el('ccs_messages');
    if (!container) return;

    // Hide welcome
    const welcome = el('ccs_welcome');
    if (welcome) welcome.style.display = 'none';

    const msgEl = _createMessageElement(message);
    container.appendChild(msgEl);
    _scrollToBottom();
}

/**
 * Update an existing rendered message (e.g., after streaming completes).
 */
export function updateRenderedMessage(messageId, updates) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (!msgEl) return;

    if (updates.content !== undefined) {
        const contentEl = msgEl.querySelector('.ccs-message-content');
        if (contentEl) contentEl.innerHTML = _renderMarkdown(updates.content);
    }
    if (updates.status !== undefined) {
        msgEl.dataset.status = updates.status;
    }
}

/**
 * Remove a rendered message from the DOM.
 */
export function removeRenderedMessage(messageId) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
    if (msgEl) msgEl.remove();
}

/**
 * Set suggestion chips below the input.
 * @param {Array<{label: string, value: string}>} chips
 */
export function setSuggestionChips(chips) {
    const container = el('ccs_chips');
    if (!container) return;

    if (!chips?.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = chips.map(chip => `
        <button class="ccs-chip" data-chip="${escapeAttr(chip.value || chip.label)}">
            ${escapeHtml(chip.label)}
        </button>
    `).join('');
}

// ─── Message Rendering ────────────────────────────────────────────────────────

function _createMessageElement(message) {
    const div = document.createElement('div');
    div.className = `ccs-message ccs-message--${message.role}`;
    div.dataset.messageId = message.id;

    const isUser = message.role === 'user';
    const isSystem = message.role === 'system';
    const meta = message.meta || {};

    // Reasoning block (collapsed by default)
    let reasoningHtml = '';
    if (meta.reasoning) {
        reasoningHtml = `
            <details class="ccs-reasoning">
                <summary>Reasoning</summary>
                <div class="ccs-reasoning-content">${escapeHtml(meta.reasoning)}</div>
            </details>
        `;
    }

    div.innerHTML = `
        <div class="ccs-message-bubble">
            ${!isUser && !isSystem ? '<div class="ccs-message-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>' : ''}
            <div class="ccs-message-body">
                ${reasoningHtml}
                <div class="ccs-message-content">${_renderMarkdown(message.content)}</div>
                <div class="ccs-message-meta">
                    <span class="ccs-message-time">${_formatTime(message.timestamp || message.createdAt)}</span>
                    ${message.tokenCount ? `<span class="ccs-message-tokens">${message.tokenCount}t</span>` : ''}
                </div>
            </div>
            ${isUser ? '<div class="ccs-message-avatar ccs-message-avatar--user"><i class="fa-solid fa-user"></i></div>' : ''}
        </div>
        <div class="ccs-message-actions">
            ${isUser ? `<button class="ccs-msg-action" data-action="resend" data-id="${message.id}" title="Resend"><i class="fa-solid fa-paper-plane"></i></button>` : ''}
            ${!isSystem ? `<button class="ccs-msg-action" data-action="copy" data-id="${message.id}" title="Copy"><i class="fa-solid fa-copy"></i></button>` : ''}
            ${!isUser && !isSystem ? `<button class="ccs-msg-action" data-action="regen" data-id="${message.id}" title="Regenerate"><i class="fa-solid fa-rotate-right"></i></button>` : ''}
            <button class="ccs-msg-action ccs-msg-action--danger" data-action="delete" data-id="${message.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
    `;

    return div;
}

/**
 * Full markdown rendering via SillyTavern's bundled showdown + DOMPurify.
 * Supports: tables, fenced code blocks, task lists, headers (h3+), blockquotes,
 * strikethrough, and auto line breaks. Falls back to basic regex if showdown
 * is unavailable.
 */
let _showdownConverter = null;

function _getConverter() {
    if (_showdownConverter) return _showdownConverter;
    const showdown = SillyTavern?.libs?.showdown;
    if (!showdown) return null;
    _showdownConverter = new showdown.Converter({
        tables: true,
        ghCodeBlocks: true,
        tasklists: true,
        strikethrough: true,
        simpleLineBreaks: true,
        openLinksInNewWindow: true,
        emoji: true,
        headerLevelStart: 3,       // Prevent h1/h2 inside chat bubbles
        ghCompatibleHeaderId: true,
        parseImgDimensions: true,
    });
    _showdownConverter.setFlavor('github');
    return _showdownConverter;
}

function _renderMarkdown(text) {
    if (!text) return '';

    const converter = _getConverter();
    if (!converter) {
        // Fallback: basic regex if showdown not available
        return escapeHtml(text)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }

    let html = converter.makeHtml(text);

    // Wrap tables for mobile horizontal scroll
    html = html.replace(/<table\b/g, '<div class="ccs-table-wrapper"><table')
               .replace(/<\/table>/g, '</table></div>');

    // Sanitize with DOMPurify (allows safe HTML subset)
    const DOMPurify = SillyTavern?.libs?.DOMPurify;
    if (DOMPurify) {
        html = DOMPurify.sanitize(html, {
            ALLOWED_TAGS: [
                'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
                'h3', 'h4', 'h5', 'h6',
                'ul', 'ol', 'li', 'input',
                'table', 'thead', 'tbody', 'tr', 'th', 'td',
                'blockquote', 'pre', 'code',
                'a', 'span', 'div', 'hr',
            ],
            ALLOWED_ATTR: [
                'href', 'target', 'rel', 'class', 'type', 'checked', 'disabled',
                'colspan', 'rowspan', 'align',
            ],
        });
    }

    // Wrap code blocks for copy button (after sanitize to preserve our injected button)
    html = html.replace(/<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/gi, (match, attrs, codeContent) => {
        return `<div class="ccs-code-block">
            <button class="ccs-code-copy-btn" title="Copy code"><i class="fa-solid fa-copy"></i></button>
            <pre><code${attrs}>${codeContent}</code></pre>
        </div>`;
    });

    return html;
}

function _formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function _scrollToBottom() {
    const container = el('ccs_messages');
    if (container) {
        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
    }
}

// ─── Send Message ─────────────────────────────────────────────────────────────

export async function sendMessage(text) {
    text = text.trim();
    if (!text) return;
    if (_isStreaming) {
        showToast('Please wait for the current response to finish.', 'warning');
        return;
    }
    if (isLocked()) {
        showToast('View-only mode — cannot send messages while another tab is editing this character.', 'warning');
        return;
    }

    // Intercept preview commands locally in HTML mode
    const session = getSession();
    const mode = session?.mode || 'studio';
    const isPreviewCmd = text.toLowerCase() === 'preview' || text.toLowerCase() === '/preview' || text.toLowerCase() === 'preview last output';

    if (mode === 'html' && isPreviewCmd) {
        const previewContainer = el('ccs_html_preview');
        if (previewContainer) {
            // Find last assistant message containing HTML block
            const lastAssistantMsg = [...(session?.messages || [])]
                .reverse()
                .find(m => m.role === 'assistant' && (m.content?.includes('```html') || m.content?.includes('<!DOCTYPE') || m.content?.includes('<html')));

            if (lastAssistantMsg) {
                try {
                    const { extractHtmlFromMessage, renderHtmlPreview } = await import('../modes/html.js');
                    const htmlContent = extractHtmlFromMessage(lastAssistantMsg.content);
                    if (htmlContent) {
                        renderHtmlPreview(previewContainer, htmlContent);
                        showToast('Rendering HTML preview...', 'success');
                        
                        // Clear input
                        const inputEl = el('ccs_input');
                        if (inputEl) {
                            inputEl.value = '';
                            inputEl.style.height = 'auto';
                        }
                        return; // Intercepted successfully, exit early without sending to AI
                    }
                } catch (e) {
                    console.error('[CCS] Error rendering html preview:', e);
                }
            }
        }
        showToast('No HTML content found to preview. Generate one first!', 'warning');
        return;
    }

    // Clear input
    const inputEl = el('ccs_input');
    if (inputEl) {
        inputEl.value = '';
        inputEl.style.height = 'auto';
    }

    // Add user message to session + DOM
    const userMsg = {
        id: generateId('msg'),
        role: 'user',
        content: text,
        timestamp: Date.now(),
    };
    addMessage(userMsg);
    appendMessage(userMsg);

    // Clear suggestion chips
    setSuggestionChips([]);

    // Call AI handler with callbacks
    if (_onSendCallback) {
        try {
            await _onSendCallback(text, {
                appendAssistantMessage: (content, meta) => {
                    // The agent already called addMessage() to persist in session.
                    // We only need to render the message in the DOM here.
                    // Get the last message from session (which the agent just added)
                    const session = getSession();
                    const lastMsg = session?.messages?.[session.messages.length - 1];
                    if (lastMsg && lastMsg.role === 'assistant') {
                        console.log('[CCS] appendAssistantMessage rendering from session:', lastMsg.id);
                        appendMessage(lastMsg);
                    } else {
                        // Fallback: create a render-only message object
                        console.warn('[CCS] appendAssistantMessage fallback: creating render-only msg');
                        appendMessage({
                            id: generateId('msg'),
                            role: 'assistant',
                            content,
                            timestamp: Date.now(),
                            meta,
                        });
                    }
                },
                renderDraft: (draft) => {
                    renderStagedDraftMessage(draft);
                },
                setTyping,
            });
        } catch (err) {
            if (err?.name !== 'AbortError') {
                console.error('[CCS] Send error:', err);
                showToast(`Error: ${err.message}`, 'error');
                _addErrorMessage(err.message);
            }
        }
    } else {
        // No agent wired — echo stub
        setTyping(true);
        setTimeout(() => {
            setTyping(false);
            appendMessage({ id: generateId('msg'), role: 'assistant', content: "I am not wired to an agent yet.", timestamp: Date.now() });
        }, 1000);
    }
}

/**
 * Trigger an AI Review of the current card.
 * Switches to the chat tab and sends a system-instructed user message.
 */
export async function triggerAIReview() {
    // Switch to Chat tab
    const chatTabBtn = document.querySelector('.ccs-tab-btn[data-tab="chat"]');
    if (chatTabBtn) chatTabBtn.click();
    
    // Switch mobile to chat panel
    const appEl = document.getElementById('ccs_app');
    if (appEl && appEl.classList.contains('ccs-mobile')) {
        const mobileChatBtn = document.querySelector('.ccs-mobile-tab-btn[data-mobile-tab="chat"]');
        if (mobileChatBtn) mobileChatBtn.click();
    }

    const reviewPrompt = `Please act as a professional Character Card Reviewer. I want you to review the current state of my character card.
Evaluate the character's depth, uniqueness, and adherence to the chosen format.

CRITICAL INSTRUCTION: You MUST use the \`ccs_submit_review\` tool to submit your visual scorecard. Provide your overall 1-5 rating, scores for 3-5 specific categories (like "Concept & Hook", "Token Efficiency", etc.), strengths, weaknesses, and suggestions as JSON parameters to the tool.

After calling the tool, also output your conversational critique so I can read it here.`;

    await sendMessage(reviewPrompt);
}

/** Phase A stub — echo response until Phase B wires up the agent */
async function _echoResponse(userText) {
    await new Promise(r => setTimeout(r, 600));

    const aiMsg = {
        id: generateId('msg'),
        role: 'assistant',
        content: `[Studio AI not yet connected — Phase A stub]\n\nYou said: _"${userText}"_\n\nThe agent will be wired up in Phase B.`,
        timestamp: Date.now(),
    };
    addMessage(aiMsg);
    appendMessage(aiMsg);
}

function _addErrorMessage(errorText) {
    const errMsg = {
        id: generateId('msg'),
        role: 'system',
        content: `⚠️ Generation error: ${errorText}`,
        timestamp: Date.now(),
    };
    addMessage(errMsg);
    appendMessage(errMsg);
}

// ─── Input State ──────────────────────────────────────────────────────────────

function _syncInputState() {
    const sendBtn = el('ccs_send_btn');
    const cancelBtn = el('ccs_cancel_btn');
    const inputEl = el('ccs_input');

    if (sendBtn) sendBtn.style.display = _isStreaming ? 'none' : 'flex';
    if (cancelBtn) cancelBtn.style.display = _isStreaming ? 'flex' : 'none';
    if (inputEl) inputEl.disabled = _isStreaming;
}

// ─── Message Actions ──────────────────────────────────────────────────────────

async function _handleMessageAction(action, messageId) {
    switch (action) {
        case 'delete': {
            removeMessage(messageId);
            removeRenderedMessage(messageId);
            break;
        }
        case 'copy': {
            const session = getSession();
            const msg = session?.messages?.find(m => m.id === messageId);
            if (msg) {
                await navigator.clipboard.writeText(msg.content).catch(() => {});
                showToast('Copied to clipboard', 'success', 2000);
            }
            break;
        }
        case 'resend':
        case 'regen': {
            const session = getSession();
            if (!session) break;

            let userText;
            if (action === 'resend') {
                // Re-send this user message
                const msg = session.messages.find(m => m.id === messageId);
                userText = msg?.content;
            } else {
                // Find the user message before this AI message
                const msgIndex = session.messages.findIndex(m => m.id === messageId);
                if (msgIndex < 0) break;
                const prevUser = [...session.messages].slice(0, msgIndex).reverse().find(m => m.role === 'user');
                userText = prevUser?.content;

                // Remove the AI message being regenerated
                removeMessage(messageId);
                removeRenderedMessage(messageId);
            }

            if (!userText) {
                showToast('No user message to regenerate from.', 'warning');
                break;
            }

            // Re-trigger agent
            if (_onSendCallback) {
                try {
                    await _onSendCallback(userText, {
                        appendAssistantMessage: (content, meta) => {
                            const msg = {
                                id: generateId('msg'),
                                role: 'assistant',
                                content,
                                timestamp: Date.now(),
                                meta,
                            };
                            appendMessage(msg);
                        },
                        renderDraft: (draft) => renderStagedDraftMessage(draft),
                        setTyping,
                    });
                } catch (err) {
                    if (err?.name !== 'AbortError') {
                        showToast(`Regeneration failed: ${err.message}`, 'error');
                    }
                }
            }
            break;
        }
        case 'edit': {
            const session = getSession();
            const msg = session?.messages?.find(m => m.id === messageId);
            if (!msg) break;

            const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
            if (!msgEl) break;

            const contentEl = msgEl.querySelector('.ccs-message-content');
            const originalContent = msg.content;
            contentEl.innerHTML = `
                <textarea class="ccs-inline-edit" rows="3">${escapeHtml(originalContent)}</textarea>
                <div class="ccs-inline-edit-actions">
                    <button class="ccs-btn ccs-btn--sm ccs-btn--accent" data-edit-save="${messageId}">Save</button>
                    <button class="ccs-btn ccs-btn--sm" data-edit-cancel="${messageId}">Cancel</button>
                </div>
            `;
            contentEl.querySelector('textarea')?.focus();
            break;
        }
    }
}

// ─── Draft Actions ──────────────────────────────────────────────────────────

async function _handleDraftAction(action, draftId, buttonEl) {
    const draftCard = buttonEl.closest('.ccs-message--draft');
    const statusEl = draftCard?.querySelector('.ccs-draft-status');

    switch (action) {
        case 'apply': {
            const isLore = draftId.startsWith('lore_');
            const success = isLore
                ? await applyLoreDraft(draftId)
                : await applyDraftToCard(draftId);

            if (success) {
                if (statusEl) {
                    statusEl.textContent = 'applied';
                    statusEl.dataset.status = 'applied';
                }
                draftCard?.querySelectorAll('.ccs-btn').forEach(btn => btn.disabled = true);
                showToast('Draft applied to card!', 'success');
            } else {
                showToast('Failed to apply draft.', 'error');
            }
            break;
        }
        case 'skip': {
            if (statusEl) {
                statusEl.textContent = 'skipped';
                statusEl.dataset.status = 'skipped';
            }
            draftCard?.querySelectorAll('.ccs-btn').forEach(btn => btn.disabled = true);
            showToast('Draft skipped.', 'info', 2000);

            const session = getSession();
            const drafts = session?.cardDrafts || {};
            let skippedField = '';
            for (const d of Object.values(drafts)) {
                if (d.id === draftId) {
                    d.status = 'skipped';
                    skippedField = d.field;
                }
            }
            await updateSession({ cardDrafts: drafts });

            // Mark corresponding pillar as skipped
            if (skippedField && session?.pillarStates) {
                const pillar = session.pillarStates.find(p => p.field === skippedField);
                if (pillar && pillar.status !== 'done') {
                    pillar.status = 'skipped';
                    await updateSession({ pillarStates: session.pillarStates });
                }
            }
            break;
        }
        case 'regen': {
            const session = getSession();
            const drafts = session?.cardDrafts || {};
            let field = '';
            for (const d of Object.values(drafts)) {
                if (d.id === draftId) field = d.field;
            }
            if (field && _onSendCallback) {
                draftCard?.remove();
                await _sendMessage(`Please regenerate the ${field} field with a different approach.`);
            }
            break;
        }
        case 'edit': {
            // Show edit textarea, hide content preview and action buttons
            const content = draftCard?.querySelector('.ccs-draft-content');
            const editArea = draftCard?.querySelector('.ccs-draft-edit-area');
            const actions = draftCard?.querySelector('.ccs-draft-actions');
            if (content) content.style.display = 'none';
            if (editArea) editArea.style.display = 'block';
            if (actions) actions.style.display = 'none';
            break;
        }
        case 'save-edit': {
            const editArea = draftCard?.querySelector('.ccs-draft-edit-area');
            const textarea = draftCard?.querySelector('.ccs-draft-textarea');
            const content = draftCard?.querySelector('.ccs-draft-content');
            const actions = draftCard?.querySelector('.ccs-draft-actions');
            
            if (textarea) {
                const newContent = textarea.value;
                // Update the draft in session
                const session = getSession();
                const drafts = session?.cardDrafts || {};
                for (const d of Object.values(drafts)) {
                    if (d.id === draftId) {
                        d.content = newContent;
                        // Update token count
                        try {
                            const ctx = SillyTavern?.getContext?.();
                            if (ctx?.getTokenCountAsync) {
                                d.tokenCount = await ctx.getTokenCountAsync(newContent);
                            }
                        } catch (e) { /* optional */ }
                        break;
                    }
                }
                await updateSession({ cardDrafts: drafts });
                
                // Update UI
                const preview = newContent.length > 400 ? newContent.substring(0, 400) + '...' : newContent;
                if (content) {
                    content.querySelector('pre').textContent = preview;
                    content.style.display = '';
                }
                const tokensEl = draftCard?.querySelector('.ccs-draft-tokens');
                if (tokensEl) {
                    const d = Object.values(drafts).find(d => d.id === draftId);
                    tokensEl.textContent = `${d?.tokenCount || '?'} tokens`;
                }
                showToast('Draft edited.', 'success', 2000);
            }
            if (editArea) editArea.style.display = 'none';
            if (actions) actions.style.display = '';
            break;
        }
        case 'cancel-edit': {
            const editArea = draftCard?.querySelector('.ccs-draft-edit-area');
            const content = draftCard?.querySelector('.ccs-draft-content');
            const actions = draftCard?.querySelector('.ccs-draft-actions');
            if (editArea) editArea.style.display = 'none';
            if (content) content.style.display = '';
            if (actions) actions.style.display = '';
            break;
        }
        case 'version-prev':
        case 'version-next': {
            const session = getSession();
            const drafts = session?.cardDrafts || {};
            let draft = null;
            for (const d of Object.values(drafts)) {
                if (d.id === draftId) { draft = d; break; }
            }
            if (!draft || !draft.versions || draft.versions.length <= 1) break;

            const currentIdx = draft.activeVersion ?? 0;
            const newIdx = action === 'version-prev'
                ? Math.max(0, currentIdx - 1)
                : Math.min(draft.versions.length - 1, currentIdx + 1);

            if (newIdx === currentIdx) break;

            // Switch to the selected version
            const version = draft.versions[newIdx];
            draft.activeVersion = newIdx;
            draft.content = version.content;
            draft.tokenCount = version.tokenCount;
            await updateSession({ cardDrafts: drafts });

            // Update UI
            _updateDraftCardContent(draftCard, draft);
            break;
        }
    }
}

// ─── Event Binding ────────────────────────────────────────────────────────────

export function bindChatEvents() {
    // Send button
    const sendBtn = el('ccs_send_btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            const inputEl = el('ccs_input');
            if (inputEl) sendMessage(inputEl.value);
        });
    }

    // Cancel button
    const cancelBtn = el('ccs_cancel_btn');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            cancelAllGenerations();
            setTyping(false);
            showToast('Generation cancelled.', 'info', 2000);
        });
    }

    // Input: Enter to send, Shift+Enter for newline
    const inputEl = el('ccs_input');
    if (inputEl) {
        inputEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage(inputEl.value);
            }
        });

        // Auto-grow textarea
        inputEl.addEventListener('input', () => {
            inputEl.style.height = 'auto';
            inputEl.style.height = Math.min(inputEl.scrollHeight, 160) + 'px';
        });
    }

    // Message actions (event delegation on message container)
    const messagesEl = el('ccs_messages');
    if (messagesEl) {
        messagesEl.addEventListener('click', async (e) => {
            // Draft action buttons (Apply/Skip/Regen)
            const draftBtn = e.target.closest('[data-draft-action]');
            if (draftBtn) {
                const action = draftBtn.dataset.draftAction;
                const draftId = draftBtn.dataset.draftId;
                if (action && draftId) await _handleDraftAction(action, draftId, draftBtn);
                return;
            }

            // Message action buttons
            const actionBtn = e.target.closest('.ccs-msg-action');
            if (actionBtn) {
                const action = actionBtn.dataset.action;
                const id = actionBtn.dataset.id;
                if (action && id) await _handleMessageAction(action, id);
                return;
            }

            // Welcome screen chips
            const chip = e.target.closest('.ccs-chip[data-chip]');
            if (chip) {
                const value = chip.dataset.chip;
                if (value) sendMessage(value);
                return;
            }

            // Inline edit save
            const saveBtn = e.target.closest('[data-edit-save]');
            if (saveBtn) {
                const messageId = saveBtn.dataset.editSave;
                const msgEl = document.querySelector(`[data-message-id="${messageId}"]`);
                const textarea = msgEl?.querySelector('.ccs-inline-edit');
                if (textarea) {
                    const newContent = textarea.value.trim();
                    if (newContent) {
                        updateMessage(messageId, { content: newContent });
                        updateRenderedMessage(messageId, { content: newContent });
                    }
                }
                return;
            }

            // Inline edit cancel
            const cancelInlineBtn = e.target.closest('[data-edit-cancel]');
            if (cancelInlineBtn) {
                const messageId = cancelInlineBtn.dataset.editCancel;
                const session = getSession();
                const msg = session?.messages?.find(m => m.id === messageId);
                if (msg) updateRenderedMessage(messageId, { content: msg.content });
                return;
            }
            // Code block copy
            const copyBtn = e.target.closest('.ccs-code-copy-btn');
            if (copyBtn) {
                const codeEl = copyBtn.closest('.ccs-code-block')?.querySelector('code');
                if (codeEl) {
                    try {
                        await navigator.clipboard.writeText(codeEl.textContent);
                        const origHtml = copyBtn.innerHTML;
                        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                        copyBtn.style.color = 'var(--ccs-success)';
                        setTimeout(() => {
                            copyBtn.innerHTML = origHtml;
                            copyBtn.style.color = '';
                        }, 2000);
                        showToast('Code copied to clipboard', 'success', 2000);
                    } catch (err) {
                        showToast('Failed to copy code', 'error');
                    }
                }
                return;
            }
        });

        // Hover — show/hide message actions
        messagesEl.addEventListener('mouseover', (e) => {
            const msg = e.target.closest('.ccs-message');
            if (msg) msg.classList.add('ccs-message--hover');
        });
        messagesEl.addEventListener('mouseout', (e) => {
            const msg = e.target.closest('.ccs-message');
            if (msg) msg.classList.remove('ccs-message--hover');
        });
    }

    // Dynamic chips (below input)
    const chipsEl = el('ccs_chips');
    if (chipsEl) {
        chipsEl.addEventListener('click', (e) => {
            const chip = e.target.closest('.ccs-chip[data-chip]');
            if (chip) sendMessage(chip.dataset.chip);
        });
    }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    if (!str) return '';
    const el = document.createElement('span');
    el.textContent = str;
    return el.innerHTML;
}

function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
