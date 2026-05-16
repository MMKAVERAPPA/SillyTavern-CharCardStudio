/**
 * CharCardStudio v4.0.0 — ui/chat.js
 * Chat panel: message rendering, input handling, send, cancel, chips
 */

import {
    getSession, addMessage, removeMessage, updateMessage,
    generateId, saveSession,
} from '../core/session.js';
import { isLocked } from '../core/multi-tab.js';
import { cancelAllGenerations, isGenerating } from '../core/silent-generation.js';
import { showToast } from './toast.js';

// ─── State ───────────────────────────────────────────────────────────────────

let _onSendCallback = null; // Set by agent.js in Phase B
let _isStreaming = false;
let _currentStreamMessageId = null;

// ─── DOM ──────────────────────────────────────────────────────────────────────

function el(id) {
    return document.getElementById(id);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Register the function to call when user sends a message.
 * Phase B (agent.js) will call this to plug in the AI handler.
 * @param {function(string): Promise<void>} callback
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
 * Append a token to the current streaming message (Phase B).
 */
export function appendStreamToken(messageId, token) {
    const msgEl = document.querySelector(`[data-message-id="${messageId}"] .ccs-message-content`);
    if (!msgEl) return;
    msgEl.textContent += token;
    _scrollToBottom();
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

    div.innerHTML = `
        <div class="ccs-message-bubble">
            ${!isUser && !isSystem ? '<div class="ccs-message-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div>' : ''}
            <div class="ccs-message-body">
                <div class="ccs-message-content">${_renderMarkdown(message.content)}</div>
                <div class="ccs-message-meta">
                    <span class="ccs-message-time">${_formatTime(message.timestamp || message.createdAt)}</span>
                    ${message.tokenCount ? `<span class="ccs-message-tokens">${message.tokenCount}t</span>` : ''}
                </div>
            </div>
            ${isUser ? '<div class="ccs-message-avatar ccs-message-avatar--user"><i class="fa-solid fa-user"></i></div>' : ''}
        </div>
        <div class="ccs-message-actions">
            ${isUser ? `<button class="ccs-msg-action" data-action="edit" data-id="${message.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>` : ''}
            ${!isSystem ? `<button class="ccs-msg-action" data-action="copy" data-id="${message.id}" title="Copy"><i class="fa-solid fa-copy"></i></button>` : ''}
            ${!isUser && !isSystem ? `<button class="ccs-msg-action" data-action="regen" data-id="${message.id}" title="Regenerate"><i class="fa-solid fa-rotate-right"></i></button>` : ''}
            <button class="ccs-msg-action ccs-msg-action--danger" data-action="delete" data-id="${message.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
    `;

    return div;
}

/**
 * Very lightweight markdown: bold, italic, inline code, line breaks.
 * Full markdown rendering comes in Phase C.
 */
function _renderMarkdown(text) {
    if (!text) return '';
    return escapeHtml(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\n/g, '<br>');
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

async function _sendMessage(text) {
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

    // Show typing indicator
    setTyping(true);

    // Call AI handler (Phase B wires this up)
    if (_onSendCallback) {
        try {
            await _onSendCallback(text);
        } catch (err) {
            if (err?.name !== 'AbortError') {
                console.error('[CCS] Send error:', err);
                showToast(`Error: ${err.message}`, 'error');
                _addErrorMessage(err.message);
            }
        }
    } else {
        // Phase A stub: echo the message back
        await _echoResponse(text);
    }

    setTyping(false);
}

/** Phase A stub — echo response until Phase B wires up the agent */
async function _echoResponse(userText) {
    await new Promise(r => setTimeout(r, 600));

    const aiMsg = {
        id: generateId('msg'),
        role: 'ai',
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
        case 'regen': {
            // Remove this AI message and re-trigger generation from the previous user message
            const session = getSession();
            if (!session) break;

            const msgIndex = session.messages.findIndex(m => m.id === messageId);
            if (msgIndex < 0) break;

            // Find the last user message before this one
            const prevUser = [...session.messages].slice(0, msgIndex).reverse().find(m => m.role === 'user');
            if (!prevUser) {
                showToast('No user message to regenerate from.', 'warning');
                break;
            }

            // Remove this AI message
            removeMessage(messageId);
            removeRenderedMessage(messageId);

            // Re-trigger
            if (_onSendCallback) {
                setTyping(true);
                try {
                    await _onSendCallback(prevUser.content, { isRegen: true });
                } catch (err) {
                    if (err?.name !== 'AbortError') {
                        showToast(`Regeneration failed: ${err.message}`, 'error');
                    }
                } finally {
                    setTyping(false);
                }
            }
            break;
        }
        case 'edit': {
            const session = getSession();
            const msg = session?.messages?.find(m => m.id === messageId);
            if (!msg) break;

            // Inline edit: replace bubble with textarea
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

// ─── Event Binding ────────────────────────────────────────────────────────────

export function bindChatEvents() {
    // Send button
    const sendBtn = el('ccs_send_btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', () => {
            const inputEl = el('ccs_input');
            if (inputEl) _sendMessage(inputEl.value);
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
                _sendMessage(inputEl.value);
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
                if (value) _sendMessage(value);
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
            if (chip) _sendMessage(chip.dataset.chip);
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
