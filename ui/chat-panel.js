// ui/chat-panel.js
// Chat area: message rendering, streaming, accept bars, variation panels, edit/resend

export class ChatPanel {
    constructor() {
        this.container = null;
        this.inputEl = null;
        this.sendBtn = null;
        this.streamingEl = null;
        this.onSend = null;
        this.onAbort = null;
        this.abortBtn = null;
        this.messages = [];
    }

    init(containerId, onSend, onAbort) {
        this.container = document.getElementById(containerId);
        this.onSend = onSend;
        this.onAbort = onAbort;
    }

    bindInput(inputId, sendBtnId, abortBtnId) {
        this.inputEl  = document.getElementById(inputId);
        this.sendBtn  = document.getElementById(sendBtnId);
        this.abortBtn = document.getElementById(abortBtnId);

        // Abort button hidden by default — shown during generation
        if (this.abortBtn) this.abortBtn.style.display = 'none';

        this.sendBtn?.addEventListener('click', () => this._handleSend());
        this.abortBtn?.addEventListener('click', () => {
            this.onAbort?.();
            this.setInputEnabled(true); // re-enable immediately on stop
        });

        this.inputEl?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this._handleSend(); }
        });

        // Auto-grow textarea
        this.inputEl?.addEventListener('input', () => {
            this.inputEl.style.height = 'auto';
            this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + 'px';
        });
    }

    _handleSend() {
        const text = this.inputEl?.value.trim();
        if (!text) return;
        this.addMessage('user', text);
        this.inputEl.value = '';
        this.inputEl.style.height = 'auto';
        this.onSend?.(text);
    }

    // ── Message rendering ─────────────────────────────────────────────────────

    addMessage(role, content, restoreOnly = false) {
        const index = this.messages.length;
        const el = document.createElement('div');
        el.className = `ccs-msg ccs-msg-${role}`;
        el.dataset.index = index;

        const bubble = document.createElement('div');
        bubble.className = 'ccs-msg-bubble';
        bubble.innerHTML = this._renderMarkdown(content);

        const actions = document.createElement('div');
        actions.className = 'ccs-msg-actions';

        if (role === 'user') {
            actions.innerHTML = `
                <button class="ccs-msg-btn" title="Edit & Resend">✏️</button>
                <button class="ccs-msg-btn" title="Resend">🔁</button>
            `;
            actions.querySelector('[title="Edit & Resend"]').addEventListener('click', () => this._editMessage(index, el));
            actions.querySelector('[title="Resend"]').addEventListener('click', () => this._resendMessage(index));
        } else {
            actions.innerHTML = `<button class="ccs-msg-btn" title="Copy">📋</button>`;
            actions.querySelector('[title="Copy"]').addEventListener('click', () => {
                navigator.clipboard.writeText(content).catch(() => {});
            });
        }

        el.appendChild(bubble);
        el.appendChild(actions);
        this.container?.appendChild(el);
        if (!restoreOnly) this.messages.push({ role, content, el, index });
        if (!restoreOnly) this._scrollToBottom();
        return el;
    }

    // Replay saved session history into DOM on re-open
    restoreHistory(conversationHistory) {
        if (!conversationHistory?.length) return;
        const hasSomething = conversationHistory.some(m => m.role === 'user' || m.role === 'assistant');
        if (!hasSomething) return;
        for (const msg of conversationHistory) {
            if (msg.role === 'user' || msg.role === 'assistant') {
                // restoreOnly=true: renders to DOM but doesn't push to this.messages
                // (avoids double-counting; history is already in session.conversationHistory)
                this.addMessage(msg.role, msg.content, true);
            }
        }
        this._scrollToBottom();
    }

    addSystemMessage(text, type = 'info') {
        const el = document.createElement('div');
        el.className = `ccs-sys-msg ccs-sys-${type}`;
        el.innerHTML = this._renderMarkdown(text);
        this.container?.appendChild(el);
        this._scrollToBottom();
        return el;
    }

    // ── Streaming ─────────────────────────────────────────────────────────────

    startStreaming() {
        const el = document.createElement('div');
        el.className = 'ccs-msg ccs-msg-assistant ccs-msg-streaming';
        el.innerHTML = `<div class="ccs-msg-bubble"><span class="ccs-typing-dots"><span></span><span></span><span></span></span></div>`;
        this.container?.appendChild(el);
        this.streamingEl = el;
        this._scrollToBottom();
    }

    finalizeStream(content) {
        if (this.streamingEl) {
            const bubble = this.streamingEl.querySelector('.ccs-msg-bubble');
            if (bubble) bubble.innerHTML = this._renderMarkdown(content);
            this.streamingEl.classList.remove('ccs-msg-streaming');

            const actions = document.createElement('div');
            actions.className = 'ccs-msg-actions';
            actions.innerHTML = `<button class="ccs-msg-btn" title="Copy">📋</button>`;
            actions.querySelector('[title="Copy"]').addEventListener('click', () => {
                navigator.clipboard.writeText(content).catch(() => {});
            });
            this.streamingEl.appendChild(actions);

            const index = this.messages.length;
            this.messages.push({ role: 'assistant', content, el: this.streamingEl, index });
            this.streamingEl.dataset.index = index;
            this.streamingEl = null;
        }
        this._scrollToBottom();
    }

    // ── Edit / Resend ─────────────────────────────────────────────────────────

    _editMessage(index, el) {
        const msg = this.messages[index];
        if (!msg || msg.role !== 'user') return;

        const bubble = el.querySelector('.ccs-msg-bubble');
        const original = msg.content;

        // Replace bubble with inline editor
        bubble.innerHTML = `
            <textarea class="ccs-inline-edit">${original}</textarea>
            <div class="ccs-inline-edit-actions">
                <button class="ccs-btn ccs-btn-primary ccs-edit-send-btn">✅ Update & Resend</button>
                <button class="ccs-btn ccs-btn-ghost ccs-edit-cancel-btn">Cancel</button>
            </div>
        `;
        const textarea = bubble.querySelector('textarea');
        textarea.style.height = Math.max(textarea.scrollHeight, 60) + 'px';
        textarea.focus();

        bubble.querySelector('.ccs-edit-send-btn').addEventListener('click', () => {
            const newContent = textarea.value.trim();
            if (!newContent) return;

            // Update message in array and DOM
            msg.content = newContent;
            bubble.innerHTML = this._renderMarkdown(newContent);

            // Remove all messages after this one from DOM and array
            const toRemove = this.messages.slice(index + 1);
            for (const m of toRemove) m.el?.remove();
            this.messages = this.messages.slice(0, index + 1);

            // Resend
            this.onSend?.(newContent, index);
        });

        bubble.querySelector('.ccs-edit-cancel-btn').addEventListener('click', () => {
            bubble.innerHTML = this._renderMarkdown(original);
        });
    }

    _resendMessage(index) {
        const msg = this.messages[index];
        if (!msg || msg.role !== 'user') return;

        // Remove all messages after this one
        const toRemove = this.messages.slice(index + 1);
        for (const m of toRemove) m.el?.remove();
        this.messages = this.messages.slice(0, index + 1);

        this.onSend?.(msg.content, index);
    }

    // ── Accept bars ───────────────────────────────────────────────────────────

    addAcceptBar(fieldName, content, onAccept) {
        const bar = document.createElement('div');
        bar.className = 'ccs-accept-bar';

        const tokens = Math.round(content.length / 4);
        const preview = content.length > 120 ? content.substring(0, 120) + '...' : content;

        bar.innerHTML = `
            <div class="ccs-accept-header">
                <span class="ccs-accept-label">📝 ${fieldName} <span class="ccs-token-badge">~${tokens}t</span></span>
                <div class="ccs-accept-btns">
                    <button class="ccs-btn ccs-btn-primary ccs-accept-btn" title="Write to card">✅ Accept</button>
                    <button class="ccs-btn ccs-btn-ghost ccs-preview-toggle" title="Toggle preview">👁</button>
                    <button class="ccs-btn ccs-btn-ghost ccs-reject-btn" title="Discard">✕</button>
                </div>
            </div>
            <div class="ccs-accept-preview" style="display:none;">${this._escapeHtml(preview)}</div>
        `;

        bar.querySelector('.ccs-accept-btn').addEventListener('click', () => {
            onAccept(fieldName, content);
            bar.innerHTML = `<span class="ccs-accept-label">✅ ${fieldName} written to card</span>`;
        });

        bar.querySelector('.ccs-preview-toggle').addEventListener('click', (e) => {
            const preview = bar.querySelector('.ccs-accept-preview');
            preview.style.display = preview.style.display === 'none' ? 'block' : 'none';
            e.target.textContent = preview.style.display === 'none' ? '👁' : '🙈';
        });

        bar.querySelector('.ccs-reject-btn').addEventListener('click', () => {
            bar.innerHTML = `<span class="ccs-accept-label">🗑 ${fieldName} discarded</span>`;
        });

        this.container?.appendChild(bar);
        this._scrollToBottom();
    }

    addVariation(fieldName, label, content, onAccept) {
        const el = document.createElement('div');
        el.className = 'ccs-variation-card';
        const tokens = Math.round(content.length / 4);
        const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
        el.innerHTML = `
            <div class="ccs-variation-header">
                <span class="ccs-variation-label">🎲 ${label}</span>
                <span class="ccs-token-badge">~${tokens}t</span>
                <button class="ccs-btn ccs-btn-primary ccs-var-accept-btn">✅ Use This</button>
            </div>
            <pre class="ccs-variation-preview">${this._escapeHtml(preview)}</pre>
        `;
        el.querySelector('.ccs-var-accept-btn').addEventListener('click', () => {
            onAccept(fieldName, content);
            el.classList.add('ccs-variation-accepted');
            el.querySelector('.ccs-var-accept-btn').textContent = '✅ Accepted';
        });
        this.container?.appendChild(el);
        this._scrollToBottom();
    }

    // ── Inline annotation ─────────────────────────────────────────────────────

    enableInlineAnnotation(session, onRequest) {
        document.addEventListener('mouseup', () => {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed) return;
            const text = selection.toString().trim();
            if (!text || text.length < 5) return;

            // Only trigger inside chat container
            if (!this.container?.contains(selection.anchorNode)) return;

            this._showAnnotationPopup(text, selection.getRangeAt(0), onRequest);
        });
    }

    _showAnnotationPopup(selectedText, range, onRequest) {
        document.getElementById('ccs-annotation-popup')?.remove();
        const popup = document.createElement('div');
        popup.id = 'ccs-annotation-popup';
        popup.className = 'ccs-annotation-popup';
        popup.innerHTML = `
            <button class="ccs-ann-btn" data-action="expand">🔍 Expand</button>
            <button class="ccs-ann-btn" data-action="specific">🎯 More Specific</button>
            <button class="ccs-ann-btn" data-action="explain">💡 Explain Choice</button>
        `;
        const rect = range.getBoundingClientRect();
        const studioEl = document.getElementById('ccs-studio');
        const studioRect = studioEl?.getBoundingClientRect() || { top: 0, left: 0 };
        popup.style.top = (rect.top - studioRect.top - 44) + 'px';
        popup.style.left = Math.max(0, rect.left - studioRect.left) + 'px';
        studioEl?.appendChild(popup);

        popup.querySelectorAll('.ccs-ann-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                popup.remove();
                onRequest(selectedText, action);
            });
        });

        document.addEventListener('click', () => popup.remove(), { once: true });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    setInputEnabled(enabled) {
        if (this.inputEl) this.inputEl.disabled = !enabled;
        if (this.sendBtn) this.sendBtn.disabled = !enabled;
        if (this.abortBtn) this.abortBtn.style.display = enabled ? 'none' : '';
    }

    clear() {
        if (this.container) this.container.innerHTML = '';
        this.messages = [];
        this.streamingEl = null;
    }

    _scrollToBottom() {
        if (this.container) {
            this.container.scrollTop = this.container.scrollHeight;
        }
    }

    _renderMarkdown(text) {
        if (!text) return '';
        return text
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/```[\w]*\n?([\s\S]*?)```/g, '<pre><code>$1</code></pre>')
            .replace(/^#{1,3} (.+)$/gm, (_, h) => `<div class="ccs-md-heading">${h}</div>`)
            .replace(/\n/g, '<br>');
    }

    _escapeHtml(text) {
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}

export const chatPanel = new ChatPanel();
